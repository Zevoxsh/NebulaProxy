import crypto from 'crypto';
import net from 'net';
import { URL } from 'url';
import { WebSocketServer } from 'ws';
import { database } from './database.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

class TunnelRelayService {
  constructor() {
    this.logger = console;
    this.wss = null;
    this.agentSockets = new Map();
    this.bindingServers = new Map();
    this.connections = new Map();
  }

  async init(server, logger) {
    this.logger = logger || console;
    this.wss = new WebSocketServer({ server, path: '/ws/tunnels/agent' });

    this.wss.on('connection', async (ws, req) => {
      try {
        const parsed = new URL(req.url || '', 'http://localhost');
        const agentId = Number.parseInt(parsed.searchParams.get('agentId') || '', 10);
        const token = String(parsed.searchParams.get('token') || '').trim();

        if (!Number.isInteger(agentId) || !token) {
          ws.close(1008, 'Unauthorized');
          return;
        }

        const agent = await database.getTunnelAgentById(agentId);
        if (!agent || agent.agent_token_hash !== sha256(token)) {
          ws.close(1008, 'Unauthorized');
          return;
        }

        const previous = this.agentSockets.get(agentId);
        if (previous && previous.readyState === 1) {
          previous.close(1012, 'Replaced by newer session');
        }

        ws.agentId = agentId;
        this.agentSockets.set(agentId, ws);
        await database.updateTunnelAgentHeartbeat(agentId, { status: 'online' });

        ws.on('message', (raw) => {
          this.handleAgentMessage(agentId, raw);
        });

        ws.on('close', async () => {
          if (this.agentSockets.get(agentId) === ws) {
            this.agentSockets.delete(agentId);
          }
          this.closeAgentConnections(agentId);
          await database.updateTunnelAgentHeartbeat(agentId, { status: 'offline' }).catch(() => {});
        });

        ws.on('error', () => {
          this.closeAgentConnections(agentId);
        });

        this.sendJson(ws, { type: 'ready', agentId });
      } catch (error) {
        this.logger.error({ error }, '[TunnelRelay] Agent connection failed');
        ws.close(1011, 'Internal error');
      }
    });

    await this.reloadBindings();
    this.logger.info('[TunnelRelay] Initialized on /ws/tunnels/agent');
  }

  async reloadBindings() {
    const bindings = await database.getActiveTcpTunnelBindings();
    const nextBindingIds = new Set(bindings.map((b) => Number(b.id)));

    for (const [bindingId, entry] of this.bindingServers.entries()) {
      if (!nextBindingIds.has(Number(bindingId))) {
        entry.server.close();
        this.bindingServers.delete(bindingId);
      }
    }

    for (const binding of bindings) {
      if (this.bindingServers.has(binding.id)) continue;
      await this.startBindingListener(binding);
    }
  }

  async startBindingListener(binding) {
    if (binding.protocol !== 'tcp') return;

    const server = net.createServer((clientSocket) => {
      const agentWs = this.agentSockets.get(binding.agent_id);
      if (!agentWs || agentWs.readyState !== 1) {
        clientSocket.destroy();
        return;
      }

      const connId = crypto.randomUUID();
      this.connections.set(connId, {
        agentId: binding.agent_id,
        bindingId: binding.id,
        clientSocket
      });

      this.sendJson(agentWs, {
        type: 'open',
        connId,
        targetHost: binding.target_host || '127.0.0.1',
        targetPort: Number(binding.local_port)
      });

      clientSocket.on('data', (chunk) => {
        const ws = this.agentSockets.get(binding.agent_id);
        if (!ws || ws.readyState !== 1) {
          clientSocket.destroy();
          this.cleanupConnection(connId);
          return;
        }
        this.sendJson(ws, {
          type: 'data',
          connId,
          data: chunk.toString('base64')
        });
      });

      clientSocket.on('close', () => {
        const ws = this.agentSockets.get(binding.agent_id);
        if (ws && ws.readyState === 1) {
          this.sendJson(ws, { type: 'close', connId });
        }
        this.cleanupConnection(connId);
      });

      clientSocket.on('error', () => {
        const ws = this.agentSockets.get(binding.agent_id);
        if (ws && ws.readyState === 1) {
          this.sendJson(ws, { type: 'close', connId });
        }
        this.cleanupConnection(connId);
      });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(binding.public_port), '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.bindingServers.set(binding.id, { server, binding });
    this.logger.info({ bindingId: binding.id, publicPort: binding.public_port }, '[TunnelRelay] Binding listener started');
  }

  handleAgentMessage(agentId, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    const connId = String(message.connId || '');
    if (!connId) return;

    const entry = this.connections.get(connId);
    if (!entry || entry.agentId !== agentId) return;

    const socket = entry.clientSocket;
    if (!socket || socket.destroyed) {
      this.cleanupConnection(connId);
      return;
    }

    if (message.type === 'data') {
      if (typeof message.data !== 'string') return;
      socket.write(Buffer.from(message.data, 'base64'));
      return;
    }

    if (message.type === 'close') {
      socket.end();
      this.cleanupConnection(connId);
    }
  }

  closeAgentConnections(agentId) {
    for (const [connId, entry] of this.connections.entries()) {
      if (entry.agentId !== agentId) continue;
      if (entry.clientSocket && !entry.clientSocket.destroyed) {
        entry.clientSocket.destroy();
      }
      this.connections.delete(connId);
    }
  }

  cleanupConnection(connId) {
    this.connections.delete(connId);
  }

  sendJson(ws, payload) {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  async stop() {
    for (const { server } of this.bindingServers.values()) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    this.bindingServers.clear();

    for (const ws of this.agentSockets.values()) {
      if (ws.readyState === 1) ws.close(1001, 'Server shutdown');
    }
    this.agentSockets.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

export const tunnelRelayService = new TunnelRelayService();
