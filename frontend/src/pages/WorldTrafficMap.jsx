import React, { useMemo } from 'react';
import { ComposableMap, Geographies, Geography, Marker, Line } from 'react-simple-maps';
import { getCountryCoordinates } from '../utils/countryCoordinates';
import { normalizeCountryCode } from '../utils/countryUtils';
import worldGeoUrl from '../assets/world-countries-110m.json';

// COUNTRY_COORDINATES stores [lat, lng] — react-simple-maps wants [lng, lat].
function toLngLat([lat, lng]) {
  return [lng, lat];
}

// ─── Heatmap color scale (low volume -> high volume) ───────────────────────────
const HEAT_STOPS = [
  { at: 0,    rgb: [34, 211, 238] },  // cyan   #22D3EE
  { at: 0.5,  rgb: [245, 158, 11] },  // amber  #F59E0B
  { at: 1,    rgb: [239, 68, 68] },   // red    #EF4444
];

function heatColor(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  let a = HEAT_STOPS[0], b = HEAT_STOPS[HEAT_STOPS.length - 1];
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    if (r >= HEAT_STOPS[i].at && r <= HEAT_STOPS[i + 1].at) {
      a = HEAT_STOPS[i]; b = HEAT_STOPS[i + 1];
      break;
    }
  }
  const span = b.at - a.at || 1;
  const t = (r - a.at) / span;
  const rgb = a.rgb.map((v, i) => Math.round(v + (b.rgb[i] - v) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

const MAP_STYLE = `
  @keyframes np-pulse {
    0%, 100% { r: 5; opacity: 1; }
    50% { r: 9; opacity: 0.4; }
  }
  .np-proxy-pulse { animation: np-pulse 2s ease-in-out infinite; }
`;

function WorldBase({ children, styleExtra = '' }) {
  return (
    <div className="relative">
      <style>{MAP_STYLE + styleExtra}</style>
      <ComposableMap
        projectionConfig={{ scale: 140 }}
        width={980}
        height={480}
        style={{ width: '100%', height: 'auto' }}
      >
        <Geographies geography={worldGeoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#1A1B28"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth={0.5}
                style={{
                  default: { outline: 'none' },
                  hover: { outline: 'none', fill: '#20222f' },
                  pressed: { outline: 'none' }
                }}
              />
            ))
          }
        </Geographies>
        {children}
      </ComposableMap>
    </div>
  );
}

function ProxyMarker({ position, location }) {
  if (!position) return null;
  return (
    <Marker coordinates={position}>
      <circle r={5} fill="#9D4EDD" className="np-proxy-pulse" />
      <circle r={5} fill="#9D4EDD" stroke="#fff" strokeWidth={1} />
      <title>Proxy{location?.country ? ` — ${location.country}` : ''}</title>
    </Marker>
  );
}

// ─── Aggregated view (Rapports) — one dot + one static line per country ───────
export function WorldTrafficMap({ countries, proxyLocation }) {
  const points = useMemo(() => {
    return (countries || [])
      .map((c) => {
        const coords = getCountryCoordinates(c.country);
        if (!coords) return null;
        return { ...c, country: normalizeCountryCode(c.country), position: toLngLat(coords) };
      })
      .filter(Boolean);
  }, [countries]);

  const proxyPosition = proxyLocation ? [proxyLocation.lng, proxyLocation.lat] : null;
  const maxRequests = Math.max(...points.map((p) => p.requests), 1);

  return (
    <WorldBase styleExtra={`
      @keyframes np-flow-dash { to { stroke-dashoffset: -16; } }
      .np-flow-line { stroke-dasharray: 4 4; animation: np-flow-dash 1s linear infinite; }
    `}>
      {proxyPosition && points.map((p, i) => (
        <Line key={`line-${i}`} from={p.position} to={proxyPosition}
          stroke="#38BDF8" strokeWidth={1} strokeOpacity={0.5} className="np-flow-line" />
      ))}
      {points.map((p, i) => (
        <Marker key={`marker-${i}`} coordinates={p.position}>
          <circle r={2.5 + (p.requests / maxRequests) * 7} fill="#38BDF8" fillOpacity={0.35} stroke="#38BDF8" strokeWidth={1} />
          <title>{p.country} — {p.requests.toLocaleString()} requêtes{p.errors ? ` (${p.errors} erreurs)` : ''}</title>
        </Marker>
      ))}
      <ProxyMarker position={proxyPosition} location={proxyLocation} />
    </WorldBase>
  );
}

