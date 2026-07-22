// @ts-check
/**
 * Outgoing SOCKS5 Proxy Service (RFC 1928 + RFC 1929 username/password auth)
 *
 * Forward proxy: authenticated users connect a SOCKS5-aware client through
 * this listener, traffic egresses from this server instead of the client's
 * own IP. Every session must authenticate with a per-user credential
 * (backend/repositories/socks5Repository.js) — no anonymous method is ever
 * offered. CONNECT is the only supported command (BIND/UDP ASSOCIATE are
 * refused) since HTTP(S)-based tools are the target use case.
 */

import net from 'net';
import { config } from '../config/config.js';
import { database } from './database.js';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { verifyApiKey } from '../utils/apiKey.js';
import { bandwidthTracker } from './bandwidthTracker.js';
import * as activeConnections from './activeConnectionsRegistry.js';
import { ThrottleStream } from './proxy/socks5Throttle.js';

const SOCKS_VERSION = 0x05;
const METHOD_USER_PASS = 0x02;
const METHOD_NO_ACCEPTABLE = 0xff;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

const REP_SUCCESS = 0x00;
const REP_GENERAL_FAILURE = 0x01;
const REP_NETWORK_UNREACHABLE = 0x03;
const REP_HOST_UNREACHABLE = 0x04;
const REP_CONNECTION_REFUSED = 0x05;
const REP_COMMAND_NOT_SUPPORTED = 0x07;
const REP_ATYP_NOT_SUPPORTED = 0x08;

const QUOTA_CACHE_TTL_MS = 10_000;
const MAX_HANDSHAKE_BYTES = 8192; // guard against pathological/garbage clients, mirrors minecraftProxy.js

function connectReply(rep) {
  // BND.ADDR/BND.PORT are irrelevant for CONNECT-only clients — always echo 0.0.0.0:0.
  return Buffer.from([SOCKS_VERSION, rep, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
}

function parseGreeting(buffer) {
  if (buffer.length < 2) return null;
  const nMethods = buffer[1];
  const totalLen = 2 + nMethods;
  if (buffer.length < totalLen) return null;
  return { methods: [...buffer.subarray(2, totalLen)], bytesConsumed: totalLen };
}

function parseAuth(buffer) {
  if (buffer.length < 2) return null;
  const ulen = buffer[1];
  if (buffer.length < 2 + ulen + 1) return null;
  const plen = buffer[2 + ulen];
  const totalLen = 2 + ulen + 1 + plen;
  if (buffer.length < totalLen) return null;
  return {
    username: buffer.subarray(2, 2 + ulen).toString('utf8'),
    password: buffer.subarray(2 + ulen + 1, totalLen).toString('utf8'),
    bytesConsumed: totalLen
  };
}

function formatIPv6(buf) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(i).toString(16));
  return parts.join(':');
}

function parseConnectRequest(buffer) {
  if (buffer.length < 4) return null;
  const cmd = buffer[1];
  const atyp = buffer[3];

  if (atyp === ATYP_IPV4) {
    if (buffer.length < 10) return null;
    return { cmd, atyp, addr: `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`, port: buffer.readUInt16BE(8), bytesConsumed: 10 };
  }

  if (atyp === ATYP_DOMAIN) {
    if (buffer.length < 5) return null;
    const domainLen = buffer[4];
    const totalLen = 5 + domainLen + 2;
    if (buffer.length < totalLen) return null;
    return { cmd, atyp, addr: buffer.subarray(5, 5 + domainLen).toString('utf8'), port: buffer.readUInt16BE(5 + domainLen), bytesConsumed: totalLen };
  }

  if (atyp === ATYP_IPV6) {
    if (buffer.length < 22) return null;
    return { cmd, atyp, addr: formatIPv6(buffer.subarray(4, 20)), port: buffer.readUInt16BE(20), bytesConsumed: 22 };
  }

  return { cmd, atyp, unsupportedAtyp: true, bytesConsumed: 4 };
}

async function getUserBandwidthQuota(userId) {
  try {
    const { rows } = await pool.query('SELECT bandwidth_quota_bytes FROM users WHERE id = $1', [userId]);
    return Number(rows[0]?.bandwidth_quota_bytes ?? 0);
  } catch {
    return 0; // fail open — never let a quota lookup error block a connection
  }
}

class Socks5ProxyService {
  #server = null;
  #isRunning = false;
  #connectionsByCredential = new Map(); // credentialId -> open connection count
  #quotaCache = new Map(); // userId -> { exceeded, checkedAt }

