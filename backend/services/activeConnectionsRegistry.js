// @ts-check
/**
 * Active Connections Registry — "is this connection open right now."
 *
 * services/liveTrafficService.js answers a different question ("who recently
 * connected") via a Redis hash updated once at connect time, so a session
 * open for hours still shows a stale `lastSeen`. This registry is purpose
 * -built for the live/open case: pure in-memory, populated by tcpProxy.js /
 * udpProxy.js / minecraftProxy.js at connection-open and cleared at their
 * existing teardown points. No persistence, no Redis — ephemeral runtime
 * state that resets on restart, same precedent as minecraftProxy.js's
 * `onlinePlayers` Set.
 */

const connections = new Map(); // connectionId -> { domainId, protocol, clientIp, connectedAt, label }

let counter = 0;
export function nextConnectionId(protocol) {
  counter += 1;
  return `${protocol}:${counter}:${Date.now()}`;
}

export function register(connectionId, { domainId, protocol, clientIp, connectedAt, label }) {
  connections.set(connectionId, { domainId, protocol, clientIp, connectedAt: connectedAt || Date.now(), label: label || null });
}

export function unregister(connectionId) {
  connections.delete(connectionId);
}

export function getByDomain(domainId) {
  const out = [];
  for (const [connectionId, entry] of connections) {
    if (entry.domainId === domainId) out.push({ connectionId, ...entry });
  }
  out.sort((a, b) => a.connectedAt - b.connectedAt);
  return out;
}

export function getCount(domainId) {
  let n = 0;
  for (const entry of connections.values()) {
    if (entry.domainId === domainId) n += 1;
  }
  return n;
}