// ─── Live view ──────────────────────────────────────────────────────────────
// Two layers, both driven by the caller (no internal timers):
//  - `volumes`: [{ country, count, position }] — persistent per-country
//    marker for a caller-defined rolling window, sized+colored on a
//    cyan->amber->red heat scale by request count, with the count as a
//    visible label (not just a hover tooltip).
//  - `pulses`: [{ id, country, position, level }] — a short-lived flash+line
//    fired once per incoming request, on top of the volume layer, for the
//    "live" feel. Removed by the caller ~1.6s after being added.
const LEVEL_COLOR = {
  success: '#10B981', info: '#22D3EE', warning: '#F59E0B', error: '#EF4444'
};

export function LiveWorldMap({ pulses, volumes, proxyLocation }) {
  const proxyPosition = proxyLocation ? [proxyLocation.lng, proxyLocation.lat] : null;
  const maxCount = Math.max(...(volumes || []).map((v) => v.count), 1);

  return (
    <WorldBase styleExtra={`
      @keyframes np-pulse-line {
        0%   { opacity: 0; }
        12%  { opacity: 1; }
        70%  { opacity: 0.6; }
        100% { opacity: 0; }
      }
      @keyframes np-pulse-dot {
        0%   { r: 1; opacity: 0.9; }
        20%  { r: 6; opacity: 1; }
        100% { r: 6; opacity: 0; }
      }
      .np-pulse-line { animation: np-pulse-line 1.6s ease-out forwards; }
      .np-pulse-dot  { animation: np-pulse-dot 1.6s ease-out forwards; }
    `}>
      {proxyPosition && (volumes || []).map((v, i) => (
        <Line key={`vl-${i}`} from={v.position} to={proxyPosition}
          stroke={heatColor(v.count / maxCount)} strokeWidth={1 + (v.count / maxCount) * 2}
          strokeOpacity={0.55} />
      ))}
      {(volumes || []).map((v, i) => {
        const ratio = v.count / maxCount;
        const radius = 4 + ratio * 14;
        const color = heatColor(ratio);
        return (
          <Marker key={`vm-${i}`} coordinates={v.position}>
            <circle r={radius} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.5} />
            <text
              textAnchor="middle"
              y={-radius - 5}
              style={{ fontSize: 11, fontFamily: 'monospace', fill: '#fff', paintOrder: 'stroke', stroke: '#0B0C14', strokeWidth: 3 }}
            >
              {v.country} · {v.count}
            </text>
            <title>{v.country} — {v.count.toLocaleString()} requêtes</title>
          </Marker>
        );
      })}

      {proxyPosition && (pulses || []).map((p) => (
        <Line key={`pl-${p.id}`} from={p.position} to={proxyPosition}
          stroke={LEVEL_COLOR[p.level] || '#38BDF8'} strokeWidth={1.5} strokeOpacity={0.8}
          className="np-pulse-line" />
      ))}
      {(pulses || []).map((p) => (
        <Marker key={`pm-${p.id}`} coordinates={p.position}>
          <circle r={4} fill={LEVEL_COLOR[p.level] || '#38BDF8'} className="np-pulse-dot" />
          <title>{normalizeCountryCode(p.country) || p.country}</title>
        </Marker>
      ))}
      <ProxyMarker position={proxyPosition} location={proxyLocation} />
    </WorldBase>
  );
}

export { toLngLat };
export default WorldTrafficMap;
