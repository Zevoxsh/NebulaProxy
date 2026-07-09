import { useState, useEffect, useCallback } from 'react';
import { Cable } from 'lucide-react';
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

function ConnectionRow({ conn, now }) {
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
      <span className="ml-auto text-xs text-white/50 font-mono shrink-0">
        {formatDuration(now - conn.connectedAt)}
      </span>
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

  const load = useCallback(async () => {
    if (!domainId) return;
    try {
      const res = await domainAPI.getActiveConnections(domainId);
      setConnections(res.data.connections || []);
      setNow(Date.now());
    } catch (_) {
      // Fail quiet — best-effort context, not critical path
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

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
            <ConnectionRow key={c.connectionId} conn={c} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
