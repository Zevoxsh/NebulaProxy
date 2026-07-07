import { useState, useEffect } from 'react';
import {
  RefreshCw, Save, CheckCircle, AlertCircle, ChevronDown, ChevronUp,
  Gauge, Gamepad2
} from 'lucide-react';
import { domainAPI } from '../../api/client';
import { Switch } from '@/components/ui/switch';

// ─── helpers ───────────────────────────────────────────────────────────────
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

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DomainAdvancedPanel({ domain, onUpdate }) {
  const [saving, setSaving] = useState({});
  const [messages, setMessages] = useState({});

  // Rate limit
  const [rateLimit, setRateLimit] = useState({
    enabled: domain?.rate_limit_enabled || false,
    max: domain?.rate_limit_max || 100,
    window: domain?.rate_limit_window || 60
  });

  // PROXY Protocol (Minecraft + TCP)
  const [proxyProtocol, setProxyProtocol] = useState(domain?.proxy_protocol || false);

  // Geyser PROXY Protocol v2 (UDP only)
  const [geyserProxyProtocol, setGeyserProxyProtocol] = useState(domain?.geyser_proxy_protocol || false);

  // Sync when parent domain changes
  useEffect(() => {
    if (!domain) return;
    setRateLimit({ enabled: domain.rate_limit_enabled || false, max: domain.rate_limit_max || 100, window: domain.rate_limit_window || 60 });
    setProxyProtocol(domain.proxy_protocol || false);
    setGeyserProxyProtocol(domain.geyser_proxy_protocol || false);
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

    </div>
  );
}
