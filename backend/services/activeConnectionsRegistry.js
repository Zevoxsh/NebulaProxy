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

// Injected once at boot (server/startupSequence.js), same setter-injection
// convention as logBroadcastService.setWebSocketManager — this module is a
// plain function-exporting singleton, not a class, so the manager lives in
// module scope rather than on `this`.
let wsManager = null;
export function setWebSocketManager(manager) {
  wsManager = manager;
}

function broadcast(type, payload) {
  if (!wsManager) return;
  try {
    wsManager.broadcastRaw({ type, payload });
  } catch {
    // Never let a broadcast failure break connection tracking.
  }
}

// Exposed so minecraftProxy.js can piggyback player_online/player_offline
// events on the same wsManager reference this module already holds via
// setWebSocketManager(), instead of wiring a second injection path just for
// that. Not connection-registry state, but the same broadcast plumbing.
export function broadcastEvent(type, payload) {
  broadcast(type, payload);
}

// Periodic snapshot of live byte counters, broadcast at a fixed cadence
// rather than on every addBytes() call — a busy TCP connection can fire
// many 'data' events per second, so broadcasting per-chunk would flood the
// socket. Skipped entirely when there's nothing connected. Started lazily
// on first register() and left running (cheap no-op tick when empty) rather
// than started/stopped around every connection — simpler, and this module
// has no other lifecycle hook to stop it on anyway.
const SNAPSHOT_INTERVAL_MS = 3000;
let snapshotTimer = null;
function ensureBroadcastTimer() {
  if (snapshotTimer) return;
  snapshotTimer = setInterval(() => {
    if (!wsManager || connections.size === 0) return;
    const snapshot = [];
    for (const [connectionId, entry] of connections) {
      snapshot.push({ connectionId, domainId: entry.domainId, bytesIn: entry.bytesIn, bytesOut: entry.bytesOut });
    }
    broadcast('connections_snapshot', { connections: snapshot });
  }, SNAPSHOT_INTERVAL_MS);
  snapshotTimer.unref?.();
}

// `close` is an optional zero-arg callback that forcibly tears down this
// specific connection (used by kick()) — each proxy passes its own existing
// teardown function/closure, never duplicated here.
export function register(connectionId, { domainId, protocol, clientIp, connectedAt, label, close }) {
  const connectedAtMs = connectedAt || Date.now();
  connections.set(connectionId, {
    domainId,
    protocol,
    clientIp,
    connectedAt: connectedAtMs,
    label: label || null,
    close: typeof close === 'function' ? close : null,
    bytesIn: 0,
    bytesOut: 0
  });
  broadcast('connection_open', { domainId, connectionId, protocol, clientIp, label: label || null, connectedAt: connectedAtMs });
  ensureBroadcastTimer();
}

export function unregister(connectionId) {
  const entry = connections.get(connectionId);
  connections.delete(connectionId);
  if (entry) {
    broadcast('connection_close', { domainId: entry.domainId, connectionId });
  }
}

// Accumulates live byte counters on a connection entry — a parallel counter
// to whatever each proxy already tracks locally for its final request-log
// write. Safe to call after the connection has been unregistered (a data
// event can race with teardown on a closing socket) — no-ops silently.
// Broadcasting of these counters happens on the periodic snapshot timer
// above, not here — see its comment for why.
export function addBytes(connectionId, inDelta = 0, outDelta = 0) {
  const entry = connections.get(connectionId);
  if (!entry) return;
  entry.bytesIn += inDelta;
  entry.bytesOut += outDelta;
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
