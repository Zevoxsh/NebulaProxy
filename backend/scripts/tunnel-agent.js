#!/usr/bin/env node

import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

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
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;
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
    if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
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
      currentWs = new WebSocket(wsUrl);

      currentWs.on('open', () => {
        process.stdout.write(`[tunnel-agent] relay connected to ${apiBase}\n`);
      });

      currentWs.on('message', onMessage);

      currentWs.on('close', () => {
        closeAllSockets();
        resolve();
      });

      currentWs.on('error', (error) => {
        process.stderr.write(`[tunnel-agent] websocket error: ${error.message}\n`);
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