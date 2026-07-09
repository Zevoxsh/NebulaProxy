import { useState, useEffect, useCallback, useRef } from 'react';
import { Users, ChevronDown, ChevronRight } from 'lucide-react';
import { domainAPI } from '../../api/client';

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 5) return "à l'instant";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

function PlayerRow({ player, domainId }) {
  const [expanded, setExpanded] = useState(false);
  const [ips, setIps] = useState(null);
  const [loadingIps, setLoadingIps] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && ips === null) {
      setLoadingIps(true);
      try {
        const res = await domainAPI.getPlayerIpHistory(domainId, player.username);
        setIps(res.data.ips || []);
      } catch (_) {
        setIps([]);
      } finally {
        setLoadingIps(false);
      }
    }
  };

  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-white/40 shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-white/40 shrink-0" strokeWidth={1.5} />
        )}
        <img
          src={`https://mc-heads.net/avatar/${encodeURIComponent(player.username)}/32`}
          alt=""
          width={32}
          height={32}
          className="rounded shrink-0"
        />
        <span className="text-sm text-white font-medium">{player.username}</span>
        <span
          className="px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
          style={player.isOnline
            ? { background: '#10B98118', borderColor: '#10B98144', color: '#34D399' }
            : { background: '#71717A18', borderColor: '#71717A44', color: '#A1A1AA' }}
        >
          {player.isOnline ? 'En ligne' : 'Hors ligne'}
        </span>
        <span className="ml-auto text-xs text-white/50 font-mono shrink-0">{player.currentIp || '—'}</span>
        <span className="text-xs text-white/40 shrink-0 w-16 text-right">{timeAgo(player.lastSeenAt)}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-11">
          {loadingIps ? (
            <div className="h-8 bg-white/[0.02] rounded animate-pulse" />
          ) : ips && ips.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] text-white/40 uppercase tracking-wide mb-1.5">
                Historique des IP ({ips.length})
              </p>
              {ips.map((row) => (
                <div key={row.ip} className="flex items-center gap-3 text-xs py-1">
                  <span className="font-mono text-white/70">{row.ip}</span>
                  <span className="text-white/40">première fois {timeAgo(row.firstSeenAt)}</span>
                  <span className="text-white/40 ml-auto">dernière fois {timeAgo(row.lastSeenAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/40">Aucune IP enregistrée.</p>
          )}
        </div>
      )}
    </div>
  );
}

// Player identity comes from the Minecraft Login Start packet (username
// only — this proxy doesn't do online-mode auth, so usernames aren't
// verified against Mojang). Polls like DomainHealthPanel so online/offline
// status stays current while the tab is open.
export default function DomainPlayersPanel({ domainId }) {
  const [players, setPlayers] = useState(null);
  const [loading, setLoading] = useState(true);

  // Bumped by every state-mutating event (WS message or an applied load()).
  // load() captures this before its request goes out; if it changed by the
  // time the response lands, a WS event raced ahead of it and is fresher —
  // applying the stale response anyway would flip a status back to what it
  // was before that WS event, intermittently, depending on network timing
  // (the same class of bug found and fixed in DomainConnectionsPanel.jsx).
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!domainId) return;
    const seqAtStart = seqRef.current;
    try {
      const res = await domainAPI.getPlayers(domainId);
      if (seqRef.current !== seqAtStart) return;
      seqRef.current += 1;
      setPlayers(res.data.players || []);
    } catch (_) {
      // Fail quiet — best-effort context, not critical path
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  // WebSocket is the primary path for online/offline status — player_online
  // /player_offline land the instant a login/disconnect happens server-side.
  // Only flips the flag on an already-known player; a genuinely first-ever
  // join still needs the poll below to add their row (with avatar etc.) —
  // that's an acceptable few-seconds-to-next-reconciliation gap, not a
  // regression, since today that row wouldn't exist at all until a poll.
  // Same /ws/notifications channel/shape as RealtimeTraffic.jsx.
  useEffect(() => {
    if (!domainId) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/notifications`;
    let ws, reconnectTimeout, unmounted = false, hadOpenedBefore = false;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        if (hadOpenedBefore) load();
        hadOpenedBefore = true;
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        // domainId here comes from useParams() (string) while the backend
        // broadcasts domain.id as a number — compare as strings.
        if (!msg || !msg.payload || String(msg.payload.domainId) !== String(domainId)) return;

        if (msg.type === 'player_online' || msg.type === 'player_offline') {
          const isOnline = msg.type === 'player_online';
          const { username } = msg.payload;
          seqRef.current += 1;
          setPlayers((prevList) => {
            if (!prevList) return prevList;
            let found = false;
            const next = prevList.map((p) => {
              if (p.username.toLowerCase() !== username.toLowerCase()) return p;
              found = true;
              return { ...p, isOnline, lastSeenAt: isOnline ? new Date().toISOString() : p.lastSeenAt };
            });
            return found ? next : prevList;
          });
        }
      };
      ws.onclose = () => {
        if (!unmounted) reconnectTimeout = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { unmounted = true; clearTimeout(reconnectTimeout); if (ws) ws.close(); };
  }, [domainId, load]);

  useEffect(() => {
    load();
    // Fallback reconciliation only — WS above is the primary live path.
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && players === null) {
    return (
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-6">
        <div className="h-16 bg-white/[0.02] rounded animate-pulse" />
      </div>
    );
  }

  const onlineCount = (players || []).filter(p => p.isOnline).length;

  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
          style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
          <Users className="w-4 h-4" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-white">Joueurs</p>
        <span className="text-xs text-white/40 ml-auto">
          {onlineCount} en ligne · {(players || []).length} connus
        </span>
      </div>

      {!players || players.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-white/40">Aucun joueur connu pour ce domaine pour l'instant.</p>
        </div>
      ) : (
        <div>
          {players.map((p) => (
            <PlayerRow key={p.username} player={p} domainId={domainId} />
          ))}
        </div>
      )}
    </div>
  );
}
