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

const connections = new Map(); // connectionId -> { domainId, protocol, clientIp, connectedAt, label, close }

let counter = 0;
export function nextConnectionId(protocol) {
  counter += 1;
  return `${protocol}:${counter}:${Date.now()}`;
}

// `close` is an optional zero-arg callback that forcibly tears down this
// specific connection (used by kick()) — each proxy passes its own existing
// teardown function/closure, never duplicated here.
export function register(connectionId, { domainId, protocol, clientIp, connectedAt, label, close }) {
  connections.set(connectionId, {
    domainId,
    protocol,
    clientIp,
    connectedAt: connectedAt || Date.now(),
    label: label || null,
    close: typeof close === 'function' ? close : null
  });
}

export function unregister(connectionId) {
  connections.delete(connectionId);
}

// Forcibly closes a specific connection via its registered `close` callback.
// Returns true if the connection existed (and was asked to close), false if
// no such connection is currently tracked.
export function kick(connectionId) {
  const entry = connections.get(connectionId);
  if (!entry) return false;
  try {
    entry.close?.();
  } catch (err) {
    // Swallow — the caller only needs to know the connection was found;
    // whatever cleanup path each proxy uses handles its own logging.
  }
  return true;
}

export function getByDomain(domainId) {
  const out = [];
  for (const [connectionId, entry] of connections) {
    if (entry.domainId !== domainId) continue;
    // Never leak the raw close callback into API responses — this is the
    // only place external code reads the registry, so strip it here.
    const { close, ...safe } = entry;
    out.push({ connectionId, ...safe });
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
