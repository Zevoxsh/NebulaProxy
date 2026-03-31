import { useState, useEffect } from 'react';
import {
  Wrench, Shield, Globe, Zap, GitBranch, Cookie, AlertTriangle,
  RefreshCw, Save, CheckCircle, AlertCircle, ChevronDown, ChevronUp,
  Clock, Code, Gauge, FlipHorizontal, Gamepad2, ShieldAlert
} from 'lucide-react';
import { domainAPI } from '../../api/client';
import { Switch } from '@/components/ui/switch';

// ─── helpers ───────────────────────────────────────────────────────────────
const ISO_COUNTRIES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX',
  'AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ',
  'BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK',
  'CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM',
  'DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS',
  'GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN',
  'IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN',
  'KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV',
  'LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ',
  'MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI',
  'NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM',
  'PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC',
  'SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV',
  'SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR',
  'TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
  'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
];

function Section({ icon: Icon, title, description, color = '#9D4EDD', children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border"
            style={{ background: `${color}18`, borderColor: `${color}44` }}
          >
            <Icon className="w-5 h-5" style={{ color }} strokeWidth={1.5} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-white">{title}</p>
            <p className="text-xs text-white/50 font-light">{description}</p>
          </div>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-white/40 flex-shrink-0" strokeWidth={1.5} />
          : <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" strokeWidth={1.5} />
        }
      </button>
      {open && <div className="px-4 pb-5 pt-1 space-y-4">{children}</div>}
    </div>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange, icon: Icon, color = '#9D4EDD' }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.14] transition-all">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center border" style={{ background: `${color}18`, borderColor: `${color}44` }}>
            <Icon className="w-4 h-4" style={{ color }} strokeWidth={1.5} />
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-white">{label}</p>
          {description && <p className="text-xs text-white/50 mt-0.5">{description}</p>}
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-white/60 mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="text-xs text-white/35 mt-1">{hint}</p>}
    </div>
  );
}

const INPUT = 'w-full bg-white/[0.04] border border-white/[0.12] hover:border-white/[0.2] rounded-lg px-3 py-2 text-white text-sm font-light focus:outline-none focus:border-[#9D4EDD]/60 focus:ring-2 focus:ring-[#9D4EDD]/20 transition-all placeholder:text-white/25';
const TEXTAREA = INPUT + ' resize-y min-h-[80px] font-mono text-xs';

