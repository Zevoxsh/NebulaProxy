import { useState, useEffect } from 'react';
import {
  Wrench,
  RefreshCw, Save, CheckCircle, AlertCircle, ChevronDown, ChevronUp
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
const TEXTAREA = INPUT + ' resize-y min-h-[80px] font-mono text-xs';

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DomainMaintenancePanel({ domain, onUpdate }) {
  const [saving, setSaving] = useState({});
  const [messages, setMessages] = useState({});

  // Maintenance
  const [maintenance, setMaintenance] = useState({
    enabled: domain?.maintenance_mode || false,
    message: domain?.maintenance_message || '',
    endTime: domain?.maintenance_end_time ? new Date(domain.maintenance_end_time).toISOString().slice(0, 16) : '',
    customPage: domain?.custom_maintenance_page || ''
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

    </div>
  );
}