  async start() {
    if (this.#isRunning) return;

    if (!config.socks5Proxy.enabled) {
      logger.info('[SOCKS5 Proxy] Disabled in configuration');
      return;
    }

    const server = net.createServer((socket) => this.#handleConnection(socket));
    server.on('error', (err) => logger.error({ err }, '[SOCKS5 Proxy] Server error'));

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(config.socks5Proxy.port, config.socks5Proxy.bindAddress, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    this.#server = server;
    this.#isRunning = true;
    logger.info(`[SOCKS5 Proxy] Listening on ${config.socks5Proxy.bindAddress}:${config.socks5Proxy.port}`);
  }

  async stop() {
    if (!this.#server) return;
    await new Promise((resolve) => this.#server.close(() => resolve()));
    this.#server = null;
    this.#isRunning = false;
  }

  getStats() {
    return {
      isRunning: this.#isRunning,
      port: config.socks5Proxy.port,
      bindAddress: config.socks5Proxy.bindAddress,
      openConnectionsByCredential: this.#connectionsByCredential.size
    };
  }

  async #isQuotaExceededCached(userId, quotaBytes) {
    if (!quotaBytes || quotaBytes <= 0) return false;

    const cached = this.#quotaCache.get(userId);
    if (cached && Date.now() - cached.checkedAt < QUOTA_CACHE_TTL_MS) {
      return cached.exceeded;
    }

    const { exceeded } = await bandwidthTracker.checkQuota(userId, quotaBytes);
    this.#quotaCache.set(userId, { exceeded, checkedAt: Date.now() });
    return exceeded;
  }

  #handleConnection(socket) {
    const clientIp = socket.remoteAddress || 'unknown';
    const connectionId = activeConnections.nextConnectionId('socks5');

    let buffer = Buffer.alloc(0);
    let state = 'greeting'; // greeting -> auth -> request -> relaying
    let credential = null;
    let quotaBytes = 0;
    let targetSocket = null;
    let quotaInterval = null;
    let connectTimeout = null;
    let isClosing = false;

    if (config.socks5Proxy.idleTimeoutMs > 0) socket.setTimeout(config.socks5Proxy.idleTimeoutMs);
    socket.setNoDelay(true);

    const cleanup = () => {
      if (isClosing) return;
      isClosing = true;

      if (quotaInterval) clearInterval(quotaInterval);
      if (connectTimeout) clearTimeout(connectTimeout);

      if (credential) {
        const remaining = (this.#connectionsByCredential.get(credential.id) || 1) - 1;
        if (remaining <= 0) this.#connectionsByCredential.delete(credential.id);
        else this.#connectionsByCredential.set(credential.id, remaining);
      }

      activeConnections.unregister(connectionId);

      try { if (!socket.destroyed) socket.destroy(); } catch { /* ignore */ }
      try { if (targetSocket && !targetSocket.destroyed) targetSocket.destroy(); } catch { /* ignore */ }
    };

    socket.on('timeout', () => cleanup());
    socket.on('error', () => cleanup());
    socket.on('close', () => cleanup());

    const onHandshakeData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Once the CONNECT request is parsed we're just waiting on the target
      // socket to connect — any further bytes are pipelined request data,
      // not handshake garbage, so the size guard only applies beforehand.
      const stillHandshaking = state === 'greeting' || state === 'auth' || state === 'authenticating' || state === 'request';
      if (stillHandshaking && buffer.length > MAX_HANDSHAKE_BYTES) {
        logger.warn(`[SOCKS5 Proxy] handshake buffer overflow client=${clientIp}`);
        cleanup();
        return;
      }

      advanceHandshake();
    };

    socket.on('data', onHandshakeData);

    const advanceHandshake = () => {
      let progressed = true;

      while (progressed && !isClosing) {
        progressed = false;

        if (state === 'greeting') {
          const greeting = parseGreeting(buffer);
          if (!greeting) break;
          buffer = buffer.subarray(greeting.bytesConsumed);

          if (!greeting.methods.includes(METHOD_USER_PASS)) {
            socket.end(Buffer.from([SOCKS_VERSION, METHOD_NO_ACCEPTABLE]));
            cleanup();
            return;
          }

          socket.write(Buffer.from([SOCKS_VERSION, METHOD_USER_PASS]));
          state = 'auth';
          progressed = true;
          continue;
        }

        if (state === 'auth') {
          const auth = parseAuth(buffer);
          if (!auth) break;
          buffer = buffer.subarray(auth.bytesConsumed);
          state = 'authenticating'; // block further parsing while we await the DB round-trip
          this.#authenticate(socket, auth, connectionId, clientIp, {
            onSuccess: (cred, quota) => {
              credential = cred;
              quotaBytes = quota;
              state = 'request';
              advanceHandshake();
            },
            onFailure: () => cleanup()
          });
          return;
        }

        if (state === 'request') {
          const req = parseConnectRequest(buffer);
          if (!req) break;
          buffer = buffer.subarray(req.bytesConsumed);
          state = 'connecting';
          this.#handleConnectRequest(socket, req, credential, quotaBytes, connectionId, clientIp, {
            setTargetSocket: (t) => { targetSocket = t; },
            setConnectTimeout: (t) => { connectTimeout = t; },
            setQuotaInterval: (t) => { quotaInterval = t; },
            detachHandshakeListener: () => socket.removeListener('data', onHandshakeData),
            markRelaying: () => { state = 'relaying'; },
            // Bytes may keep arriving (pipelined by the client) while we wait
            // on the target TCP connect — read the *current* buffer here
            // rather than a stale snapshot taken at request-parse time.
            flushLeftover: () => { const pending = buffer; buffer = Buffer.alloc(0); return pending; },
            cleanup
          });
          return;
        }

        break;
      }
    };

