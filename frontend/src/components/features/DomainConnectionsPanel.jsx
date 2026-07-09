import { useState, useEffect, useCallback, useRef } from 'react';
import { Cable, PowerOff, ArrowDown, ArrowUp } from 'lucide-react';
import { domainAPI } from '../../api/client';
import { FlagImg } from '../../utils/flagCache';

const PROTOCOL_STYLE = {
  tcp:       { label: 'TCP',       bg: '#22D3EE18', border: '#22D3EE44', color: '#67E8F9' },
  udp:       { label: 'UDP',       bg: '#A78BFA18', border: '#A78BFA44', color: '#C4B5FD' },
  minecraft: { label: 'MINECRAFT', bg: '#9D4EDD18', border: '#9D4EDD44', color: '#C77DFF' }
};

// Mirrors DomainDetail.jsx's formatDuration — connection age is what matters
// here, not a request/response time, so the same "scale the unit to the
// magnitude" formatting applies (a session open for hours shouldn't render
// as raw ms).
function formatDuration(ms) {
  const n = Number(ms);
  if (!n || !Number.isFinite(n) || n < 0) return '0s';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  if (n < 3600000) {
    const m = Math.floor(n / 60000);
    const s = Math.round((n % 60000) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(n / 3600000);
  const m = Math.round((n % 3600000) / 60000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// bytes/sec -> "12.4 KB/s" style. `null` means "not enough samples yet" —
// rendered as a distinct placeholder rather than 0, since a fresh connection
// with a real 0 rate should look different from "still measuring."
function formatRate(bytesPerSec) {
  if (bytesPerSec === null || bytesPerSec === undefined || !Number.isFinite(bytesPerSec)) return null;
  const n = Math.max(0, bytesPerSec);
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
}

function ConnectionRow({ conn, now, onKick, kicking }) {
  const style = PROTOCOL_STYLE[conn.protocol] || PROTOCOL_STYLE.tcp;
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.02] transition-colors">
      <span
        className="px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
        style={{ background: style.bg, borderColor: style.border, color: style.color }}
      >
        {style.label}
      </span>
      {conn.country
        ? <FlagImg code={conn.country} title={conn.country} className="w-5 h-3.5 rounded-sm shrink-0" />
        : <span className="w-5 h-3.5 shrink-0" />}
      <span className="text-sm text-white/80 font-mono">{conn.clientIp}</span>
      {conn.label && (
        <span className="text-xs text-white/40 truncate">{conn.label}</span>
      )}
      <span className="ml-auto flex items-center gap-2.5 text-[11px] font-mono text-white/40 shrink-0" title="Débit (moyenne depuis le dernier rafraîchissement)">
        <span className="flex items-center gap-0.5">
          <ArrowDown className="w-3 h-3 text-[#67E8F9]" strokeWidth={2} />
          {formatRate(conn.rateIn) ?? '…'}
        </span>
        <span className="flex items-center gap-0.5">
          <ArrowUp className="w-3 h-3 text-[#C4B5FD]" strokeWidth={2} />
          {formatRate(conn.rateOut) ?? '…'}
        </span>
      </span>
      <span className="text-xs text-white/50 font-mono shrink-0">
        {formatDuration(now - conn.connectedAt)}
      </span>
      <button
        onClick={() => onKick(conn.connectionId)}
        disabled={kicking}
        title="Fermer cette connexion"
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#F87171] hover:bg-[#EF4444]/20 transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <PowerOff className="w-3.5 h-3.5" strokeWidth={1.5} />
        Kick
      </button>
    </div>
  );
}

// "Is this connection open right now" — distinct from the Trafic live tab
// (recent-hit history, can look stale for a long-lived session) and from
// the Joueurs tab (login identity, Minecraft-only). Polls like
// DomainPlayersPanel/DomainHealthPanel so it stays current while open.
export default function DomainConnectionsPanel({ domainId }) {
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [kickingId, setKickingId] = useState(null);

  // Previous poll's byte counters per connection, used to derive a live
  // rate (bytesDelta / timeDelta) — the backend only exposes cumulative
  // totals, so "live" throughput is computed here from two consecutive
  // samples rather than tracked server-side.
  const prevBytesRef = useRef({});

  // Mirrors `connections` so the WS handler (registered once per `domainId`
  // change, not per render) can read the latest list synchronously and call
  // setConnections(value) directly rather than setConnections(prevList =>
  // ...). That distinction matters: React 18 StrictMode double-invokes
  // functional setState updaters to catch impurities, and applyRates()'s
  // side effect (advancing prevBytesRef) is NOT safe to run twice for the
  // same tick — the second invocation would see a zero time-delta against
  // the baseline the first invocation just wrote, permanently stuck at
  // "not enough samples yet". Reading/writing outside the updater sidesteps
  // this entirely.
  const connectionsRef = useRef(null);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);

  // Bumped by every state-mutating event (WS message or a load() that
  // actually applied). load() captures this value before its request goes
  // out; if it's changed by the time the response arrives, a WS event (or
  // another load) landed in the meantime and is necessarily fresher than an
  // HTTP response reflecting the state at request-SEND time — applying the
  // stale response anyway is what caused the "works sometimes, needs a
  // refresh other times" bug (out-of-order async writes racing each other).
  const seqRef = useRef(0);

  // applyRates() is the same "derive a rate from two consecutive byte
  // samples" logic used by both the poll path and the WS snapshot path —
  // extracted so the WS-driven updates (now the primary source) and the
  // slow fallback poll compute rates identically.
  const applyRates = useCallback((raw, nowTs) => {
    const prev = prevBytesRef.current;
    const withRates = raw.map((c) => {
      const bytesIn = c.bytesIn || 0;
      const bytesOut = c.bytesOut || 0;
      const p = prev[c.connectionId];
      let rateIn = null;
      let rateOut = null;
      if (p) {
        const dtSec = (nowTs - p.ts) / 1000;
        if (dtSec > 0) {
          rateIn = (bytesIn - p.bytesIn) / dtSec;
          rateOut = (bytesOut - p.bytesOut) / dtSec;
        }
      }
      return { ...c, bytesIn, bytesOut, rateIn, rateOut };
    });
    const nextSnapshot = {};
    for (const c of withRates) {
      nextSnapshot[c.connectionId] = { bytesIn: c.bytesIn, bytesOut: c.bytesOut, ts: nowTs };
    }
    prevBytesRef.current = nextSnapshot;
    return withRates;
  }, []);

  const load = useCallback(async () => {
    if (!domainId) return;
    const seqAtStart = seqRef.current;
    try {
      const res = await domainAPI.getActiveConnections(domainId);
      // Something else (a WS event, or another load()) already mutated
      // state while this request was in flight — that view is newer than
      // this response, so don't clobber it with stale data.
      if (seqRef.current !== seqAtStart) return;
      const raw = res.data.connections || [];
      const nowTs = Date.now();
      const withRates = applyRates(raw, nowTs);
      connectionsRef.current = withRates;
      seqRef.current += 1;
      setConnections(withRates);
      setNow(nowTs);
    } catch (_) {
      // Fail quiet — best-effort context, not critical path
    } finally {
      setLoading(false);
    }
  }, [domainId, applyRates]);

  // WebSocket is the primary update path — connection_open/connection_close
  // land instantly, connections_snapshot (every ~3s server-side) drives the
  // throughput column. The poll below is only a slow reconciliation net for
  // whatever a missed/dropped WS message might leave stale — same pattern
  // as the reconnect-resync below. Same /ws/notifications channel and
  // connect/reconnect shape already used by RealtimeTraffic.jsx.
  useEffect(() => {
    if (!domainId) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/notifications`;
    let ws, reconnectTimeout, unmounted = false, hadOpenedBefore = false;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        // A reconnect (not the first connect) means we may have missed
        // open/close/snapshot events during the gap — resync immediately
        // rather than waiting for the next slow poll tick.
        if (hadOpenedBefore) load();
        hadOpenedBefore = true;
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (!msg || !msg.payload) return;
        // domainId here comes from useParams() (always a string, e.g. "35")
        // while the backend broadcasts domain.id as a number — compare as
        // strings on both sides rather than relying on ===.
        const sameDomain = (id) => String(id) === String(domainId);

        if (msg.type === 'connection_open' && sameDomain(msg.payload.domainId)) {
          const { connectionId, protocol, clientIp, label, connectedAt } = msg.payload;
          const list = connectionsRef.current || [];
          if (!list.some((c) => c.connectionId === connectionId)) {
            const next = [...list, { connectionId, protocol, clientIp, label, connectedAt, country: null, bytesIn: 0, bytesOut: 0, rateIn: null, rateOut: null }];
            connectionsRef.current = next;
            seqRef.current += 1;
            setConnections(next);
          }
          setNow(Date.now());
        } else if (msg.type === 'connection_close' && sameDomain(msg.payload.domainId)) {
          const { connectionId } = msg.payload;
          delete prevBytesRef.current[connectionId];
          const next = (connectionsRef.current || []).filter((c) => c.connectionId !== connectionId);
          connectionsRef.current = next;
          seqRef.current += 1;
          setConnections(next);
          setNow(Date.now());
        } else if (msg.type === 'connections_snapshot') {
          const mine = (msg.payload.connections || []).filter((c) => sameDomain(c.domainId));
          if (mine.length === 0) return;
          const prevList = connectionsRef.current;
          if (!prevList || prevList.length === 0) return;
          const nowTs = Date.now();
          const byId = new Map(mine.map((c) => [c.connectionId, c]));
          const rated = applyRates(
            prevList.map((c) => byId.has(c.connectionId) ? { ...c, ...byId.get(c.connectionId) } : c),
            nowTs
          );
          connectionsRef.current = rated;
          seqRef.current += 1;
          setConnections(rated);
          setNow(nowTs);
        }
      };
      ws.onclose = () => {
        if (!unmounted) reconnectTimeout = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { unmounted = true; clearTimeout(reconnectTimeout); if (ws) ws.close(); };
  }, [domainId, load, applyRates]);

  useEffect(() => {
    load();
    // Fallback reconciliation only — WS above is the primary live path.
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [load]);

  const handleKick = useCallback(async (connectionId) => {
    if (!window.confirm('Fermer cette connexion ?')) return;
    setKickingId(connectionId);
    // Optimistic: a kick should be near-instant, don't make the user wait
    // for the next 15s poll to see it gone. The following poll reconciles
    // either way if something went wrong.
    const next = (connectionsRef.current || []).filter((c) => c.connectionId !== connectionId);
    connectionsRef.current = next;
    seqRef.current += 1;
    setConnections(next);
    try {
      await domainAPI.kickConnection(domainId, connectionId);
    } catch (_) {
      // Fail quiet here too — the next poll will re-show it if the kick
      // didn't actually take effect server-side.
    } finally {
      setKickingId(null);
      load();
    }
  }, [domainId, load]);

  if (loading && connections === null) {
    return (
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-6">
        <div className="h-16 bg-white/[0.02] rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
          style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
          <Cable className="w-4 h-4" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-white">Connexions</p>
        <span className="text-xs text-white/40 ml-auto">
          {(connections || []).length} connexion{(connections || []).length === 1 ? '' : 's'} active{(connections || []).length === 1 ? '' : 's'}
        </span>
      </div>

      {!connections || connections.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-white/40">Aucune connexion active pour ce domaine en ce moment.</p>
        </div>
      ) : (
        <div>
          {connections.map((c) => (
            <ConnectionRow
              key={c.connectionId}
              conn={c}
              now={now}
              onKick={handleKick}
              kicking={kickingId === c.connectionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
