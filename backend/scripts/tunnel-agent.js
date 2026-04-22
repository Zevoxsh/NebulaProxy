#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import tls from 'tls';
import { EventEmitter } from 'events';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.nebula-tunnel-agent.json');

const WebSocketState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

function parseWebSocketUrl(input) {
  const url = new URL(input);
  const isSecure = url.protocol === 'wss:';
  const port = url.port ? Number.parseInt(url.port, 10) : (isSecure ? 443 : 80);
  return {
    isSecure,
    host: url.hostname,
    port,
    path: `${url.pathname || '/'}${url.search || ''}`
  };
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64');
}

class MinimalWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.state = WebSocketState.CONNECTING;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pendingClose = false;
    this.connect();
  }

  get readyState() {
    return this.state;
  }

  connect() {
    const { isSecure, host, port, path: requestPath } = parseWebSocketUrl(this.url);
    const key = crypto.randomBytes(16).toString('base64');
    const connectOptions = { host, port, servername: host };
    const socket = isSecure ? tls.connect(connectOptions) : net.connect(connectOptions);

    this.socket = socket;

    socket.on('connect', () => {
      const requestLines = [
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        ''
      ];
      socket.write(requestLines.join('\r\n'));
    });

    socket.on('data', (chunk) => {
      this.handleSocketData(chunk, key);
    });

    socket.on('close', () => {
      this.state = WebSocketState.CLOSED;
      this.emit('close');
    });

    socket.on('error', (error) => {
      this.emit('error', error);
    });
  }

  handleSocketData(chunk, key) {
    if (this.state === WebSocketState.CONNECTING) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const headerEnd = this.buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd === -1) {
        return;
      }

      const headerText = this.buffer.slice(0, headerEnd).toString('utf8');
      const body = this.buffer.slice(headerEnd + 4);
      this.buffer = Buffer.alloc(0);

      const lines = headerText.split('\r\n');
      const statusLine = lines.shift() || '';
      if (!/^HTTP\/1\.1 101 /.test(statusLine)) {
        this.emit('error', new Error(`WebSocket handshake failed: ${statusLine}`));
        this.close();
        return;
      }

      const headers = new Map();
      for (const line of lines) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) continue;
        headers.set(line.slice(0, separatorIndex).trim().toLowerCase(), line.slice(separatorIndex + 1).trim());
      }

      const expectedAccept = crypto
        .createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      if ((headers.get('sec-websocket-accept') || '') !== expectedAccept) {
        this.emit('error', new Error('WebSocket handshake validation failed'));
        this.close();
        return;
      }

      this.state = WebSocketState.OPEN;
      this.emit('open');
      if (body.length > 0) {
        this.buffer = Buffer.concat([this.buffer, body]);
        this.processFrames();
      }
      return;
    }

    if (this.state === WebSocketState.OPEN) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processFrames();
    }
  }

  processFrames() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        if (high !== 0) {
          this.emit('error', new Error('WebSocket frame too large'));
          this.close();
          return;
        }
        payloadLength = low;
        offset += 8;
      }

      let maskingKey = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        maskingKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) return;

      let payload = this.buffer.slice(offset, offset + payloadLength);
      this.buffer = this.buffer.slice(offset + payloadLength);

      if (masked && maskingKey) {
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i += 1) {
          unmasked[i] = payload[i] ^ maskingKey[i % 4];
        }
        payload = unmasked;
      }

      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
        continue;
      }

      if (opcode === 0x8) {
        if (!this.pendingClose) {
          this.sendFrame(0x8, Buffer.alloc(0));
        }
        this.close();
        return;
      }

      if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
      }
    }
  }

  sendFrame(opcode, payloadBuffer) {
    if (!this.socket || this.state !== WebSocketState.OPEN && opcode !== 0x8) return;
    const payload = Buffer.isBuffer(payloadBuffer) ? payloadBuffer : Buffer.from(payloadBuffer || '');
    const maskKey = crypto.randomBytes(4);
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | length;
      maskKey.copy(header, 2);
    } else if (length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
      maskKey.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
      maskKey.copy(header, 10);
    }

    const maskedPayload = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      maskedPayload[i] = payload[i] ^ maskKey[i % 4];
    }

    this.socket.write(Buffer.concat([header, maskedPayload]));
  }

  send(data) {
    if (this.state !== WebSocketState.OPEN) return;
    this.sendFrame(0x1, Buffer.from(String(data)));
  }

  close(code = 1000, reason = '') {
    this.pendingClose = true;
    if (this.state === WebSocketState.CLOSED) return;
    if (this.socket && !this.socket.destroyed && this.state === WebSocketState.OPEN) {
      const reasonBuffer = Buffer.from(String(reason));
      const payload = Buffer.alloc(2 + reasonBuffer.length);
      payload.writeUInt16BE(code, 0);
      reasonBuffer.copy(payload, 2);
      this.sendFrame(0x8, payload);
    }
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
    this.state = WebSocketState.CLOSING;
  }
}

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

  const closeSocket = (connId) => {
    const socket = sockets.get(connId);
    if (!socket) return;
    sockets.delete(connId);
    if (!socket.destroyed) {
      socket.destroy();
    }
  };

  const closeAllSockets = () => {
    for (const connId of sockets.keys()) {
      closeSocket(connId);
    }
  };

  const sendJson = (payload) => {
    if (!currentWs || currentWs.readyState !== WebSocketState.OPEN) return;
    currentWs.send(JSON.stringify(payload));
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
      const targetHost = String(message.targetHost || '127.0.0.1');
      const targetPort = Number.parseInt(String(message.targetPort || ''), 10);
      if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
        sendJson({ type: 'close', connId });
        return;
      }

      const socket = net.connect({ host: targetHost, port: targetPort }, () => {
        sendJson({ type: 'opened', connId });
      });

      sockets.set(connId, socket);

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
      const socket = sockets.get(connId);
      if (!socket || socket.destroyed || typeof message.data !== 'string') return;
      socket.write(Buffer.from(message.data, 'base64'));
      return;
    }

    if (message.type === 'close') {
      const socket = sockets.get(connId);
      if (socket && !socket.destroyed) {
        socket.end();
      }
      sockets.delete(connId);
    }
  };

  const shutdown = () => {
    stopRequested = true;
    if (currentWs && (currentWs.readyState === WebSocketState.OPEN || currentWs.readyState === WebSocketState.CONNECTING)) {
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

  while (!stopRequested) {
    await new Promise((resolve) => {
      currentWs = new MinimalWebSocket(wsUrl);

      currentWs.on('open', () => {
        process.stdout.write(`[tunnel-agent] relay connected to ${apiBase}\n`);
      });

      currentWs.on('message', (data) => {
        onMessage(data);
      });

      currentWs.on('close', () => {
        closeAllSockets();
        resolve();
      });

      currentWs.on('error', (event) => {
        const message = event?.error?.message || event?.message || 'websocket error';
        process.stderr.write(`[tunnel-agent] websocket error: ${message}\n`);
      });
    });

    if (!stopRequested) {
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