    advanceHandshake();
  }

  async #authenticate(socket, auth, connectionId, clientIp, { onSuccess, onFailure }) {
    try {
      const credential = await database.getSocks5CredentialByUsername(auth.username);

      if (!credential || !credential.is_enabled) {
        socket.end(Buffer.from([0x01, 0x01]));
        onFailure();
        return;
      }

      const passwordOk = await verifyApiKey(auth.password, credential.password_hash);
      if (!passwordOk) {
        socket.end(Buffer.from([0x01, 0x01]));
        onFailure();
        return;
      }

      const quotaBytes = await getUserBandwidthQuota(credential.user_id);
      const quotaExceeded = await this.#isQuotaExceededCached(credential.user_id, quotaBytes);
      if (quotaExceeded) {
        socket.end(Buffer.from([0x01, 0x01]));
        onFailure();
        return;
      }

      const openCount = this.#connectionsByCredential.get(credential.id) || 0;
      if (openCount >= config.socks5Proxy.maxConnectionsPerCredential) {
        socket.end(Buffer.from([0x01, 0x01]));
        onFailure();
        return;
      }

      this.#connectionsByCredential.set(credential.id, openCount + 1);
      database.touchSocks5CredentialLastUsed(credential.id).catch(() => { /* best-effort */ });

      socket.write(Buffer.from([0x01, 0x00]));
      onSuccess(credential, quotaBytes);
    } catch (err) {
      logger.error({ err, clientIp }, '[SOCKS5 Proxy] Authentication error');
      try { socket.end(Buffer.from([0x01, 0x01])); } catch { /* ignore */ }
      onFailure();
    }
  }

  #handleConnectRequest(socket, req, credential, quotaBytes, connectionId, clientIp, hooks) {
    const { setTargetSocket, setConnectTimeout, setQuotaInterval, detachHandshakeListener, markRelaying, flushLeftover, cleanup } = hooks;

    if (req.unsupportedAtyp) {
      socket.end(connectReply(REP_ATYP_NOT_SUPPORTED));
      cleanup();
      return;
    }

    if (req.cmd !== CMD_CONNECT) {
      socket.end(connectReply(REP_COMMAND_NOT_SUPPORTED));
      cleanup();
      return;
    }

    const targetSocket = net.connect({ host: req.addr, port: req.port });
    setTargetSocket(targetSocket);
    targetSocket.setNoDelay(true);

    const connectTimeoutMs = config.socks5Proxy.connectTimeoutMs;
    if (connectTimeoutMs > 0) {
      const timeout = setTimeout(() => {
        if (targetSocket.connecting) {
          socket.end(connectReply(REP_HOST_UNREACHABLE));
          cleanup();
        }
      }, connectTimeoutMs);
      setConnectTimeout(timeout);
    }

    targetSocket.once('connect', () => {
      socket.write(connectReply(REP_SUCCESS));
      detachHandshakeListener();
      markRelaying();

      const leftoverBuffer = flushLeftover();
      if (leftoverBuffer.length > 0) targetSocket.write(leftoverBuffer);

      activeConnections.register(connectionId, {
        domainId: 'socks5',
        protocol: 'socks5',
        clientIp,
        connectedAt: Date.now(),
        label: `${credential.username} → ${req.addr}:${req.port}`,
        close: cleanup
      });

      const uploadThrottle = new ThrottleStream(credential.throttle_bps);
      const downloadThrottle = new ThrottleStream(credential.throttle_bps);

      socket.on('data', (chunk) => { bandwidthTracker.record(credential.user_id, chunk.length, 0); activeConnections.addBytes(connectionId, chunk.length, 0); });
      targetSocket.on('data', (chunk) => { bandwidthTracker.record(credential.user_id, 0, chunk.length); activeConnections.addBytes(connectionId, 0, chunk.length); });

      socket.pipe(uploadThrottle).pipe(targetSocket);
      targetSocket.pipe(downloadThrottle).pipe(socket);

      if (quotaBytes > 0) {
        setQuotaInterval(setInterval(async () => {
          const exceeded = await this.#isQuotaExceededCached(credential.user_id, quotaBytes);
          if (exceeded) cleanup();
        }, 10_000));
      }
    });

    targetSocket.once('error', (err) => {
      if (!socket.destroyed && !socket.writableEnded) {
        const rep = err.code === 'ECONNREFUSED' ? REP_CONNECTION_REFUSED
          : err.code === 'ENOTFOUND' ? REP_HOST_UNREACHABLE
          : err.code === 'ENETUNREACH' ? REP_NETWORK_UNREACHABLE
          : REP_GENERAL_FAILURE;
        socket.end(connectReply(rep));
      }
      cleanup();
    });
  }
}

export const socks5ProxyService = new Socks5ProxyService();
