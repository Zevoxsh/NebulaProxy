import { WebSocketServer } from 'ws';
import { URL } from 'url';

class WebSocketManager {
  constructor(server, logger) {
    this.logger = logger;
    this.clients = new Set();         // all active ws connections
    this.userClients = new Map();     // userId -> Set<ws>
    this.wsUser = new Map();          // ws -> userId
    this.ipConnections = new Map();   // ip -> connection count
    this.MAX_CONNECTIONS_PER_IP = 10;

    this.server = server;
    this.wss = new WebSocketServer({ noServer: true });

    this.setupWebSocketServer();
  }

  _getPathname(req) {
    try {
      return new URL(req.url || '', 'http://localhost').pathname;
    } catch {
      return '';
    }
  }

  shouldHandleUpgrade(req) {
    return this._getPathname(req) === '/ws/notifications';
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  _getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    return (forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
  }

  _cleanup(ws) {
    this.clients.delete(ws);

    // Decrement per-IP counter
    const ip = ws._clientIp;
    if (ip) {
      const count = (this.ipConnections.get(ip) || 1) - 1;
      if (count <= 0) {
        this.ipConnections.delete(ip);
      } else {
        this.ipConnections.set(ip, count);
      }
    }

    // Remove from user room
    const userId = this.wsUser.get(ws);
    if (userId) {
      const userSet = this.userClients.get(userId);
      if (userSet) {
        userSet.delete(ws);
        if (userSet.size === 0) {
          this.userClients.delete(userId);
        }
      }
      this.wsUser.delete(ws);
    }
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      // Per-IP connection rate limiting
      const clientIp = this._getClientIp(req);
      const ipCount = (this.ipConnections.get(clientIp) || 0) + 1;

      if (ipCount > this.MAX_CONNECTIONS_PER_IP) {
        this.logger.warn({ clientIp }, 'WebSocket: connection limit reached for IP');
        ws.close(1008, 'Too many connections from this IP');
        return;
      }

      this.ipConnections.set(clientIp, ipCount);
      this.clients.add(ws);
      ws._clientIp = clientIp;

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connected',
        message: 'Connected to NebulaProxy notifications'
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          this.logger.error('Failed to parse WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.logger.info('WebSocket client disconnected');
        this._cleanup(ws);
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error:', error);
        this._cleanup(ws);
      });

      // Ping/Pong for keep-alive
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
    });

    // Ping interval to detect dead connections
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this._cleanup(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    this.logger.info('WebSocket server initialized on /ws/notifications');
  }

  handleMessage(ws, data) {
    // Subscribe to a user-specific notification room
    // Client sends: { type: 'subscribe', userId: '123' }
    if (data.type === 'subscribe' && data.userId) {
      const userId = String(data.userId);

      // Remove from old room if re-subscribing
      const oldUserId = this.wsUser.get(ws);
      if (oldUserId && oldUserId !== userId) {
        const oldSet = this.userClients.get(oldUserId);
        if (oldSet) {
          oldSet.delete(ws);
          if (oldSet.size === 0) this.userClients.delete(oldUserId);
        }
      }

      // Register in user room
      if (!this.userClients.has(userId)) {
        this.userClients.set(userId, new Set());
      }
      this.userClients.get(userId).add(ws);
      this.wsUser.set(ws, userId);

      this.sendToClient(ws, { type: 'subscribed', userId });
      return;
    }

    this.logger.debug('Received WebSocket message:', data);
  }

  sendToClient(ws, data) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast notification to all connected clients
   */
  broadcast(notification) {
    const message = {
      type: 'notification',
      payload: notification
    };

    this.logger.info(`Broadcasting notification to ${this.clients.size} clients:`, notification.title);

    this.clients.forEach((client) => {
      this.sendToClient(client, message);
    });
  }

  /**
   * Broadcast raw message to all connected clients (without wrapping)
   * Used for real-time traffic logs
   */
  broadcastRaw(message) {
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(messageStr);
      }
    });
  }

  /**
   * Send notification to a specific user's connections only.
   * If the user has not subscribed to a room, falls back to broadcast.
   */
  sendToUser(userId, notification) {
    const userSet = this.userClients.get(String(userId));

    if (!userSet || userSet.size === 0) {
      // Fallback: broadcast to all (backwards compatible with older clients)
      this.broadcast(notification);
      return;
    }

    const message = {
      type: 'notification',
      payload: notification
    };

    userSet.forEach((ws) => {
      this.sendToClient(ws, message);
    });
  }

  /**
   * Get number of connected clients
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Shutdown WebSocket server
   */
  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.clients.forEach((client) => {
      client.close();
    });

    this.wss.close(() => {
      this.logger.info('WebSocket server closed');
    });
  }
}

export default WebSocketManager;
