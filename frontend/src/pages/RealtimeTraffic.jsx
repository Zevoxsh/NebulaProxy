import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Activity, Wifi, WifiOff, RefreshCw, BarChart3 } from 'lucide-react';
import { domainAPI, analyticsAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';

// ─── Constants ────────────────────────────────────────────────────────────────
const TICK_MS    = 100;
const WINDOW_MS  = 60_000;
const MAX_PTS    = WINDOW_MS / TICK_MS + 20;
const EMA_ALPHA  = 0.18;
const ROW_HEIGHT = 44;
const CHART_H    = 320;
const CHART_24H  = 200;

const COLORS = [
  '#9D4EDD', '#22D3EE', '#10B981', '#F59E0B', '#EF4444',
  '#6366F1', '#EC4899', '#14B8A6', '#F97316', '#84CC16',
  '#8B5CF6', '#06B6D4', '#34D399', '#FBBF24', '#FB923C',
  '#A78BFA', '#38BDF8', '#4ADE80', '#FCD34D', '#F87171',
];

const TYPE_INFO = {
  http:      { label: 'HTTP',      color: '#9D4EDD' },
  https:     { label: 'HTTPS',     color: '#9D4EDD' },
  tcp:       { label: 'TCP',       color: '#22D3EE' },
  udp:       { label: 'UDP',       color: '#F59E0B' },
  minecraft: { label: 'Minecraft', color: '#10B981' },
};

const colorFor   = (i)  => COLORS[i % COLORS.length];
const emaToRps   = (v)  => +(v * (1000 / TICK_MS)).toFixed(1);

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── 60s realtime canvas chart ───────────────────────────────────────────────
const LIVE_PAD = { top: 12, right: 16, bottom: 36, left: 48 };

function LiveChart({ domains, seriesRef }) {
  const canvasRef   = useRef(null);
  const wrapperRef  = useRef(null);
  const rafRef      = useRef(null);
  const dprRef      = useRef(1);
  const mousePosRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const resize = useCallback(() => {
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = wrapper.clientWidth;
    canvas.width        = w * dpr;
    canvas.height       = CHART_H * dpr;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${CHART_H}px`;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const dpr    = dprRef.current;
    const chartW = canvas.width / dpr - LIVE_PAD.left - LIVE_PAD.right;

    if (mouseX < LIVE_PAD.left || mouseX > LIVE_PAD.left + chartW) {
      mousePosRef.current = null;
      setTooltip(null);
      return;
    }
    mousePosRef.current = mouseX;

    const now      = Date.now();
    const tMin     = now - WINDOW_MS;
    const fraction = (mouseX - LIVE_PAD.left) / chartW;
    const targetT  = tMin + fraction * WINDOW_MS;

    const items = [];
    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      const raw    = (seriesRef.current[domain.id] || []).filter(([t]) => t >= tMin);
      if (!raw.length) continue;
      let nearest = raw[0], minDiff = Math.abs(raw[0][0] - targetT);
      for (const pt of raw) {
        const diff = Math.abs(pt[0] - targetT);
        if (diff < minDiff) { minDiff = diff; nearest = pt; }
      }
      const rps = emaToRps(nearest[1]);
      if (rps > 0) items.push({ hostname: domain.hostname, color: colorFor(i), rps });
    }

    const d    = new Date(targetT);
    const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    setTooltip({ x: mouseX, time, items });
  }, [domains, seriesRef]);

  const handleMouseLeave = useCallback(() => {
    mousePosRef.current = null;
    setTooltip(null);
  }, []);

  useEffect(() => {
    const PAD = LIVE_PAD;

    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }

      const dpr = dprRef.current;
      const ctx = canvas.getContext('2d');
      const W   = canvas.width  / dpr;
      const H   = canvas.height / dpr;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const chartW = W - PAD.left - PAD.right;
      const chartH = H - PAD.top  - PAD.bottom;
      const now    = Date.now();
      const tMin   = now - WINDOW_MS;

      let maxVal = 0.001;
      for (const domain of domains) {
        for (const [t, v] of (seriesRef.current[domain.id] || [])) {
          if (t >= tMin && v > maxVal) maxVal = v;
        }
      }

      const xOf = (t) => PAD.left + ((t - tMin) / WINDOW_MS) * chartW;
      const yOf = (v) => PAD.top  + chartH - (v / maxVal) * chartH;

      // Grid
      const gridCount = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i <= gridCount; i++) {
        const y = PAD.top + (chartH / gridCount) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Y labels
      ctx.fillStyle    = 'rgba(255,255,255,0.28)';
      ctx.font         = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= gridCount; i++) {
        const v = maxVal * (i / gridCount);
        ctx.fillText(`${emaToRps(v)}`, PAD.left - 8, PAD.top + chartH - (chartH / gridCount) * i);
      }

      // X labels
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i <= 6; i++) {
        const t = tMin + (WINDOW_MS / 6) * i;
        const d = new Date(t);
        const lbl = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        ctx.fillText(lbl, xOf(t), PAD.top + chartH + 10);
      }

      // Clip & draw series
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.left, PAD.top, chartW, chartH + 1); ctx.clip();

      for (let si = 0; si < domains.length; si++) {
        const domain = domains[si];
        const color  = colorFor(si);
        const raw    = (seriesRef.current[domain.id] || []).filter(([t]) => t >= tMin);
        if (raw.length < 2) continue;

        const pts = raw.map(([t, v]) => [xOf(t), yOf(v)]);

        const path = new Path2D();
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          const cpx = (x0 + x1) / 2;
          path.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
        }

        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
        grad.addColorStop(0,   rgba(color, 0.28));
        grad.addColorStop(0.6, rgba(color, 0.06));
        grad.addColorStop(1,   rgba(color, 0));

        const fillPath = new Path2D(path);
        const last = pts[pts.length - 1];
        fillPath.lineTo(last[0], PAD.top + chartH);
        fillPath.lineTo(pts[0][0], PAD.top + chartH);
        fillPath.closePath();
        ctx.fillStyle = grad;
        ctx.fill(fillPath);

        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.stroke(path);
      }

      // Hover crosshair + dots
      const mouseX = mousePosRef.current;
      if (mouseX !== null) {
        const fraction = (mouseX - PAD.left) / chartW;
        const targetT  = tMin + fraction * WINDOW_MS;

        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(mouseX, PAD.top);
        ctx.lineTo(mouseX, PAD.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        for (let si = 0; si < domains.length; si++) {
          const domain = domains[si];
          const color  = colorFor(si);
          const raw    = (seriesRef.current[domain.id] || []).filter(([t]) => t >= tMin);
          if (!raw.length) continue;
          let nearest = raw[0], minDiff = Math.abs(raw[0][0] - targetT);
          for (const pt of raw) {
            const diff = Math.abs(pt[0] - targetT);
            if (diff < minDiff) { minDiff = diff; nearest = pt; }
          }
          ctx.beginPath();
          ctx.arc(xOf(nearest[0]), yOf(nearest[1]), 4, 0, Math.PI * 2);
          ctx.fillStyle   = color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [domains, seriesRef]);

  const tooltipLeft = tooltip
    ? (tooltip.x > (wrapperRef.current?.clientWidth || 600) - 200 ? undefined : tooltip.x + 14)
    : undefined;
  const tooltipRight = tooltip
    ? (tooltip.x > (wrapperRef.current?.clientWidth || 600) - 200 ? (wrapperRef.current?.clientWidth || 600) - tooltip.x + 14 : undefined)
    : undefined;

  return (
    <div ref={wrapperRef} className="w-full relative"
      onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {tooltip && tooltip.items.length > 0 && (
        <div
          className="absolute pointer-events-none z-10 bg-[#1A1B28]/95 backdrop-blur-sm border border-white/[0.12] rounded-lg px-3 py-2 text-xs shadow-xl min-w-[160px]"
          style={{ top: 8, left: tooltipLeft, right: tooltipRight }}
        >
          <p className="text-white/40 mb-1.5 font-mono text-[10px]">{tooltip.time}</p>
          <div className="space-y-1">
            {tooltip.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                <span className="text-white/70 truncate flex-1 max-w-[130px]">{item.hostname}</span>
                <span className="tabular-nums font-mono ml-2 flex-shrink-0" style={{ color: item.color }}>{item.rps} req/s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 24h area chart (canvas) — même style que LiveChart, un courbe par domaine ─
const PAD_24H = { top: 12, right: 16, bottom: 36, left: 52 };

function Chart24h({ domains, hourlyData }) {
  const canvasRef  = useRef(null);
  const wrapperRef = useRef(null);
  const dprRef     = useRef(1);
  const drawFnRef  = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const resize = useCallback(() => {
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = wrapper.clientWidth;
    canvas.width        = w * dpr;
    canvas.height       = CHART_24H * dpr;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${CHART_24H}px`;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !domains.length) return;

    const series = domains
      .map((d, i) => ({ domain: d, colorIdx: i, pts: hourlyData[d.id] || [] }))
      .filter(s => s.pts.length >= 2);

    if (!series.length) return;

    const PAD = PAD_24H;
    const dpr = dprRef.current;

    let maxVal = 0.001;
    for (const s of series) {
      for (const pt of s.pts) {
        if (pt.requests > maxVal) maxVal = pt.requests;
      }
    }

    const timePts = series[0].pts;
    const BUCKETS = timePts.length;

    function draw(hoverIdx = null) {
      const ctx    = canvas.getContext('2d');
      const W      = canvas.width  / dpr;
      const H      = canvas.height / dpr;
      const chartW = W - PAD.left - PAD.right;
      const chartH = H - PAD.top  - PAD.bottom;
      const xOf    = (i) => PAD.left + (i / (BUCKETS - 1)) * chartW;
      const yOf    = (v) => PAD.top  + chartH - (v / maxVal) * chartH;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Grid
      const gridCount = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i <= gridCount; i++) {
        const y = PAD.top + (chartH / gridCount) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Y labels
      ctx.fillStyle    = 'rgba(255,255,255,0.28)';
      ctx.font         = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= gridCount; i++) {
        const v   = Math.round(maxVal * (i / gridCount));
        const lbl = v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
        ctx.fillText(lbl, PAD.left - 8, PAD.top + chartH - (chartH / gridCount) * i);
      }

      // X labels (every ~4h)
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      const step = Math.max(1, Math.floor(BUCKETS / 6));
      timePts.forEach((pt, i) => {
        if (i % step !== 0 && i !== BUCKETS - 1) return;
        ctx.fillText(pt.time, xOf(i), PAD.top + chartH + 10);
      });

      // Clip & draw series
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.left, PAD.top, chartW, chartH + 1); ctx.clip();

      for (const s of series) {
        const color = colorFor(s.colorIdx);
        const pts   = s.pts.map((pt, i) => [xOf(i), yOf(pt.requests)]);

        const path = new Path2D();
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          const cpx = (x0 + x1) / 2;
          path.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
        }

        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
        grad.addColorStop(0,   rgba(color, 0.28));
        grad.addColorStop(0.6, rgba(color, 0.06));
        grad.addColorStop(1,   rgba(color, 0));

        const fillPath = new Path2D(path);
        const last     = pts[pts.length - 1];
        fillPath.lineTo(last[0], PAD.top + chartH);
        fillPath.lineTo(pts[0][0], PAD.top + chartH);
        fillPath.closePath();
        ctx.fillStyle = grad;
        ctx.fill(fillPath);

        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.stroke(path);

        // Dot on last point
        const [lx, ly] = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      // Hover crosshair + dots
      if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < BUCKETS) {
        const hx = xOf(hoverIdx);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hx, PAD.top);
        ctx.lineTo(hx, PAD.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        for (const s of series) {
          const color = colorFor(s.colorIdx);
          ctx.beginPath();
          ctx.arc(xOf(hoverIdx), yOf(s.pts[hoverIdx].requests), 4, 0, Math.PI * 2);
          ctx.fillStyle   = color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    drawFnRef.current = { draw, BUCKETS, PAD, series, timePts };
    draw();
  }, [domains, hourlyData]);

  const handleMouseMove = useCallback((e) => {
    if (!drawFnRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { draw, BUCKETS, PAD, series, timePts } = drawFnRef.current;
    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const dpr    = dprRef.current;
    const chartW = canvas.width / dpr - PAD.left - PAD.right;

    if (mouseX < PAD.left || mouseX > PAD.left + chartW) {
      draw(null);
      setTooltip(null);
      return;
    }

    const fraction = (mouseX - PAD.left) / chartW;
    const hoverIdx = Math.min(BUCKETS - 1, Math.max(0, Math.round(fraction * (BUCKETS - 1))));
    draw(hoverIdx);

    const items = series
      .map(s => ({ hostname: s.domain.hostname, color: colorFor(s.colorIdx), requests: s.pts[hoverIdx]?.requests || 0 }))
      .filter(item => item.requests > 0);
    setTooltip({ x: mouseX, time: timePts[hoverIdx]?.time, items });
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (drawFnRef.current) drawFnRef.current.draw(null);
    setTooltip(null);
  }, []);

  const tooltipLeft24 = tooltip
    ? (tooltip.x > (wrapperRef.current?.clientWidth || 600) - 200 ? undefined : tooltip.x + 14)
    : undefined;
  const tooltipRight24 = tooltip
    ? (tooltip.x > (wrapperRef.current?.clientWidth || 600) - 200 ? (wrapperRef.current?.clientWidth || 600) - tooltip.x + 14 : undefined)
    : undefined;

  return (
    <div ref={wrapperRef} className="w-full relative"
      onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {tooltip && tooltip.items.length > 0 && (
        <div
          className="absolute pointer-events-none z-10 bg-[#1A1B28]/95 backdrop-blur-sm border border-white/[0.12] rounded-lg px-3 py-2 text-xs shadow-xl min-w-[160px]"
          style={{ top: 8, left: tooltipLeft24, right: tooltipRight24 }}
        >
          <p className="text-white/40 mb-1.5 font-mono text-[10px]">{tooltip.time}</p>
          <div className="space-y-1">
            {tooltip.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                <span className="text-white/70 truncate flex-1 max-w-[130px]">{item.hostname}</span>
                <span className="tabular-nums font-mono ml-2 flex-shrink-0" style={{ color: item.color }}>{item.requests.toLocaleString()} req</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function TypeBadge({ type }) {
  const info = TYPE_INFO[type?.toLowerCase()] || { label: (type || '?').toUpperCase(), color: '#888' };
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
      style={{ background: `${info.color}22`, color: info.color, border: `1px solid ${info.color}44` }}
    >
      {info.label}
    </span>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4">
      <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-1">{label}</p>
      <p className="text-2xl font-light text-white">{value}</p>
      {sub && <p className="text-xs text-white/30 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Seed seriesRef from Redis realtime history ───────────────────────────────
function seedRealtimeSeries(history, domains, seriesRef, emaRef) {
  for (const domain of domains) {
    const points = history[domain.id] || [];
    if (!points.length) continue;

    points.sort((a, b) => a.ts - b.ts);

    // Build a per-second count map
    const countBySec = {};
    for (const p of points) {
      const sec = Math.floor(p.ts / 1000);
      countBySec[sec] = (countBySec[sec] || 0) + p.count;
    }

    const now      = Date.now();
    const startSec = Math.floor((now - WINDOW_MS) / 1000);
    const endSec   = Math.floor(now / 1000);

    let ema    = emaRef.current[domain.id] || 0;
    const series = seriesRef.current[domain.id] || [];

    // Replay per-second history as 10 ticks of 100ms each
    for (let s = startSec; s <= endSec; s++) {
      const countPerSec = countBySec[s] || 0;
      for (let tick = 0; tick < 10; tick++) {
        const ts      = s * 1000 + tick * 100;
        const rawTick = countPerSec / 10;
        ema = EMA_ALPHA * rawTick + (1 - EMA_ALPHA) * ema;
        series.push([ts, ema]);
      }
    }

    // Trim to window
    const cutoff = now - WINDOW_MS;
    const start  = series.findIndex(([t]) => t >= cutoff);
    seriesRef.current[domain.id] = start > 0 ? series.slice(start) : series;
    emaRef.current[domain.id]    = ema;
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RealtimeTraffic() {
  const user = useAuthStore((s) => s.user);

  const [domains,     setDomains]     = useState([]);
  const [wsStatus,    setWsStatus]    = useState('connecting');
  const [totalReqs,   setTotalReqs]   = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [liveEma,     setLiveEma]     = useState({});
  const [data24h,     setData24h]     = useState({});

  const domainsRef = useRef([]);
  const rawRef     = useRef({});
  const emaRef     = useRef({});
  const seriesRef  = useRef({});
  const totalRef   = useRef(0);

  // ── Load domains + seed history ─────────────────────────────────────────────
  useEffect(() => {
    domainAPI.list()
      .then(async (res) => {
        const list = res.data?.domains || res.data || [];
        domainsRef.current = list;
        const s = {};
        for (const d of list) s[d.id] = [];
        seriesRef.current = s;
        setDomains(list);

        // Pre-populate realtime chart from Redis
        if (list.length) {
          try {
            const histRes = await analyticsAPI.getRealtimeHistory();
            const history = histRes.data?.history || {};
            seedRealtimeSeries(history, list, seriesRef, emaRef);
          } catch (_) {}
        }
      })
      .catch(() => {});
  }, []);

  // ── Fetch 24h data (on mount + every 60s) ───────────────────────────────────
  useEffect(() => {
    async function fetch24h() {
      try {
        const res = await analyticsAPI.getTraffic24h();
        setData24h(res.data?.data || {});
      } catch (_) {}
    }
    fetch24h();
    const t = setInterval(fetch24h, 60_000);
    return () => clearInterval(t);
  }, []);

  // ── EMA tick (100ms) ─────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const domains = domainsRef.current;
      if (!domains.length) return;
      const now = Date.now();
      const raw = rawRef.current;
      const ema = emaRef.current;
      const s   = seriesRef.current;
      for (const d of domains) {
        const id = d.id;
        const nv = EMA_ALPHA * (raw[id] || 0) + (1 - EMA_ALPHA) * (ema[id] || 0);
        ema[id]  = nv;
        if (!s[id]) s[id] = [];
        s[id].push([now, nv]);
        if (s[id].length > MAX_PTS) s[id].shift();
      }
      rawRef.current = {};
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);

  // ── Stats tick (500ms) ────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const domains = domainsRef.current;
      const ema     = emaRef.current;
      let active = 0;
      const snap = {};
      for (const d of domains) {
        const v = ema[d.id] || 0;
        snap[d.id] = v;
        if (v > 0.005) active++;
      }
      setLiveEma(snap);
      setActiveCount(active);
      setTotalReqs(totalRef.current);
    }, 500);
    return () => clearInterval(t);
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/notifications`;
    let ws, reconnectTimeout, unmounted = false;

    function connect() {
      setWsStatus('connecting');
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setWsStatus('connected');
        if (user?.id) ws.send(JSON.stringify({ type: 'subscribe', userId: String(user.id) }));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'traffic_log' && msg.payload?.domainId) {
            rawRef.current[msg.payload.domainId] = (rawRef.current[msg.payload.domainId] || 0) + 1;
            totalRef.current += 1;
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        setWsStatus('disconnected');
        if (!unmounted) reconnectTimeout = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { unmounted = true; clearTimeout(reconnectTimeout); if (ws) ws.close(); };
  }, [user?.id]);

  // ── Sorted table ──────────────────────────────────────────────────────────
  const ranked = useMemo(() =>
    [...domains]
      .map((d, i) => ({ domain: d, colorIdx: i, ema: liveEma[d.id] || 0 }))
      .sort((a, b) => b.ema - a.ema),
    [domains, liveEma]
  );

  const total24h = Object.values(data24h).reduce((sum, pts) =>
    sum + pts.reduce((s, p) => s + p.requests, 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-white tracking-tight">Live Traffic</h1>
          <p className="text-sm text-white/40 mt-1">Trafic en temps réel · tous les domaines</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {wsStatus === 'connected' && (
            <span className="flex items-center gap-2 text-[#10B981]">
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
              <Wifi className="w-4 h-4" strokeWidth={1.5} />
              <span className="font-medium">Live</span>
            </span>
          )}
          {wsStatus === 'connecting' && (
            <span className="flex items-center gap-2 text-[#F59E0B]">
              <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
              <span>Connecting…</span>
            </span>
          )}
          {wsStatus === 'disconnected' && (
            <span className="flex items-center gap-2 text-[#EF4444]">
              <WifiOff className="w-4 h-4" strokeWidth={1.5} />
              <span>Disconnected — reconnecting…</span>
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Domaines surveillés" value={domains.length}              sub="tous types confondus" />
        <StatCard label="Domaines actifs"      value={activeCount}                sub="avec trafic en cours" />
        <StatCard label="Total requêtes"       value={totalReqs.toLocaleString()} sub="depuis l'ouverture" />
      </div>

      {/* 24h chart */}
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
            style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
            <BarChart3 className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-white">Trafic des 24 dernières heures</p>
          <span className="ml-auto text-xs text-white/30">
            {total24h > 0 ? `${total24h.toLocaleString()} req · actualisé chaque minute` : 'actualisé chaque minute'}
          </span>
        </div>
        <div className="p-4">
          {domains.length === 0 || Object.keys(data24h).length === 0 ? (
            <div className="flex items-center justify-center text-white/30 text-sm" style={{ height: CHART_24H }}>
              Aucune donnée — les statistiques s'accumulent en temps réel
            </div>
          ) : (
            <Chart24h domains={domains} hourlyData={data24h} />
          )}
        </div>
      </div>

      {/* 60s realtime chart */}
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
            style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
            <Activity className="w-4 h-4 text-[#9D4EDD]" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-white">Requêtes / seconde par domaine</p>
          <span className="ml-auto text-xs text-white/30">fenêtre 60s · EMA lissé</span>
        </div>
        <div className="p-4">
          {domains.length === 0 ? (
            <div className="flex items-center justify-center text-white/30 text-sm" style={{ height: CHART_H }}>
              Chargement des domaines…
            </div>
          ) : (
            <LiveChart domains={domains} seriesRef={seriesRef} />
          )}
        </div>
      </div>

      {/* Sorted domain table */}
      {domains.length > 0 && (
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.08] flex items-center gap-2">
            <p className="text-sm font-medium text-white">Domaines</p>
            <span className="text-xs text-white/30">· trié par activité</span>
          </div>
          <div className="relative" style={{ height: domains.length * ROW_HEIGHT }}>
            {ranked.map(({ domain, colorIdx, ema }, sortIndex) => {
              const rps      = emaToRps(ema);
              const isActive = ema > 0.005;
              const barPct   = ranked[0]?.ema > 0 ? (ema / ranked[0].ema) * 100 : 0;
              return (
                <div
                  key={domain.id}
                  className="absolute left-0 right-0 flex items-center gap-3 px-4 border-b border-white/[0.04]"
                  style={{
                    top:        sortIndex * ROW_HEIGHT,
                    height:     ROW_HEIGHT,
                    transition: 'top 600ms cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <span className="text-[11px] tabular-nums text-white/20 w-5 text-right flex-shrink-0">
                    {sortIndex + 1}
                  </span>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: colorFor(colorIdx) }} />
                  <div className="flex-1 min-w-0 relative">
                    <div className="absolute inset-y-0 left-0 rounded"
                      style={{
                        width:      `${barPct}%`,
                        background: rgba(colorFor(colorIdx), 0.1),
                        transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    />
                    <span className="relative text-sm text-white/80 truncate font-mono block">
                      {domain.hostname}
                    </span>
                  </div>
                  <TypeBadge type={domain.proxy_type} />
                  <div className="flex items-center gap-1.5 w-28 justify-end flex-shrink-0">
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse flex-shrink-0" />
                    )}
                    <span
                      className="text-sm tabular-nums"
                      style={{
                        color:      isActive ? colorFor(colorIdx) : 'rgba(255,255,255,0.2)',
                        transition: 'color 400ms ease',
                      }}
                    >
                      {rps} req/s
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
