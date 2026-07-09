// Auto-extracted from proxyManager.js — do not edit directly.
// Mixed into ProxyManager.prototype in proxyManager.js.

import dgram from 'dgram';
import { lts } from '../proxyContext.js';
import { logger } from '../../utils/logger.js';
import { database } from '../database.js';
import { loadBalancer } from '../loadBalancer.js';
import { urlFilterService } from '../urlFilterService.js';
import { logBatchQueue } from '../logBatchQueue.js';
import * as activeConnections from '../activeConnectionsRegistry.js';

export class UdpProxy {
// ==================== UDP PROXY ====================

/**
 * Build a HAProxy PROXY Protocol v2 binary header for a UDP packet.
 * Used to forward the real client IP to Geyser (use-proxy-protocol: true).
 *
 * Format (IPv4, 28 bytes total):
 *   12B signature + 1B version/cmd + 1B family + 2B addr_len + 4B src + 4B dst + 2B src_port + 2B dst_port
 */
_buildProxyV2Header(srcIp, srcPort, dstIp, dstPort) {
  const isIPv6 = srcIp.includes(':');
  const sig = Buffer.from([0x0D,0x0A,0x0D,0x0A,0x00,0x0D,0x0A,0x51,0x55,0x49,0x54,0x0A]);
  const addrLen = isIPv6 ? 36 : 12;
  const header = Buffer.alloc(16 + addrLen);

  sig.copy(header, 0);
  header[12] = 0x21;                       // version 2, PROXY command
  header[13] = isIPv6 ? 0x22 : 0x12;       // AF_INET(6) + DGRAM
  header.writeUInt16BE(addrLen, 14);

  if (isIPv6) {
    const expand = (ip) => {
      const halves = ip.split('::');
      const left = halves[0] ? halves[0].split(':') : [];
      const right = halves[1] ? halves[1].split(':') : [];
      const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
      const buf = Buffer.alloc(16);
      groups.forEach((g, i) => { const v = parseInt(g || '0', 16); buf[i*2] = v>>8; buf[i*2+1] = v&0xFF; });
      return buf;
    };
    expand(srcIp).copy(header, 16);
    expand(dstIp).copy(header, 32);
    header.writeUInt16BE(srcPort, 48);
    header.writeUInt16BE(dstPort, 50);
  } else {
    const s = srcIp.split('.').map(Number);
    const d = (dstIp || '0.0.0.0').split('.').map(Number);
    header[16]=s[0]; header[17]=s[1]; header[18]=s[2]; header[19]=s[3];
    header[20]=d[0]; header[21]=d[1]; header[22]=d[2]; header[23]=d[3];
    header.writeUInt16BE(srcPort, 24);
    header.writeUInt16BE(dstPort, 26);
  }

  return header;
}

/**
 * Start a UDP proxy
 * Multi-client bidirectional forwarding with load balancing
 */
_startUdpProxy(domain) {
  const serverSocket = dgram.createSocket('udp4');
  const upstreams = new Map(); // clientKey -> { upstream, timeout, metrics, backendHost, backendPort }

    serverSocket.on('error', (err) => {
      logger.error(`[UDP Proxy ${domain.id}] Server error:`, err.message);
  });

  serverSocket.on('message', async (msg, rinfo) => {
    const clientKey = `${rinfo.address}:${rinfo.port}`;
    const clientIp = this._normalizeIp(rinfo.address);
    let upstreamEntry = upstreams.get(clientKey);

    if (!upstreamEntry) {
      try {
        const networkAccess = await urlFilterService.checkNetworkAccess(domain.id, clientIp);
        if (networkAccess.blocked) {
          const message = networkAccess.response?.message || 'Connection blocked by network policy';
          logger.warn(`[UDP Proxy ${domain.id}] Blocked client ${clientKey}: ${message}`);

          logBatchQueue.queueRequestLog({
            domainId: domain.id,
            hostname: domain.hostname,
            method: 'UDP',
            path: 'network-policy',
            queryString: null,
            statusCode: 403,
            responseTime: 0,
            responseSize: 0,
            ipAddress: clientIp,
            userAgent: null,
            referer: null,
            requestHeaders: {
              'bytes-received': msg.length,
              'bytes-sent': 0
            },
            responseHeaders: {},
            errorMessage: message
          });

          return;
        }
      } catch (err) {
        logger.error(`[UDP Proxy ${domain.id}] Network policy check failed:`, err.message);
      }

      // New client: select backend via load balancing and create dedicated upstream socket
      let backendHost, backendPort;
      try {
        const target = await this._selectBackendForDomain(domain, clientIp, 'udp');
        backendHost = target.hostname;
        backendPort = target.port;
      } catch (err) {
        logger.error(`[UDP Proxy ${domain.id}] Backend selection failed:`, err.message);
        return;
      }

      const upstream = dgram.createSocket('udp4');

      // Initialize metrics for this client
      const metrics = {
        startTime: Date.now(),
        bytesReceived: 0,
        bytesSent: 0,
        errorMessage: null
      };

      upstream.on('message', (upMsg) => {
        // Track bytes sent to client
        metrics.bytesSent += upMsg.length;

        // Forward response back to original client
        serverSocket.send(upMsg, rinfo.port, rinfo.address, (err) => {
          if (err) {
            logger.error(`[UDP Proxy ${domain.id}] Failed to forward response to ${clientKey}:`, err.message);
            metrics.errorMessage = `Forward error: ${err.message}`;
          }
        });
      });

      upstream.on('error', (err) => {
        logger.error(`[UDP Proxy ${domain.id}] Upstream error for ${clientKey}:`, err.message);
        metrics.errorMessage = `Upstream error: ${err.message}`;
      });

      const connectionId = activeConnections.nextConnectionId('udp');
      upstreamEntry = { upstream, timeout: null, metrics, clientIp, backendHost, backendPort, proxySent: false, connectionId };
      upstreams.set(clientKey, upstreamEntry);
      // Live traffic tracking (fire-and-forget)
      { const s = lts(); if (s) s.recordHit(domain.id, clientIp, 'udp', `${backendHost}:${backendPort}`); }
      activeConnections.register(connectionId, {
        domainId: domain.id,
        protocol: 'udp',
        clientIp,
        connectedAt: metrics.startTime,
        label: `${backendHost}:${backendPort}`
      });
      logger.info(`[UDP Proxy ${domain.id}] New client ${clientKey} -> ${backendHost}:${backendPort}`);
    }

    // Track bytes received from client
    upstreamEntry.metrics.bytesReceived += msg.length;

      // Reset timeout for this client (inactivity)
      if (this.UDP_CLIENT_TIMEOUT > 0) {
        if (upstreamEntry.timeout) clearTimeout(upstreamEntry.timeout);
        upstreamEntry.timeout = setTimeout(() => {
          // Log UDP session before cleanup
          const responseTime = Date.now() - upstreamEntry.metrics.startTime;
          database.createRequestLog({
            domainId: domain.id,
            hostname: domain.hostname,
            method: 'UDP',
            path: `${upstreamEntry.backendHost}:${upstreamEntry.backendPort}`,
            queryString: null,
            statusCode: upstreamEntry.metrics.errorMessage ? 502 : 200,
            responseTime: responseTime,
            responseSize: upstreamEntry.metrics.bytesSent,
            ipAddress: upstreamEntry.clientIp,
            userAgent: null,
            referer: null,
            requestHeaders: {
              'bytes-received': upstreamEntry.metrics.bytesReceived,
              'bytes-sent': upstreamEntry.metrics.bytesSent
            },
            responseHeaders: {},
            errorMessage: upstreamEntry.metrics.errorMessage
          }).catch((err) => {
            logger.error('[ProxyManager] Failed to write UDP log:', err);
          });

          try {
            upstreamEntry.upstream.close();
          } catch (e) {
            // Ignore
          }
          activeConnections.unregister(upstreamEntry.connectionId);
          upstreams.delete(clientKey);
          logger.info(`[UDP Proxy ${domain.id}] Client ${clientKey} timed out after ${this.UDP_CLIENT_TIMEOUT / 1000}s`);
        }, this.UDP_CLIENT_TIMEOUT);
      }

    // Forward packet to backend
    // If Geyser PROXY Protocol v2 is enabled, prepend the binary header to the FIRST
    // packet so Geyser can read the real Bedrock client IP (use-proxy-protocol: true).
    let packetToSend = msg;
    if (domain.geyser_proxy_protocol && !upstreamEntry.proxySent) {
      upstreamEntry.proxySent = true;
      const proxyHdr = this._buildProxyV2Header(
        upstreamEntry.clientIp, rinfo.port,
        upstreamEntry.backendHost, upstreamEntry.backendPort
      );
      packetToSend = Buffer.concat([proxyHdr, msg]);
    }
    upstreamEntry.upstream.send(packetToSend, upstreamEntry.backendPort, upstreamEntry.backendHost, (err) => {
      if (err) {
        logger.error(`[UDP Proxy ${domain.id}] Failed to forward to backend:`, err.message);
        upstreamEntry.metrics.errorMessage = `Backend forward error: ${err.message}`;
      }
    });
  });

  // Get initial backend info for logging
  const defaultTarget = loadBalancer.getBackendTarget(domain, null, 'udp');
  serverSocket.bind(domain.external_port, '::', () => {
    const lbStatus = domain.load_balancing_enabled ? ' (load balanced)' : '';
    logger.info(`[UDP Proxy ${domain.id}] Listening on [::]:${domain.external_port} -> ${defaultTarget.hostname}:${defaultTarget.port}${lbStatus}`);
  });

  this.proxies.set(domain.id, {
    type: 'udp',
    server: serverSocket,
    upstreams,
    meta: domain
  });

  return serverSocket;
}
}
