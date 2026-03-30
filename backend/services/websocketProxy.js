import WebSocket, { WebSocketServer } from 'ws';
import net from 'net';
import tls from 'tls';
import { config } from '../config/config.js';

class WebSocketProxy {
  constructor() {
    this.activeConnections = new Map();
  }

  async handleUpgrade(req, socket, head, backend, clientIp) {
    const connectionId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;

    console.log(`[WebSocketProxy] Upgrading ${connectionId} -> ${backend.target_host}:${backend.target_port} (${backend.target_protocol})`);

    if (backend.target_protocol === 'http' || backend.target_protocol === 'https') {
      return this.handleUpgradeWithTunnel(req, socket, head, backend, connectionId, clientIp);
    }

    try {
      const backendProtocol = backend.target_protocol === 'https' ? 'wss' : 'ws';
      const backendUrl = `${backendProtocol}://${backend.target_host}:${backend.target_port}${req.url}`;

      const proxyHeaders = this.buildProxyHeaders(req, clientIp);
      const backendWs = new WebSocket(backendUrl, {
        headers: proxyHeaders,
        rejectUnauthorized: !config.proxy.allowInsecureBackends
      });

      backendWs.on('error', (error) => {
        console.error(`[WebSocketProxy] Backend error for ${connectionId}:`, error.message);
        socket.destroy();
        this.activeConnections.delete(connectionId);
      });

      backendWs.on('open', () => {
        console.log(`[WebSocketProxy] Backend connected for ${connectionId}`);

        const wss = new WebSocketServer({ noServer: true });
        wss.handleUpgrade(req, socket, head, (clientWs) => {
          console.log(`[WebSocketProxy] Client upgraded for ${connectionId}`);

          this.activeConnections.set(connectionId, {
            client: clientWs,
            backend: backendWs,
            startTime: Date.now(),
            bytesReceived: 0,
            bytesSent: 0
          });

          clientWs.on('message', (data, isBinary) => {
            if (backendWs.readyState === WebSocket.OPEN) {
              backendWs.send(data, { binary: isBinary });
              const conn = this.activeConnections.get(connectionId);
              if (conn) conn.bytesSent += data.length;
            }
          });

          backendWs.on('message', (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: isBinary });
              const conn = this.activeConnections.get(connectionId);
              if (conn) conn.bytesReceived += data.length;
            }
          });

          clientWs.on('close', (code, reason) => {
            console.log(`[WebSocketProxy] Client closed ${connectionId} (code: ${code})`);
            if (backendWs.readyState === WebSocket.OPEN) {
              backendWs.close(code, reason);
            }
            this.activeConnections.delete(connectionId);
          });

          backendWs.on('close', (code, reason) => {
            console.log(`[WebSocketProxy] Backend closed ${connectionId} (code: ${code})`);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(code, reason);
            }
            this.activeConnections.delete(connectionId);
          });

          clientWs.on('error', (error) => {
            console.error(`[WebSocketProxy] Client error for ${connectionId}:`, error.message);
            backendWs.close();
            this.activeConnections.delete(connectionId);
          });

          const pingInterval = setInterval(() => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.ping();
            } else {
              clearInterval(pingInterval);
            }
          }, 30000);

