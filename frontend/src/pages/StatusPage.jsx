import { useState, useEffect, useCallback, useRef } from 'react';
import { statusAPI } from '../api/client';
import { useBrandingStore } from '../store/brandingStore';

const REFRESH_MS = 30_000;
const PROXY_LABEL = { http: 'HTTP', https: 'HTTPS', tcp: 'TCP', udp: 'UDP', minecraft: 'MC' };

function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Uptime squares (90-day style) ────────────────────────────────────────────
function UptimeSquares({ history }) {
  const [tooltip, setTooltip] = useState(null);

  if (!history?.length) {
    return (
      <div className="flex items-center gap-[3px]">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="rounded-[2px] flex-shrink-0"
            style={{ width: 6, height: 14, background: 'rgba(255,255,255,0.06)' }} />
        ))}
      </div>
    );
  }

  // Show last 10 entries, oldest left, newest right
  const entries = history.slice(-10);
  const padded  = [...Array(Math.max(0, 10 - entries.length)).fill(null), ...entries];

  return (
    <div className="relative flex items-center gap-[3px]" onMouseLeave={() => setTooltip(null)}>
      {padded.map((h, i) => (
        <div
          key={i}
          className="rounded-[2px] flex-shrink-0 cursor-default"
          style={{
            width:      6,
            height:     14,
            background: h == null
              ? 'rgba(255,255,255,0.06)'
              : h === 'up'
                ? `rgba(34,197,94,${0.35 + (i / 9) * 0.65})`
                : `rgba(239,68,68,${0.35 + (i / 9) * 0.65})`,
            transition: 'transform 0.1s',
          }}
          onMouseEnter={(e) => {
            if (h == null) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setTooltip({ text: h === 'up' ? 'Up' : 'Down', x: rect.left, y: rect.top });
          }}
        />
      ))}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded text-[11px] font-medium"
          style={{
            left:       tooltip.x,
            top:        tooltip.y - 28,
            background: '#1a1a1f',
            border:     '1px solid rgba(255,255,255,0.1)',
            color:      '#e2e8f0',
            transform:  'translateX(-50%)',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// ─── Type pill ────────────────────────────────────────────────────────────────
function TypePill({ type }) {
  const label = PROXY_LABEL[type?.toLowerCase()] || type?.toUpperCase() || '?';
  const style = {
    HTTP:  { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)',  border: 'rgba(167,139,250,0.2)' },
    HTTPS: { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)',  border: 'rgba(167,139,250,0.2)' },
    TCP:   { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',   border: 'rgba(56,189,248,0.2)'  },
    UDP:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.2)'  },
    MC:    { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',   border: 'rgba(74,222,128,0.2)'  },
  }[label] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)' };
  return (
    <span className="text-[10px] font-bold px-1.5 py-[3px] rounded-md tracking-wider uppercase flex-shrink-0"
      style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}>
      {label}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, monitored }) {
  if (!monitored && status === 'healthy') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full flex-shrink-0"
      style={{ color: '#64748b', background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.15)' }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#475569] flex-shrink-0" />
      No data
    </span>
  );
  const cfg = {
    healthy:  { color: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.2)',  dot: '#22c55e', label: 'Operational' },
    degraded: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.2)',  dot: '#f59e0b', label: 'Degraded'    },
    down:     { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', dot: '#ef4444', label: 'Down'        },
  }[status];
  if (!cfg) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full flex-shrink-0"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

// ─── Service row ──────────────────────────────────────────────────────────────
function ServiceRow({ s, dim }) {
  const ago = timeAgo(s.lastChecked);
  return (
    <div className="flex items-center gap-3 px-4 py-[11px] border-b border-white/[0.04] last:border-0
                    hover:bg-white/[0.02] transition-colors cursor-default"
      style={{ opacity: dim ? 0.55 : 1 }}>
      <TypePill type={s.proxyType} />
      <span className="flex-1 min-w-0 font-mono text-[13px] truncate"
        style={{ color: dim ? '#475569' : 'rgba(255,255,255,0.72)' }}>
        {s.hostname}
      </span>

      <div className="hidden sm:block flex-shrink-0">
        <UptimeSquares history={s.history} />
      </div>

      <span className="hidden md:block text-[12px] tabular-nums w-14 text-right flex-shrink-0"
        style={{ color: dim ? '#334155'
          : s.uptime == null ? '#475569'
          : s.uptime >= 99   ? '#4ade80'
          : s.uptime >= 90   ? '#fbbf24'
          : '#f87171' }}>
        {s.uptime != null ? `${s.uptime.toFixed(1)}%` : '—'}
      </span>

      <span className="hidden lg:block text-[12px] tabular-nums w-14 text-right flex-shrink-0"
        style={{ color: dim ? '#334155' : 'rgba(255,255,255,0.25)' }}>
        {s.responseTime ? `${s.responseTime}ms` : '—'}
      </span>

      <span className="hidden xl:block text-[11px] w-16 text-right flex-shrink-0"
        style={{ color: dim ? '#334155' : 'rgba(255,255,255,0.18)' }}>
        {ago ?? '—'}
      </span>

      <StatusBadge status={s.status} monitored={s.monitored} />
    </div>
  );
}

// ─── Down / Degraded card ─────────────────────────────────────────────────────
function AlertCard({ s }) {
  const ago  = timeAgo(s.lastChecked);
  const down = s.status === 'down';
  const color = down ? '#ef4444' : '#f59e0b';
  const bg    = down ? 'rgba(239,68,68,0.05)'   : 'rgba(245,158,11,0.04)';
  const brd   = down ? 'rgba(239,68,68,0.18)'   : 'rgba(245,158,11,0.15)';

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border"
      style={{ background: bg, borderColor: brd, borderLeft: `3px solid ${color}` }}>
      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: down ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)' }}>
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: color }} />
      </div>
      <TypePill type={s.proxyType} />
      <span className="font-mono text-[13px] text-white/80 flex-1 truncate min-w-0">{s.hostname}</span>
      <div className="hidden sm:block flex-shrink-0"><UptimeSquares history={s.history} /></div>
      {ago && (
        <span className="text-[11px] text-white/25 flex-shrink-0 hidden md:block">seen {ago}</span>
      )}
      <StatusBadge status={s.status} monitored={s.monitored} />
    </div>
  );
}

