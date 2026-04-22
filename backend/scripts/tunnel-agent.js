#!/usr/bin/env node

import crypto from 'crypto';
import dgram from 'dgram';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.nebula-tunnel-agent.json');

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      result._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

async function requestJson(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

async function enrollAgent(options) {
  const apiBase = String(options.server || process.env.NEBULA_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const code = String(options.code || '').trim();
  const name = String(options.name || '').trim();

  if (!code || !name) {
    throw new Error('Missing required --code or --name');
  }

  const payload = await requestJson(`${apiBase}/api/tunnels/enroll`, {
    method: 'POST',
    body: {
      code,
      name,
      platform: process.platform,
      osName: os.type(),
      arch: os.arch(),
      version: process.version
    }
  });

  const configPath = String(options.config || DEFAULT_CONFIG_PATH);
  const configData = {
    apiBase,
    tunnelId: payload.tunnel.id,
    tunnelName: payload.tunnel.name,
    agentId: payload.agent.id,
    agentToken: payload.agentToken,
    name
  };

  fs.writeFileSync(configPath, `${JSON.stringify(configData, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ success: true, configPath, tunnelId: payload.tunnel.id, agentId: payload.agent.id }, null, 2)}\n`);
}

async function runAgent(options) {
  const configPath = String(options.config || DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiBase = String(configData.apiBase || options.server || process.env.NEBULA_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const reconnectMs = Number.parseInt(options.reconnect || '3000', 10);
  const wsBase = apiBase.replace(/^http/i, (value) => value.toLowerCase() === 'https' ? 'wss' : 'ws');
  const wsUrl = `${wsBase}/ws/tunnels/agent?agentId=${encodeURIComponent(String(configData.agentId))}&token=${encodeURIComponent(String(configData.agentToken))}`;
  const sockets = new Map();
  let stopRequested = false;
  let currentWs = null;
  let attempt = 0;
  let consecutiveFailures = 0;
  const NativeWebSocket = globalThis.WebSocket;
  let WebSocketCtor = NativeWebSocket;
  let webSocketMode = NativeWebSocket ? 'native' : 'ws-package';

  if (!WebSocketCtor) {
    try {
      const wsModule = await import('ws');
      WebSocketCtor = wsModule.default || wsModule.WebSocket;
    } catch {
      WebSocketCtor = null;
    }
  }

  if (!WebSocketCtor) {
    throw new Error(`WebSocket API unavailable on ${process.version}. Install fallback package with: cd ${path.dirname(configPath)} && npm init -y && npm install ws`);
  }

  if (WebSocketCtor !== NativeWebSocket) {
    webSocketMode = 'ws-package';
  }

  const WS_OPEN = WebSocketCtor.OPEN ?? 1;
  const WS_CONNECTING = WebSocketCtor.CONNECTING ?? 0;

  const closeSocket = (connId) => {
    const entry = sockets.get(connId);
    if (!entry) return;
    sockets.delete(connId);

    if (entry.kind === 'udp') {
      try {
        entry.socket.close();
      } catch {
        // Ignore UDP close race conditions.
      }
      return;
    }

    if (!entry.socket.destroyed) {
      entry.socket.destroy();
    }
  };

  const closeAllSockets = () => {
    for (const connId of sockets.keys()) {
      closeSocket(connId);
    }
  };

  const sendJson = (payload) => {
    if (!currentWs || currentWs.readyState !== WS_OPEN) return;
    currentWs.send(JSON.stringify(payload));
  };

  const log = (level, message, details = null) => {
    const ts = new Date().toISOString();
    if (details) {
      process.stderr.write(`[tunnel-agent] ${ts} ${level} ${message} ${JSON.stringify(details)}\n`);
      return;
    }
    process.stderr.write(`[tunnel-agent] ${ts} ${level} ${message}\n`);
  };

  const redactUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.searchParams.has('token')) {
        parsed.searchParams.set('token', '***');
      }
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  };

  const wsProbeUrl = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');

  const runFailureDiagnostics = async (failureContext) => {
    const baseContext = {
      ...failureContext,
      apiBase,
      wsUrl: redactUrl(wsUrl),
      configPath
    };

    try {
      const response = await fetch(wsProbeUrl);
      const body = await response.text();
      log('WARN', 'WebSocket HTTP probe response', {
        ...baseContext,
        probeUrl: redactUrl(wsProbeUrl),
        httpStatus: response.status,
        bodyPreview: body.slice(0, 180)
      });
    } catch (error) {
      log('WARN', 'WebSocket HTTP probe failed', {
        ...baseContext,
        probeUrl: redactUrl(wsProbeUrl),
        error: error?.message || String(error)
      });
    }

    try {
      const response = await fetch(`${apiBase}/api/tunnels/agent-script`);
      log('INFO', 'Agent script endpoint check', {
        ...baseContext,
        endpoint: `${apiBase}/api/tunnels/agent-script`,
        httpStatus: response.status
      });
    } catch (error) {
      log('WARN', 'Agent script endpoint check failed', {
        ...baseContext,
        endpoint: `${apiBase}/api/tunnels/agent-script`,
        error: error?.message || String(error)
      });
    }
  };

  const normalizeMessageData = async (data) => {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    if (data && typeof data.text === 'function') return data.text();
    return String(data);
  };

  const onMessage = (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === 'ready') {
      process.stdout.write(`[tunnel-agent] connected as agent ${message.agentId}\n`);
      return;
    }

    const connId = String(message.connId || '');
    if (!connId) return;

    if (message.type === 'open') {
      const protocol = String(message.protocol || 'tcp').toLowerCase();
      const targetHost = String(message.targetHost || '127.0.0.1');
      const targetPort = Number.parseInt(String(message.targetPort || ''), 10);
      if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
        sendJson({ type: 'close', connId });
        return;
      }

      if (protocol === 'udp') {
        const socket = dgram.createSocket('udp4');

        sockets.set(connId, {
          kind: 'udp',
          socket,
          targetHost,
          targetPort
        });

        socket.on('message', (chunk) => {
          sendJson({ type: 'data', connId, data: chunk.toString('base64') });
        });

        socket.on('error', () => {
          sendJson({ type: 'close', connId });
          closeSocket(connId);
        });

        socket.on('close', () => {
          sendJson({ type: 'close', connId });
          sockets.delete(connId);
        });

        sendJson({ type: 'opened', connId });
        return;
      }

      const socket = net.connect({ host: targetHost, port: targetPort }, () => {
        sendJson({ type: 'opened', connId });
      });

      sockets.set(connId, {
        kind: 'tcp',
        socket
      });

      socket.on('data', (chunk) => {
        sendJson({ type: 'data', connId, data: chunk.toString('base64') });
      });

      socket.on('error', () => {
        sendJson({ type: 'close', connId });
        closeSocket(connId);
      });

      socket.on('close', () => {
        sendJson({ type: 'close', connId });
        sockets.delete(connId);
      });
      return;
    }

    if (message.type === 'data') {
      const entry = sockets.get(connId);
      if (!entry || typeof message.data !== 'string') return;

      const payload = Buffer.from(message.data, 'base64');

      if (entry.kind === 'udp') {
        entry.socket.send(payload, entry.targetPort, entry.targetHost);
        return;
      }

      if (entry.socket.destroyed) return;
      entry.socket.write(payload);
      return;
    }

    if (message.type === 'close') {
      const entry = sockets.get(connId);
      if (entry?.kind === 'udp') {
        closeSocket(connId);
        return;
      }

      if (entry?.socket && !entry.socket.destroyed) {
        entry.socket.end();
      }
      sockets.delete(connId);
    }
  };

  const shutdown = () => {
    stopRequested = true;
    if (currentWs && (currentWs.readyState === WS_OPEN || currentWs.readyState === WS_CONNECTING)) {
      currentWs.close(1000, 'Agent shutdown');
    }
    closeAllSockets();
  };

  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  log('INFO', 'Agent runtime started', {
    apiBase,
    wsUrl: redactUrl(wsUrl),
    webSocketMode,
    reconnectMs,
    configPath,
    agentId: configData.agentId,
    tunnelId: configData.tunnelId
  });

  while (!stopRequested) {
    attempt += 1;
    let lastError = null;
    let closeDetails = { code: null, reason: '', wasClean: null };

    log('INFO', 'Attempting relay connection', {
      attempt,
      wsUrl: redactUrl(wsUrl)
    });

    await new Promise((resolve) => {
      currentWs = new WebSocketCtor(wsUrl);

      const onOpen = () => {
        consecutiveFailures = 0;
        process.stdout.write(`[tunnel-agent] relay connected to ${apiBase} (attempt ${attempt})\n`);
      };

      const onMessageEvent = async (eventOrData) => {
        const payload = webSocketMode === 'native'
          ? await normalizeMessageData(eventOrData?.data)
          : await normalizeMessageData(eventOrData);
        onMessage(payload);
      };

      const onClose = (eventOrCode, reasonMaybe) => {
        closeDetails = {
          code: webSocketMode === 'native' ? (eventOrCode?.code ?? null) : (eventOrCode ?? null),
          reason: webSocketMode === 'native'
            ? (eventOrCode?.reason ? String(eventOrCode.reason) : '')
            : (reasonMaybe ? String(reasonMaybe) : ''),
          wasClean: webSocketMode === 'native' ? (eventOrCode?.wasClean ?? null) : null
        };
        closeAllSockets();
        resolve();
      };

      const onError = (eventOrError) => {
        const message = eventOrError?.error?.message || eventOrError?.message || String(eventOrError) || 'websocket error';
        lastError = message;
        log('ERROR', 'WebSocket error event', {
          attempt,
          message,
          wsUrl: redactUrl(wsUrl)
        });
      };

      if (webSocketMode === 'native') {
        currentWs.addEventListener('open', onOpen);
        currentWs.addEventListener('message', onMessageEvent);
        currentWs.addEventListener('close', onClose);
        currentWs.addEventListener('error', onError);
      } else {
        currentWs.on('open', onOpen);
        currentWs.on('message', onMessageEvent);
        currentWs.on('close', onClose);
        currentWs.on('error', onError);
      }
    });

    if (!stopRequested) {
      consecutiveFailures += 1;
      log('WARN', 'Relay disconnected', {
        attempt,
        consecutiveFailures,
        closeCode: closeDetails.code,
        closeReason: closeDetails.reason,
        closeClean: closeDetails.wasClean,
        lastError: lastError || null,
        retryInMs: reconnectMs
      });

      if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
        await runFailureDiagnostics({
          attempt,
          consecutiveFailures,
          lastError: lastError || null,
          closeCode: closeDetails.code,
          closeReason: closeDetails.reason
        });
      }

      process.stderr.write(`[tunnel-agent] relay disconnected, retrying in ${reconnectMs}ms\n`);
      await new Promise((resolve) => setTimeout(resolve, reconnectMs));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';

  try {
    if (command === 'enroll') {
      await enrollAgent(args);
      return;
    }
    if (command === 'run') {
      await runAgent(args);
      return;
    }

    process.stdout.write(`Usage:\n  node scripts/tunnel-agent.js enroll --code <code> --name <name> [--server <url>] [--config <path>]\n  node scripts/tunnel-agent.js run [--config <path>] [--reconnect <ms>]\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