          clientWs.on('pong', () => {});
        });
      });

      const timeout = setTimeout(() => {
        if (backendWs.readyState === WebSocket.CONNECTING) {
          console.error(`[WebSocketProxy] Backend connection timeout for ${connectionId}`);
          backendWs.terminate();
          socket.destroy();
          this.activeConnections.delete(connectionId);
        }
      }, 10000);

      backendWs.on('open', () => clearTimeout(timeout));
    } catch (error) {
      console.error(`[WebSocketProxy] Upgrade failed for ${connectionId}:`, error.message);
      socket.destroy();
      this.activeConnections.delete(connectionId);
    }
  }

  handleUpgradeWithTunnel(req, socket, head, backend, connectionId, clientIp) {
    console.log(`[WebSocketProxy] Using TCP tunnel mode for ${connectionId}`);

    const isSecure = backend.target_protocol === 'https';
    const backendSocket = isSecure
      ? tls.connect({
          host: backend.target_host,
          port: backend.target_port,
          rejectUnauthorized: !config.proxy.allowInsecureBackends,
          servername: req.headers.host?.split(':')[0] || backend.target_host
        })
      : net.connect({
          host: backend.target_host,
          port: backend.target_port
        });

    let backendConnected = false;

    const sendUpgradeRequest = () => {
      backendConnected = true;
      console.log(`[WebSocketProxy] Backend connected for ${connectionId} (secure: ${isSecure})`);

      const upgradeRequest = this.buildUpgradeRequest(req, backend, clientIp);
      backendSocket.write(upgradeRequest);

      if (head && head.length > 0) {
        backendSocket.write(head);
      }
    };

    if (isSecure) {
      backendSocket.on('secureConnect', () => {
        console.log(`[WebSocketProxy] TLS tunnel established for ${connectionId}`);
        sendUpgradeRequest();
      });
    } else {
      backendSocket.on('connect', () => {
        console.log(`[WebSocketProxy] TCP tunnel connected to backend for ${connectionId}`);
        sendUpgradeRequest();
      });
    }

    backendSocket.on('data', (data) => {
      if (!socket.destroyed) {
        socket.write(data);
      }
    });

    socket.on('data', (data) => {
      if (!backendSocket.destroyed) {
        backendSocket.write(data);
      }
    });

    backendSocket.on('error', (error) => {
      console.error(`[WebSocketProxy] Backend socket error for ${connectionId}:`, error.message);
      if (!socket.destroyed) {
        socket.destroy();
      }
    });

    socket.on('error', (error) => {
      console.error(`[WebSocketProxy] Client socket error for ${connectionId}:`, error.message);
      if (!backendSocket.destroyed) {
        backendSocket.destroy();
      }
    });

    backendSocket.on('close', () => {
      console.log(`[WebSocketProxy] Backend socket closed for ${connectionId}`);
      if (!socket.destroyed) {
        socket.destroy();
      }
      this.activeConnections.delete(connectionId);
    });

    socket.on('close', () => {
      console.log(`[WebSocketProxy] Client socket closed for ${connectionId}`);
      if (!backendSocket.destroyed) {
        backendSocket.destroy();
      }
      this.activeConnections.delete(connectionId);
    });

    const timeout = setTimeout(() => {
      if (!backendConnected) {
        console.error(`[WebSocketProxy] Backend connection timeout for ${connectionId}`);
        backendSocket.destroy();
        socket.destroy();
      }
    }, 10000);

    if (isSecure) {
      backendSocket.on('secureConnect', () => clearTimeout(timeout));
    } else {
      backendSocket.on('connect', () => clearTimeout(timeout));
    }

    this.activeConnections.set(connectionId, {
      client: socket,
      backend: backendSocket,
      startTime: Date.now(),
      mode: 'tunnel'
    });
  }

  buildUpgradeRequest(req, backend, clientIp) {
    const lines = [];
    lines.push(`${req.method} ${req.url} HTTP/1.1`);

    // SECURITY: Whitelist safe headers only (prevent header injection)
    const safeHeaders = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'cache-control',
      'sec-websocket-version',
      'sec-websocket-key',
      'sec-websocket-protocol',
      'sec-websocket-extensions',
      'origin',
      'cookie'
    ];

    const headers = {};

    // Only copy whitelisted headers
    for (const header of safeHeaders) {
      if (req.headers[header]) {
        // SECURITY: Remove \r\n characters to prevent CRLF injection
        const value = String(req.headers[header]).replace(/[\r\n]/g, '');
        headers[header] = value;
      }
    }

    // Set required WebSocket headers
    headers['host'] = `${backend.target_host}:${backend.target_port}`;
    headers['upgrade'] = 'websocket';
    headers['connection'] = 'Upgrade';

    // Set proxy headers
    headers['x-forwarded-for'] = clientIp || req.socket.remoteAddress;
    headers['x-real-ip'] = clientIp || req.socket.remoteAddress;
    headers['x-forwarded-proto'] = req.connection.encrypted ? 'https' : 'http';
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-proxied-by'] = 'NebulaProxy/1.0';

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) {
        lines.push(`${key}: ${value}`);
      }
    }

    lines.push('');
    lines.push('');
    return lines.join('\r\n');
  }

  buildProxyHeaders(req, clientIp) {
    const headers = {};
    const forwardHeaders = [
      'cookie',
      'authorization',
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'origin',
      'sec-websocket-protocol',
      'sec-websocket-extensions'
    ];

    for (const header of forwardHeaders) {
      if (req.headers[header]) {
        headers[header] = req.headers[header];
      }
    }

    headers['x-forwarded-for'] = clientIp || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    headers['x-real-ip'] = clientIp || req.socket.remoteAddress;
    headers['x-forwarded-proto'] = req.connection.encrypted ? 'https' : 'http';
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-proxied-by'] = 'NebulaProxy/1.0';
    if (req.headers.host) {
      headers.host = req.headers.host;
    }

    return headers;
  }

  getStats() {
    const stats = {
      activeConnections: this.activeConnections.size,
      connections: []
    };

    for (const [id, conn] of this.activeConnections.entries()) {
      stats.connections.push({
        id,
        duration: Date.now() - conn.startTime,
        bytesReceived: conn.bytesReceived,
        bytesSent: conn.bytesSent,
        clientState: this.getWebSocketState(conn.client),
        backendState: this.getWebSocketState(conn.backend)
      });
    }

    return stats;
  }

  getWebSocketState(ws) {
    if (!ws || typeof ws.readyState !== 'number') {
      return 'UNKNOWN';
    }

    switch (ws.readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING';
      case WebSocket.OPEN: return 'OPEN';
      case WebSocket.CLOSING: return 'CLOSING';
      case WebSocket.CLOSED: return 'CLOSED';
      default: return 'UNKNOWN';
    }
  }

  closeAll() {
    console.log(`[WebSocketProxy] Closing ${this.activeConnections.size} active connections`);

    for (const [id, conn] of this.activeConnections.entries()) {
      try {
        conn.client.close?.(1001, 'Server shutdown');
        conn.backend.close?.(1001, 'Server shutdown');
      } catch (error) {
        console.error(`[WebSocketProxy] Error closing connection ${id}:`, error.message);
      }
    }

    this.activeConnections.clear();
  }
}

export const websocketProxy = new WebSocketProxy();