// ─── Table wrapper ────────────────────────────────────────────────────────────
function ServiceTable({ services, dim, label, labelColor, showHeader }) {
  return (
    <div>
      {label && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] px-0.5 mb-2"
          style={{ color: labelColor || 'rgba(255,255,255,0.2)' }}>
          {label} · {services.length}
        </p>
      )}
      <div className="rounded-2xl border overflow-hidden"
        style={{
          borderColor: dim ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.07)',
          background:  dim ? 'rgba(255,255,255,0.008)' : 'rgba(255,255,255,0.015)',
        }}>
        {showHeader && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.05]">
            <span className="flex-1 text-[10px] uppercase tracking-widest text-white/12">Service</span>
            <span className="hidden sm:block text-[10px] uppercase tracking-widest text-white/12" style={{ width: 78 }}>Checks</span>
            <span className="hidden md:block text-[10px] uppercase tracking-widest text-white/12 w-14 text-right">Uptime</span>
            <span className="hidden lg:block text-[10px] uppercase tracking-widest text-white/12 w-14 text-right">Latency</span>
            <span className="hidden xl:block text-[10px] uppercase tracking-widest text-white/12 w-16 text-right">Checked</span>
            <span className="text-[10px] uppercase tracking-widest text-white/12 w-24 text-right">Status</span>
          </div>
        )}
        {services.map(s => <ServiceRow key={s.hostname} s={s} dim={dim} />)}
      </div>
    </div>
  );
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function Banner({ summary }) {
  if (!summary) return null;
  const { down, degraded, total } = summary;

  if (down > 0) return (
    <div className="rounded-2xl border flex flex-col items-center py-8 gap-3"
      style={{ background: 'rgba(239,68,68,0.04)', borderColor: 'rgba(239,68,68,0.14)' }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.18)' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <p className="text-base font-semibold text-[#f87171]">Service disruption</p>
      <p className="text-sm text-white/30">{down} service{down > 1 ? 's' : ''} currently down</p>
    </div>
  );

  if (degraded > 0) return (
    <div className="rounded-2xl border flex flex-col items-center py-8 gap-3"
      style={{ background: 'rgba(245,158,11,0.04)', borderColor: 'rgba(245,158,11,0.14)' }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.18)' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <p className="text-base font-semibold text-[#fbbf24]">Partial degradation</p>
      <p className="text-sm text-white/30">{degraded} service{degraded > 1 ? 's' : ''} degraded</p>
    </div>
  );

  return (
    <div className="rounded-2xl border flex flex-col items-center py-8 gap-3"
      style={{ background: 'rgba(34,197,94,0.03)', borderColor: 'rgba(34,197,94,0.14)' }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.18)' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <p className="text-base font-semibold text-[#4ade80]">All systems operational</p>
      <p className="text-sm text-white/30">{total} service{total !== 1 ? 's' : ''} monitored</p>
    </div>
  );
}

