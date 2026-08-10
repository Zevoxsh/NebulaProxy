import { useState, useEffect, useCallback } from 'react';
import { Activity, AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, Zap } from 'lucide-react';
import { domainAPI } from '../../api/client';

const STATUS_STYLE = {
  up: { label: 'En ligne', color: '#10B981', text: '#34D399', Icon: CheckCircle2 },
  down: { label: 'Hors ligne', color: '#EF4444', text: '#F87171', Icon: AlertTriangle },
  unknown: { label: 'Statut inconnu', color: '#71717A', text: '#A1A1AA', Icon: HelpCircle },
};

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 5) return "à l'instant";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

// Real reachability — distinct from the domain's `is_active` manual toggle.
// Polls so a domain owner watching this tab sees a recovery/incident live.
export default function DomainHealthPanel({ domainId }) {
  const [health, setHealth] = useState(null);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!domainId) return;
    try {
      const [healthRes, errorsRes] = await Promise.all([
        domainAPI.getHealth(domainId),
        domainAPI.getLogErrors(domainId, { limit: 8 }),
      ]);
      setHealth(healthRes.data.health);
      setErrors(errorsRes.data.errors || []);
    } catch (_) {
      // Fail quiet — this panel is best-effort context, not critical path
    } finally {
      setLoading(false);
    }
  }, [domainId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !health) {
    return (
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-6">
        <div className="h-16 bg-white/[0.02] rounded animate-pulse" />
      </div>
    );
  }
  if (!health) return null;

  const st = STATUS_STYLE[health.currentStatus] || STATUS_STYLE.unknown;
  const StatusIcon = st.Icon;
  const openBreakers = (health.circuitBreakers || []).filter(b => b.state !== 'CLOSED');

  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
          style={{ background: `${st.color}18`, borderColor: `${st.color}44` }}>
          <Activity className="w-4 h-4" style={{ color: st.color }} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-white">Santé du domaine</p>
        <span className="ml-auto text-xs text-white/30">vérifié {timeAgo(health.lastCheckedAt)}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Status row */}
        <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: `${st.color}0D`, borderColor: `${st.color}30` }}>
          <div className="flex items-center gap-3">
            <StatusIcon className="w-5 h-5" style={{ color: st.text }} strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-white">{st.label}</p>
              {health.currentStatus === 'down' && health.consecutiveFailures > 0 && (
                <p className="text-xs" style={{ color: st.text }}>
                  {health.consecutiveFailures} échec(s) consécutif(s) depuis {timeAgo(health.lastStatusChangeAt)}
                </p>
              )}
              {health.currentStatus === 'up' && (
                <p className="text-xs text-white/40">
                  {health.lastResponseTime != null ? `Dernière réponse en ${health.lastResponseTime}ms` : 'Aucun souci détecté'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Last error, if any */}
        {health.lastError && (
          <div className="flex items-start gap-2 p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-[#F87171] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <p className="text-xs font-medium text-[#F87171]">Dernière erreur du health check</p>
              <p className="text-xs text-white/60 mt-0.5 font-mono">{health.lastError}</p>
            </div>
          </div>
        )}

        {/* Circuit breakers (only shown if a backend has ever failed) */}
        {openBreakers.length > 0 && (
          <div>
            <p className="text-xs font-medium text-white/60 mb-2">Backends en échec</p>
            <div className="space-y-2">
              {openBreakers.map((b, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-[#FBBF24]" strokeWidth={1.5} />
                    <span className="text-xs font-mono text-white/80">{b.backend}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-[#FBBF24] font-medium">{b.state}</span>
                    {b.lastError && <p className="text-[11px] text-white/40">{b.lastError}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent checks timeline */}
        {health.recentChecks?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-white/60 mb-2">Historique récent des vérifications</p>
            <div className="flex gap-1">
              {[...health.recentChecks].reverse().map((c, i) => (
                <div key={i} className="group relative flex-1">
                  <div
                    className={`h-6 rounded ${c.status === 'success' ? 'bg-[#10B981]/50' : 'bg-[#EF4444]/60'}`}
                    title={`${c.status === 'success' ? 'OK' : 'Échec'} · ${timeAgo(c.checkedAt)}${c.errorMessage ? ' · ' + c.errorMessage : ''}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent errors from real traffic */}
        {errors.length > 0 && (
          <div>
            <p className="text-xs font-medium text-white/60 mb-2">Erreurs récentes du trafic</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {errors.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${e.status_code >= 500 ? 'bg-[#EF4444]/20 text-[#F87171]' : 'bg-[#F59E0B]/20 text-[#FBBF24]'}`}>
                      {e.status_code}
                    </span>
                    <span className="text-white/70 font-mono truncate">{e.method} {e.path}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-white/40">
                    {e.error_message && <span className="truncate max-w-[220px]" title={e.error_message}>{e.error_message}</span>}
                    <span>{timeAgo(e.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={load}
          className="flex items-center gap-2 text-xs text-white/40 hover:text-white transition-colors"
        >
          <RefreshCw className="w-3 h-3" strokeWidth={1.5} />
          Actualiser
        </button>
      </div>
    </div>
  );
}