// ─── Country picker ─────────────────────────────────────────────────────────
function CountryInput({ value, onChange, placeholder }) {
  const [input, setInput] = useState('');

  const add = () => {
    const code = input.trim().toUpperCase().slice(0, 2);
    if (code.length === 2 && !value.includes(code)) {
      onChange([...value, code]);
    }
    setInput('');
  };

  const remove = (code) => onChange(value.filter(c => c !== code));

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          className={INPUT + ' flex-1'}
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase().slice(0, 2))}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder || 'Code pays ISO (ex: FR)'}
          maxLength={2}
          list="iso-countries"
        />
        <datalist id="iso-countries">
          {ISO_COUNTRIES.map(c => <option key={c} value={c} />)}
        </datalist>
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 bg-[#9D4EDD]/20 border border-[#9D4EDD]/30 hover:bg-[#9D4EDD]/30 text-[#C77DFF] rounded-lg text-sm font-light transition-all"
        >
          +
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map(code => (
            <span
              key={code}
              className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.04] border border-white/[0.12] rounded-md text-xs text-white"
            >
              {code}
              <button onClick={() => remove(code)} className="text-white/40 hover:text-[#F87171] transition-colors">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DomainAdvancedPanel({ domain, onUpdate }) {
  const [saving, setSaving] = useState({});
  const [messages, setMessages] = useState({});

  // Maintenance
  const [maintenance, setMaintenance] = useState({
    enabled: domain?.maintenance_mode || false,
    message: domain?.maintenance_message || '',
    endTime: domain?.maintenance_end_time ? new Date(domain.maintenance_end_time).toISOString().slice(0, 16) : '',
    customPage: domain?.custom_maintenance_page || ''
  });

  // Error pages
  const [errorPages, setErrorPages] = useState({
    custom404: domain?.custom_404_page || '',
    custom502: domain?.custom_502_page || '',
    custom503: domain?.custom_503_page || ''
  });

  // Rate limit
  const [rateLimit, setRateLimit] = useState({
    enabled: domain?.rate_limit_enabled || false,
    max: domain?.rate_limit_max || 100,
    window: domain?.rate_limit_window || 60
  });

  // Mirror
  const [mirror, setMirror] = useState({
    enabled: domain?.mirror_enabled || false,
    backendUrl: domain?.mirror_backend_url || ''
  });

  // GeoIP
  const [geoip, setGeoip] = useState({
    enabled: domain?.geoip_blocking_enabled || false,
    blockedCountries: domain?.geoip_blocked_countries || [],
    allowedCountries: domain?.geoip_allowed_countries || []
  });

  // Sticky sessions
  const [sticky, setSticky] = useState({
    enabled: domain?.sticky_sessions_enabled || false,
    ttl: domain?.sticky_sessions_ttl || 3600
  });

  // PROXY Protocol (Minecraft + TCP)
  const [proxyProtocol, setProxyProtocol] = useState(domain?.proxy_protocol || false);

  // Geyser PROXY Protocol v2 (UDP only)
  const [geyserProxyProtocol, setGeyserProxyProtocol] = useState(domain?.geyser_proxy_protocol || false);

  // Anti-DDoS protection
  const [ddos, setDdos] = useState({
    enabled:              domain?.ddos_protection_enabled     || false,
    reqPerSecond:         domain?.ddos_req_per_second         || 100,
    connectionsPerMinute: domain?.ddos_connections_per_minute || 60,
    banDurationSec:       domain?.ddos_ban_duration_sec       || 3600,
    maxConnectionsPerIp:  domain?.ddos_max_connections_per_ip || 50,
    challengeMode:        domain?.ddos_challenge_mode         || false,
    banOn4xxRate:         domain?.ddos_ban_on_4xx_rate        || false,
  });

  // Sync when parent domain changes
  useEffect(() => {
    if (!domain) return;
    setMaintenance({
      enabled: domain.maintenance_mode || false,
      message: domain.maintenance_message || '',
      endTime: domain.maintenance_end_time ? new Date(domain.maintenance_end_time).toISOString().slice(0, 16) : '',
      customPage: domain.custom_maintenance_page || ''
    });
    setErrorPages({ custom404: domain.custom_404_page || '', custom502: domain.custom_502_page || '', custom503: domain.custom_503_page || '' });
    setRateLimit({ enabled: domain.rate_limit_enabled || false, max: domain.rate_limit_max || 100, window: domain.rate_limit_window || 60 });
    setMirror({ enabled: domain.mirror_enabled || false, backendUrl: domain.mirror_backend_url || '' });
    setGeoip({ enabled: domain.geoip_blocking_enabled || false, blockedCountries: domain.geoip_blocked_countries || [], allowedCountries: domain.geoip_allowed_countries || [] });
    setSticky({ enabled: domain.sticky_sessions_enabled || false, ttl: domain.sticky_sessions_ttl || 3600 });
    setProxyProtocol(domain.proxy_protocol || false);
    setGeyserProxyProtocol(domain.geyser_proxy_protocol || false);
    setDdos({
      enabled:              domain.ddos_protection_enabled     || false,
      reqPerSecond:         domain.ddos_req_per_second         || 100,
      connectionsPerMinute: domain.ddos_connections_per_minute || 60,
      banDurationSec:       domain.ddos_ban_duration_sec       || 3600,
      maxConnectionsPerIp:  domain.ddos_max_connections_per_ip || 50,
      challengeMode:        domain.ddos_challenge_mode         || false,
      banOn4xxRate:         domain.ddos_ban_on_4xx_rate        || false,
    });
  }, [domain]);

  const flash = (key, msg, isError = false) => {
    setMessages(m => ({ ...m, [key]: { msg, isError } }));
    setTimeout(() => setMessages(m => { const n = { ...m }; delete n[key]; return n; }), 3500);
  };

  const save = async (key, apiFn, payload) => {
    setSaving(s => ({ ...s, [key]: true }));
    try {
      await apiFn(domain.id, payload);
      flash(key, 'Saved successfully');
      if (onUpdate) onUpdate();
    } catch (err) {
      flash(key, err.response?.data?.message || 'Save failed', true);
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const SaveBtn = ({ skey, onClick }) => (
    <button
      onClick={onClick}
      disabled={saving[skey]}
      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] hover:from-[#7B2CBF] hover:to-[#5B1F9C] text-white rounded-lg text-sm font-light transition-all disabled:opacity-50"
    >
      {saving[skey]
        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />Saving…</>
        : <><Save className="w-3.5 h-3.5" strokeWidth={1.5} />Save</>
      }
    </button>
  );

  const Msg = ({ skey }) => {
    const m = messages[skey];
    if (!m) return null;
    return (
      <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${m.isError ? 'bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#F87171]' : 'bg-[#10B981]/10 border border-[#10B981]/20 text-[#34D399]'}`}>
        {m.isError
          ? <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
          : <CheckCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
        }
        {m.msg}
      </div>
    );
  };

  if (!domain) return null;

  return (
    <div className="space-y-4">

      {/* ── Maintenance Mode ──────────────────────────────────────────────── */}
      {domain.proxy_type === 'http' && <Section icon={Wrench} title="Mode Maintenance" description="Affiche une page de maintenance aux visiteurs" color="#F59E0B">
        <ToggleRow
          label="Activer la maintenance"
          description={maintenance.enabled ? 'Les visiteurs voient une page 503' : 'Trafic normal'}
          checked={maintenance.enabled}
          onCheckedChange={v => setMaintenance(m => ({ ...m, enabled: v }))}
          icon={Wrench}
          color="#F59E0B"
        />
        <Field label="Message affiché aux visiteurs" hint="Laissez vide pour utiliser le message par défaut">
          <textarea
            className={TEXTAREA}
            value={maintenance.message}
            onChange={e => setMaintenance(m => ({ ...m, message: e.target.value }))}
            placeholder="Service en maintenance. Veuillez réessayer plus tard."
          />
        </Field>
        <Field label="Fin de maintenance prévue (optionnel)">
          <input
            type="datetime-local"
            className={INPUT}
            value={maintenance.endTime}
            onChange={e => setMaintenance(m => ({ ...m, endTime: e.target.value }))}
          />
        </Field>
        <Field label="Page de maintenance personnalisée (HTML)" hint="HTML complet à afficher aux visiteurs. Laissez vide pour utiliser la page générée automatiquement.">
          <textarea
            className={TEXTAREA}
            value={maintenance.customPage}
            onChange={e => setMaintenance(m => ({ ...m, customPage: e.target.value }))}
            placeholder="<!doctype html><html>...</html>"
          />
        </Field>
        <Msg skey="maintenance" />
        <SaveBtn skey="maintenance" onClick={() => save('maintenance', domainAPI.setMaintenance, {
          enabled: maintenance.enabled,
          message: maintenance.message || undefined,
          endTime: maintenance.endTime ? new Date(maintenance.endTime).toISOString() : null,
          customPage: maintenance.customPage
        })} />
      </Section>}

      {/* ── Custom Error Pages ────────────────────────────────────────────── */}
      {domain.proxy_type === 'http' && <Section icon={Code} title="Pages d'erreur personnalisées" description="HTML affiché pour les erreurs 404, 502, 503" color="#22D3EE">
        <Field label="Page 404 (Not Found)" hint="HTML complet ou fragment. Laissez vide pour le comportement par défaut.">
          <textarea className={TEXTAREA} value={errorPages.custom404} onChange={e => setErrorPages(p => ({ ...p, custom404: e.target.value }))} placeholder="<h1>Page introuvable</h1>" />
        </Field>
        <Field label="Page 502 (Bad Gateway)">
          <textarea className={TEXTAREA} value={errorPages.custom502} onChange={e => setErrorPages(p => ({ ...p, custom502: e.target.value }))} placeholder="<h1>Erreur serveur</h1>" />
        </Field>
        <Field label="Page 503 (Service Unavailable)">
          <textarea className={TEXTAREA} value={errorPages.custom503} onChange={e => setErrorPages(p => ({ ...p, custom503: e.target.value }))} placeholder="<h1>Service temporairement indisponible</h1>" />
        </Field>
        <Msg skey="errorPages" />
        <SaveBtn skey="errorPages" onClick={() => save('errorPages', domainAPI.setErrorPages, errorPages)} />
      </Section>}

      {/* ── Per-Domain Rate Limiting ──────────────────────────────────────── */}
      {domain.proxy_type === 'http' && <Section icon={Gauge} title="Rate Limiting par domaine" description="Limite les requêtes par IP sur ce domaine" color="#C77DFF">
        <ToggleRow
          label="Activer le rate limiting"
          description="Appliqué via Redis — échoue ouvert si Redis est indisponible"
          checked={rateLimit.enabled}
          onCheckedChange={v => setRateLimit(r => ({ ...r, enabled: v }))}
          icon={Gauge}
          color="#C77DFF"
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Requêtes max" hint="Par IP et par fenêtre temporelle">
            <input type="number" min="1" max="100000" className={INPUT} value={rateLimit.max} onChange={e => setRateLimit(r => ({ ...r, max: parseInt(e.target.value) || 100 }))} />
          </Field>
          <Field label="Fenêtre (secondes)" hint="Durée de la fenêtre glissante">
            <input type="number" min="1" max="86400" className={INPUT} value={rateLimit.window} onChange={e => setRateLimit(r => ({ ...r, window: parseInt(e.target.value) || 60 }))} />
          </Field>
        </div>
        <Msg skey="rateLimit" />
        <SaveBtn skey="rateLimit" onClick={() => save('rateLimit', domainAPI.setRateLimit, {
          enabled: rateLimit.enabled, max: rateLimit.max, window: rateLimit.window
        })} />
      </Section>}

      {/* ── Traffic Mirroring ─────────────────────────────────────────────── */}
      {domain.proxy_type === 'http' && <Section icon={FlipHorizontal} title="Mirroring du trafic" description="Duplique chaque requête vers un backend shadow (fire & forget)" color="#34D399">
        <ToggleRow
          label="Activer le mirroring"
          description="Le backend shadow reçoit une copie — la réponse est ignorée"
          checked={mirror.enabled}
          onCheckedChange={v => setMirror(m => ({ ...m, enabled: v }))}
          icon={GitBranch}
          color="#34D399"
        />
        <Field label="URL du backend shadow" hint="Ex : http://shadow.internal:9000">
          <input type="url" className={INPUT} value={mirror.backendUrl} onChange={e => setMirror(m => ({ ...m, backendUrl: e.target.value }))} placeholder="http://shadow.internal:9000" />
        </Field>
        <Msg skey="mirror" />
        <SaveBtn skey="mirror" onClick={() => save('mirror', domainAPI.setMirror, {
          enabled: mirror.enabled, backendUrl: mirror.backendUrl || undefined
        })} />
      </Section>}

      {/* ── GeoIP Blocking ────────────────────────────────────────────────── */}
      {domain.proxy_type === 'http' && <Section icon={Globe} title="Blocage GeoIP" description="Autorise ou bloque des pays entiers" color="#F87171">
        <ToggleRow
          label="Activer le filtrage GeoIP"
          description="Utilise ip-api.com — résultats mis en cache Redis 24h"
          checked={geoip.enabled}
          onCheckedChange={v => setGeoip(g => ({ ...g, enabled: v }))}
          icon={Shield}
          color="#F87171"
        />
        <div className="p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg text-xs text-[#FBBF24]">
          <strong>Priorité :</strong> Si la liste blanche est définie, seuls ces pays sont autorisés.<br />
          Si seule la liste noire est définie, ces pays sont bloqués.
        </div>
        <Field label="Liste blanche — pays autorisés uniquement" hint="Laissez vide pour n'utiliser que la liste noire">
          <CountryInput value={geoip.allowedCountries} onChange={v => setGeoip(g => ({ ...g, allowedCountries: v }))} placeholder="Code ISO (ex: FR, DE, US)" />
        </Field>
        <Field label="Liste noire — pays bloqués" hint="Ignoré si la liste blanche est définie">
          <CountryInput value={geoip.blockedCountries} onChange={v => setGeoip(g => ({ ...g, blockedCountries: v }))} placeholder="Code ISO (ex: CN, RU)" />
        </Field>
        <Msg skey="geoip" />
        <SaveBtn skey="geoip" onClick={() => save('geoip', domainAPI.setGeoip, {
          enabled: geoip.enabled,
          blockedCountries: geoip.blockedCountries.length ? geoip.blockedCountries : undefined,
          allowedCountries: geoip.allowedCountries.length ? geoip.allowedCountries : undefined
        })} />
      </Section>}

      {/* ── Sticky Sessions ───────────────────────────────────────────────── */}
      {domain.proxy_type === 'http' && <Section icon={Cookie} title="Sticky Sessions" description="Ancre chaque client à un backend via cookie HTTP" color="#FBBF24">
        <ToggleRow
          label="Activer les sticky sessions"
          description="Cookie __nebula_srv — compatible avec l'algorithme Sticky Session"
          checked={sticky.enabled}
          onCheckedChange={v => setSticky(s => ({ ...s, enabled: v }))}
          icon={Cookie}
          color="#FBBF24"
        />
        <Field label="TTL du cookie (secondes)" hint="Durée de vie maximale : 2 592 000 s (30 jours)">
          <input type="number" min="60" max="2592000" className={INPUT} value={sticky.ttl} onChange={e => setSticky(s => ({ ...s, ttl: parseInt(e.target.value) || 3600 }))} />
        </Field>
        {sticky.enabled && domain?.load_balancing_algorithm !== 'sticky-session' && (
          <div className="flex items-start gap-2 p-3 bg-[#FBBF24]/10 border border-[#FBBF24]/20 rounded-lg text-xs text-[#FBBF24]">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <span>Pour que les sticky sessions fonctionnent correctement, sélectionnez l'algorithme <strong>Sticky Session</strong> dans l'onglet Load Balancing.</span>
          </div>
        )}
        <Msg skey="sticky" />
        <SaveBtn skey="sticky" onClick={() => save('sticky', domainAPI.setStickySessions, {
          enabled: sticky.enabled, ttl: sticky.ttl
        })} />
      </Section>}

      {/* ── PROXY Protocol (Minecraft + TCP) ─────────────────────────────── */}
      {(domain.proxy_type === 'minecraft' || domain.proxy_type === 'tcp') && (
        <Section icon={Gamepad2} title="PROXY Protocol" description="Transmet l'IP réelle via HAProxy Protocol v1" color="#F97316">
          <ToggleRow
            label="Activer le PROXY Protocol"
            description="Envoie PROXY TCP4 <ip> avant le premier paquet"
            checked={proxyProtocol}
            onCheckedChange={v => setProxyProtocol(v)}
            icon={Gamepad2}
            color="#F97316"
          />
          {proxyProtocol && (
            <div className="flex items-start gap-2 p-3 bg-[#F97316]/10 border border-[#F97316]/20 rounded-lg text-xs text-[#FB923C]">
              <Gamepad2 className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div className="space-y-1">
                <p><strong>Paper</strong> — dans <code>config/paper-global.yml</code> :</p>
                <p className="font-mono bg-black/20 px-2 py-0.5 rounded">proxies.proxy-protocol: true</p>
                <p className="mt-1"><strong>Velocity</strong> — dans <code>velocity.toml</code> :</p>
                <p className="font-mono bg-black/20 px-2 py-0.5 rounded">haproxy-protocol = true</p>
              </div>
            </div>
          )}
          <Msg skey="proxyprotocol" />
          <SaveBtn skey="proxyprotocol" onClick={() => save('proxyprotocol', domainAPI.setProxyProtocol, { enabled: proxyProtocol })} />
        </Section>
      )}

      {/* ── Geyser PROXY Protocol v2 (Bedrock only) ─────────────────────── */}
      {(domain.proxy_type === 'udp' || (domain.proxy_type === 'minecraft' && domain.minecraft_edition === 'bedrock')) && (
        <Section icon={Gamepad2} title="Geyser PROXY Protocol" description="Transmet l'IP réelle des joueurs Bedrock via PROXY Protocol v2" color="#22D3EE">
          <ToggleRow
            label="Activer le PROXY Protocol v2 pour Geyser"
            description="Injecte un header binaire dans le premier paquet UDP vers Geyser"
            checked={geyserProxyProtocol}
            onCheckedChange={v => setGeyserProxyProtocol(v)}
            icon={Gamepad2}
            color="#22D3EE"
          />
          {geyserProxyProtocol && (
            <div className="flex items-start gap-2 p-3 bg-[#22D3EE]/10 border border-[#22D3EE]/20 rounded-lg text-xs text-[#67E8F9]">
              <Gamepad2 className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <div className="space-y-1">
                <p>Active <code>use-proxy-protocol: true</code> dans <code>config.yml</code> de Geyser :</p>
                <p className="font-mono bg-black/20 px-2 py-0.5 rounded">bedrock:</p>
                <p className="font-mono bg-black/20 px-2 py-0.5 rounded">&nbsp;&nbsp;use-proxy-protocol: true</p>
              </div>
            </div>
          )}
          <Msg skey="geyserproxyprotocol" />
          <SaveBtn skey="geyserproxyprotocol" onClick={() => save('geyserproxyprotocol', domainAPI.setGeyserProxyProtocol, { enabled: geyserProxyProtocol })} />
        </Section>
      )}

      {/* ── Anti-DDoS Protection (all proxy types) ──────────────────────── */}
      <Section icon={ShieldAlert} title="Protection Anti-DDoS" description="Bloque les IPs malveillantes via rate limiting et listes de menaces (blocklist.de, Emerging Threats, CI Badguys)" color="#EF4444">
        <ToggleRow
          label="Activer la protection Anti-DDoS"
          description="Analyse le trafic et bannit automatiquement les IPs qui dépassent les seuils configurés"
          checked={ddos.enabled}
          onCheckedChange={v => setDdos(d => ({ ...d, enabled: v }))}
          icon={ShieldAlert}
          color="#EF4444"
        />
        {ddos.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
            <Field label="Requêtes / seconde" hint="Seuil avant ban automatique (HTTP)">
              <input
                type="number" min="1" max="10000" className={INPUT}
                value={ddos.reqPerSecond}
                onChange={e => setDdos(d => ({ ...d, reqPerSecond: parseInt(e.target.value) || 100 }))}
              />
            </Field>
            <Field label="Connexions / minute" hint="Seuil avant ban (TCP/UDP/Minecraft)">
              <input
                type="number" min="1" max="10000" className={INPUT}
                value={ddos.connectionsPerMinute}
                onChange={e => setDdos(d => ({ ...d, connectionsPerMinute: parseInt(e.target.value) || 60 }))}
              />
            </Field>
            <Field label="Durée du ban (secondes)" hint="0 = permanent">
              <input
                type="number" min="0" max="86400" className={INPUT}
                value={ddos.banDurationSec}
                onChange={e => setDdos(d => ({ ...d, banDurationSec: parseInt(e.target.value) || 3600 }))}
              />
            </Field>
            <Field label="Connexions simultanées max / IP" hint="TCP & Minecraft uniquement">
              <input
                type="number" min="1" max="1000" className={INPUT}
                value={ddos.maxConnectionsPerIp}
                onChange={e => setDdos(d => ({ ...d, maxConnectionsPerIp: parseInt(e.target.value) || 50 }))}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-3 mt-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={ddos.challengeMode}
                onChange={e => setDdos(d => ({ ...d, challengeMode: e.target.checked }))}
                className="rounded border-white/20 bg-white/5 text-[#3B82F6] focus:ring-0" />
              <span className="text-sm text-white/70">Mode Challenge (HTTP uniquement) — JS proof-of-work avant d'accéder au site</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={ddos.banOn4xxRate}
                onChange={e => setDdos(d => ({ ...d, banOn4xxRate: e.target.checked }))}
                className="rounded border-white/20 bg-white/5 text-[#3B82F6] focus:ring-0" />
              <span className="text-sm text-white/70">Ban automatique sur taux élevé d'erreurs 4xx (scanners, fuzzers)</span>
            </label>
          </div>
        )}
        <Msg skey="ddos" />
        <SaveBtn skey="ddos" onClick={() => save('ddos', domainAPI.setDdosProtection, {
          enabled:              ddos.enabled,
          reqPerSecond:         ddos.reqPerSecond,
          connectionsPerMinute: ddos.connectionsPerMinute,
          banDurationSec:       ddos.banDurationSec,
          maxConnectionsPerIp:  ddos.maxConnectionsPerIp,
          challengeMode:        ddos.challengeMode,
          banOn4xxRate:         ddos.banOn4xxRate,
        })} />
      </Section>

    </div>
  );
}