// ─── Refresh indicator ────────────────────────────────────────────────────────
function RefreshDot({ countdown }) {
  // countdown: 0..1 (1 = just refreshed, 0 = about to refresh)
  const angle = (1 - countdown) * 360;
  const r = 7, cx = 8, cy = 8;
  const toRad = (deg) => (deg - 90) * Math.PI / 180;
  const x = cx + r * Math.cos(toRad(angle));
  const y = cy + r * Math.sin(toRad(angle));
  const large = angle > 180 ? 1 : 0;
  const d = angle <= 0 ? '' : `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x} ${y}`;

  return (
    <svg width="16" height="16" className="opacity-30">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
      {d && <path d={d} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>}
    </svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function StatusPage() {
  const appName       = useBrandingStore((s) => s.appName);
  const fetchBranding = useBrandingStore((s) => s.fetchBranding);
  const [data,        setData]       = useState(null);
  const [loading,     setLoading]    = useState(true);
  const [error,       setError]      = useState(false);
  const [lastRefresh, setLastRefresh]= useState(null);
  const [countdown,   setCountdown]  = useState(1);
  const lastRefreshTime = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const res = await statusAPI.getStatus();
      setData(res.data);
      setLastRefresh(new Date());
      setError(false);
    } catch { setError(true); }
    finally   {
      setLoading(false);
      lastRefreshTime.current = Date.now();
      setCountdown(1);
    }
  }, []);

  useEffect(() => { fetchBranding(); }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Animate countdown ring
  useEffect(() => {
    const raf = setInterval(() => {
      const elapsed = Date.now() - lastRefreshTime.current;
      setCountdown(1 - Math.min(elapsed / REFRESH_MS, 1));
    }, 500);
    return () => clearInterval(raf);
  }, []);

  const down        = data?.services.filter(s => s.status === 'down')     ?? [];
  const degraded    = data?.services.filter(s => s.status === 'degraded') ?? [];
  const operational = data?.services.filter(s => s.status === 'healthy')  ?? [];
  const monitored   = operational.filter(s =>  s.monitored);
  const unmonitored = operational.filter(s => !s.monitored);

  return (
    <div className="min-h-screen" style={{ background: '#0a0a0b' }}>
      <div className="max-w-[700px] mx-auto px-5 pt-14 pb-20 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-white/18">{appName}</span>
          <h1 className="text-sm font-medium text-white/50">Status</h1>
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-[11px] text-white/18">{lastRefresh.toLocaleTimeString()}</span>
            )}
            <RefreshDot countdown={countdown} />
          </div>
        </div>

        {/* ── Banner ── */}
        {!loading && !error && data && <Banner summary={data.summary} />}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-xl border px-5 py-4 text-center"
            style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.15)' }}>
            <p className="text-sm text-[#f87171]">Unable to reach status endpoint — retrying…</p>
          </div>
        )}

        {/* ── Skeleton ── */}
        {loading && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-11 rounded-xl animate-pulse"
                style={{ background: 'rgba(255,255,255,0.04)', animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        )}

        {!loading && !error && data && (<>

          {/* ── Down ── */}
          {down.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f87171]/50 px-0.5">
                Outage · {down.length}
              </p>
              {down.map(s => <AlertCard key={s.hostname} s={s} />)}
            </div>
          )}

          {/* ── Degraded ── */}
          {degraded.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#fbbf24]/50 px-0.5">
                Degraded · {degraded.length}
              </p>
              {degraded.map(s => <AlertCard key={s.hostname} s={s} />)}
            </div>
          )}

          {/* ── Operational + monitored ── */}
          {monitored.length > 0 && (
            <ServiceTable
              services={monitored}
              label="Operational"
              labelColor="rgba(74,222,128,0.45)"
              showHeader
            />
          )}

          {/* ── Active · no monitoring ── */}
          {unmonitored.length > 0 && (
            <ServiceTable
              services={unmonitored}
              dim
              label="Active · no monitoring"
              labelColor="rgba(255,255,255,0.18)"
            />
          )}

          {/* ── Footer stats ── */}
          <div className="flex items-center justify-center gap-10 pt-2">
            {[
              { key: 'healthy',  label: 'Operational', color: '#4ade80' },
              { key: 'degraded', label: 'Degraded',    color: '#fbbf24' },
              { key: 'down',     label: 'Down',        color: '#f87171' },
            ].map(({ key, label, color }) => (
              <div key={key} className="text-center">
                <p className="text-[28px] font-light tabular-nums leading-none" style={{ color }}>
                  {data.summary[key]}
                </p>
                <p className="text-[11px] text-white/22 mt-1">{label}</p>
              </div>
            ))}
          </div>

        </>)}

        <p className="text-center text-[11px] text-white/12">
          Auto-refresh every 30s
        </p>
      </div>
    </div>
  );
}
