import crypto from 'crypto';
import dgram from 'dgram';
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
    this.server = server;
    this.wss = new WebSocketServer({ noServer: true });

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
          // Clean up drain check interval
          if (ws._drainCheck) {
            clearInterval(ws._drainCheck);
            ws._drainCheck = null;
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

  shouldHandleUpgrade(req) {
    try {
      const parsed = new URL(req.url || '', 'http://localhost');
      return parsed.pathname === '/ws/tunnels/agent';
    } catch {
      return false;
    }
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  async reloadBindings() {
    const bindings = await database.getActiveTunnelBindings();
    const nextBindingIds = new Set(bindings.map((b) => Number(b.id)));

    for (const [bindingId, entry] of this.bindingServers.entries()) {
      if (!nextBindingIds.has(Number(bindingId))) {
        if (entry.protocol === 'udp') {
          clearInterval(entry.cleanupTimer);
          entry.socket.close();
        } else {
          entry.server.close();
        }
        this.bindingServers.delete(bindingId);
      }
    }

    for (const binding of bindings) {
      if (this.bindingServers.has(binding.id)) continue;
      if (binding.protocol === 'udp') {
        await this.startUdpBindingListener(binding);
      } else {
        await this.startTcpBindingListener(binding);
      }
    }
  }

  async startTcpBindingListener(binding) {
    if (binding.protocol !== 'tcp') return;

    const server = net.createServer((clientSocket) => {
      const agentWs = this.agentSockets.get(binding.agent_id);
      if (!agentWs || agentWs.readyState !== 1) {
        clientSocket.destroy();
        return;
      }

      const connId = crypto.randomUUID();
      this.connections.set(connId, {
        kind: 'tcp',
        agentId: binding.agent_id,
        bindingId: binding.id,
        clientSocket
      });

      this.sendJson(agentWs, {
        type: 'open',
        protocol: 'tcp',
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
        
        // Send binary data with compact format to avoid base64 overhead
        // Format: [1 byte msg type: 0x01] [4 bytes connId length] [connId string] [binary data]
        const connIdBuf = Buffer.from(connId, 'utf8');
        const msgType = Buffer.from([0x01]); // 0x01 = TCP data
        const lenBuf = Buffer.allocUnsafe(4);
        lenBuf.writeUInt32BE(connIdBuf.length, 0);
        
        const frame = Buffer.concat([msgType, lenBuf, connIdBuf, chunk]);
        
        // Implement backpressure: pause if WebSocket buffer is full
        ws.send(frame, { binary: true }, (err) => {
          if (err && !clientSocket.destroyed) {
            clientSocket.destroy();
            this.cleanupConnection(connId);
          }
        });
        
        // Check WebSocket buffered amount and pause if needed
        if (ws.bufferedAmount > 64 * 1024) { // 64KB threshold
          clientSocket.pause();
          // Use a check timer to resume when buffer drains
          if (!ws._drainCheck) {
            ws._drainCheck = setInterval(() => {
              if (ws.bufferedAmount < 32 * 1024 && !clientSocket.destroyed) {
                clientSocket.resume();
              }
            }, 100);
          }
        }
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

    this.bindingServers.set(binding.id, { protocol: 'tcp', server, binding });
    this.logger.info({ bindingId: binding.id, protocol: 'tcp', publicPort: binding.public_port }, '[TunnelRelay] Binding listener started');
  }

  async startUdpBindingListener(binding) {
    if (binding.protocol !== 'udp') return;

    const socket = dgram.createSocket('udp4');
    const udpSessions = new Map();
    const maxIdleMs = 60_000;

    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionKey, session] of udpSessions.entries()) {
        if (now - session.lastSeenAt < maxIdleMs) continue;
        udpSessions.delete(sessionKey);
        this.cleanupConnection(session.connId);
      }
    }, 15_000);

    socket.on('message', (msg, rinfo) => {
      const agentWs = this.agentSockets.get(binding.agent_id);
      if (!agentWs || agentWs.readyState !== 1) {
        return;
      }

      const sessionKey = `${rinfo.address}:${rinfo.port}`;
      let session = udpSessions.get(sessionKey);
      if (!session) {
        const connId = crypto.randomUUID();
        session = {
          connId,
          sessionKey,
          remoteAddress: rinfo.address,
          remotePort: rinfo.port,
          lastSeenAt: Date.now(),
          udpSessions
        };
        udpSessions.set(sessionKey, session);

        this.connections.set(connId, {
          kind: 'udp',
          agentId: binding.agent_id,
          bindingId: binding.id,
          udpSocket: socket,
          remoteAddress: rinfo.address,
          remotePort: rinfo.port,
          sessionKey,
          udpSessions
        });

        this.sendJson(agentWs, {
          type: 'open',
          protocol: 'udp',
          connId,
          targetHost: binding.target_host || '127.0.0.1',
          targetPort: Number(binding.local_port)
        });
      }

      session.lastSeenAt = Date.now();
      
      // Send UDP data using binary format instead of base64
      // Format: [1 byte msg type: 0x02] [4 bytes connId length] [connId string] [binary data]
      const connIdBuf = Buffer.from(session.connId, 'utf8');
      const msgType = Buffer.from([0x02]); // 0x02 = UDP data
      const lenBuf = Buffer.allocUnsafe(4);
      lenBuf.writeUInt32BE(connIdBuf.length, 0);
      
      const frame = Buffer.concat([msgType, lenBuf, connIdBuf, msg]);
      agentWs.send(frame, { binary: true }, (err) => {
        if (err && err.code === 'ENOTOPEN') {
          this.cleanupConnection(session.connId);
        }
      });
    });

    socket.on('error', (error) => {
      this.logger.error({ error, bindingId: binding.id }, '[TunnelRelay] UDP listener error');
    });

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(Number(binding.public_port), '0.0.0.0', () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });

    this.bindingServers.set(binding.id, { protocol: 'udp', socket, binding, udpSessions, cleanupTimer });
    this.logger.info({ bindingId: binding.id, protocol: 'udp', publicPort: binding.public_port }, '[TunnelRelay] Binding listener started');
  }

  handleAgentMessage(agentId, raw) {
    // Handle both binary frames and JSON messages for compatibility
    if (Buffer.isBuffer(raw)) {
      return this.handleBinaryMessage(agentId, raw);
    }
    
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

    if (message.type === 'data') {
      if (typeof message.data !== 'string') return;
      const payload = Buffer.from(message.data, 'base64');

      if (entry.kind === 'udp') {
        entry.udpSocket.send(payload, entry.remotePort, entry.remoteAddress);
        return;
      }

      const socket = entry.clientSocket;
      if (!socket || socket.destroyed) {
        this.cleanupConnection(connId);
        return;
      }

      // Implement backpressure on write
      if (!socket.write(payload)) {
        // Buffer full, agent should pause
      }
      return;
    }

    if (message.type === 'close') {
      if (entry.kind === 'udp') {
        this.cleanupConnection(connId);
        return;
      }

      const socket = entry.clientSocket;
      if (socket && !socket.destroyed) {
        socket.end();
      }
      this.cleanupConnection(connId);
    }
  }

  handleBinaryMessage(agentId, raw) {
    // Binary message format:
    // [1 byte msg type] [4 bytes connId length] [connId string] [payload...]
    // msg type: 0x01 = TCP data, 0x02 = UDP data, 0x03 = close
    
    if (raw.length < 5) return;
    
    const msgType = raw[0];
    const connIdLen = raw.readUInt32BE(1);
    
    if (raw.length < 5 + connIdLen) return;
    
    const connId = raw.toString('utf8', 5, 5 + connIdLen);
    const payload = raw.subarray(5 + connIdLen);
    
    const entry = this.connections.get(connId);
    if (!entry || entry.agentId !== agentId) return;
    
    if (msgType === 0x03) { // close
      if (entry.kind === 'udp') {
        this.cleanupConnection(connId);
        return;
      }
      
      const socket = entry.clientSocket;
      if (socket && !socket.destroyed) {
        socket.end();
      }
      this.cleanupConnection(connId);
      return;
    }
    
    if (msgType === 0x02) { // UDP data
      if (entry.kind === 'udp') {
        entry.udpSocket.send(payload, entry.remotePort, entry.remoteAddress, (err) => {
          if (err && err.code === 'ENOTOPEN') {
            this.cleanupConnection(connId);
          }
        });
      }
      return;
    }
    
    if (msgType === 0x01) { // TCP data
      const socket = entry.clientSocket;
      if (!socket || socket.destroyed) {
        this.cleanupConnection(connId);
        return;
      }
      
      // Implement backpressure: check write return value
      if (!socket.write(payload)) {
        // Socket buffer is full, agent should receive backpressure feedback
        // Could send 0x04 (backpressure) message back to agent
      }
      return;
    }
  }

  closeAgentConnections(agentId) {
    for (const [connId, entry] of this.connections.entries()) {
      if (entry.agentId !== agentId) continue;

      if (entry.kind === 'udp') {
        if (entry.udpSessions && entry.sessionKey) {
          entry.udpSessions.delete(entry.sessionKey);
        }
        this.connections.delete(connId);
        continue;
      }

      if (entry.clientSocket && !entry.clientSocket.destroyed) {
        entry.clientSocket.destroy();
      }
      this.connections.delete(connId);
    }
    
    // Clean up drain check intervals for this agent's WebSocket
    const ws = this.agentSockets.get(agentId);
    if (ws && ws._drainCheck) {
      clearInterval(ws._drainCheck);
      ws._drainCheck = null;
    }
  }

  disconnectAgent(agentId, code = 1008, reason = 'Agent revoked') {
    const ws = this.agentSockets.get(agentId);
    if (!ws) return;

    this.agentSockets.delete(agentId);
    this.closeAgentConnections(agentId);

    if (ws.readyState === 0 || ws.readyState === 1) {
      try {
        ws.close(code, reason);
      } catch {
        // Ignore close errors while forcefully disconnecting.
      }
    }
  }

  cleanupConnection(connId) {
    const entry = this.connections.get(connId);
    if (!entry) return;

    if (entry.kind === 'udp' && entry.udpSessions && entry.sessionKey) {
      entry.udpSessions.delete(entry.sessionKey);
    }

    this.connections.delete(connId);
  }

  sendJson(ws, payload) {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify(payload));
  }

  async stop() {
    for (const entry of this.bindingServers.values()) {
      if (entry.protocol === 'udp') {
        clearInterval(entry.cleanupTimer);
        entry.socket.close();
        continue;
      }

      await new Promise((resolve) => entry.server.close(() => resolve()));
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
