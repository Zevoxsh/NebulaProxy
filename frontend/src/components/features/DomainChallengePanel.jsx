import { useState, useEffect } from 'react';
import {
  Zap, RefreshCw, Save, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Check, Bot
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

// One selectable puzzle-type chip
function TypeChip({ type, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(type.id)}
      className={`flex items-start gap-2 p-2.5 rounded-lg border text-left transition-all ${
        selected
          ? 'bg-[#9D4EDD]/15 border-[#9D4EDD]/40'
          : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.16]'
      }`}
    >
      <div className={`w-4 h-4 mt-0.5 rounded flex items-center justify-center flex-shrink-0 border ${
        selected ? 'bg-[#9D4EDD] border-[#9D4EDD]' : 'border-white/25'
      }`}>
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-white truncate">{type.label}</p>
        {type.desc && <p className="text-[11px] text-white/40 mt-0.5 truncate">{type.desc}</p>}
      </div>
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
// Which challenge is shown to a given visitor is picked at random from this
// domain's selection — itself a subset of whatever the admin has globally
// enabled (Admin → Challenge). An empty selection here means "use all types
// the admin allows", not "no challenge" (the on/off toggle above controls that).
export default function DomainChallengePanel({ domain, onUpdate }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [challengeMode, setChallengeMode] = useState(domain?.ddos_challenge_mode || false);
  const [selectedTypes, setSelectedTypes] = useState(domain?.ddos_challenge_types || []);
  const [antibot, setAntibot] = useState(domain?.antibot_enabled || false);
  const [antibotSaving, setAntibotSaving] = useState(false);

  useEffect(() => {
    if (!domain) return;
    setChallengeMode(domain.ddos_challenge_mode || false);
    setSelectedTypes(domain.ddos_challenge_types || []);
    setAntibot(domain.antibot_enabled || false);
  }, [domain]);

  useEffect(() => {
    domainAPI.getChallengeTypesCatalog()
      .then(res => setCatalog(res.data.types || []))
      .catch(() => setMessage({ text: 'Impossible de charger les types de challenge', isError: true }))
      .finally(() => setLoadingCatalog(false));
  }, []);

  const flash = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 3500);
  };

  const toggleType = (id) => {
    setSelectedTypes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const toggleAntibot = async (value) => {
    setAntibot(value);
    setAntibotSaving(true);
    try {
      await domainAPI.setAntibot(domain.id, { enabled: value });
      flash(value ? 'Bouclier Nebula activé' : 'Bouclier Nebula désactivé');
      if (onUpdate) onUpdate();
    } catch (err) {
      setAntibot(!value);
      flash(err.response?.data?.message || "Échec de la mise à jour de l'anti-bot", true);
    } finally {
      setAntibotSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await domainAPI.setDdosProtection(domain.id, { challengeMode, challengeTypes: selectedTypes });
      flash('Enregistré avec succès');
      if (onUpdate) onUpdate();
    } catch (err) {
      flash(err.response?.data?.message || 'Échec de la sauvegarde', true);
    } finally {
      setSaving(false);
    }
  };

  if (!domain) return null;
  if (domain.proxy_type !== 'http') {
    return (
      <div className="p-6 text-center text-sm text-white/40">
        Le Challenge n'est disponible que pour les domaines HTTP.
      </div>
    );
  }

  const categories = [...new Set(catalog.map(t => t.category))];

  return (
    <div className="space-y-4">
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${message.isError ? 'bg-[#EF4444]/10 border border-[#EF4444]/20 text-[#F87171]' : 'bg-[#10B981]/10 border border-[#10B981]/20 text-[#34D399]'}`}>
          {message.isError
            ? <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
            : <CheckCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
          }
          {message.text}
        </div>
      )}

      <Section icon={Bot} title="Anti-bot (Bouclier Nebula)" description="Challenge de preuve de travail bloquant les scrapers et bots IA avant l'accès au site" color="#F59E0B">
        <ToggleRow
          label="Activer la protection anti-bot"
          description="Chaque visiteur résout un défi de preuve de travail (invisible pour un navigateur normal) avant d'atteindre le backend"
          checked={antibot}
          onCheckedChange={v => { if (!antibotSaving) toggleAntibot(v); }}
          icon={Bot}
          color="#F59E0B"
        />
        <p className="text-xs text-white/35">
          Module natif <span className="text-[#F59E0B]/80">Bouclier Nebula</span> — aucun service externe.
          Les WebSockets et le trafic déjà vérifié passent sans re-challenge ; le cookie de vérification est valable 7 jours.
        </p>
      </Section>

      <Section icon={Zap} title="Challenge" description="Présente un challenge aux visiteurs avant l'accès au site" color="#3B82F6">
        <ToggleRow
          label="Activer le mode Challenge"
          description="Chaque nouveau visiteur doit résoudre un challenge avant d'accéder au site"
          checked={challengeMode}
          onCheckedChange={v => setChallengeMode(v)}
          icon={Zap}
          color="#3B82F6"
        />

        <div>
          <p className="text-xs font-medium text-white/60 mb-1.5">Types de challenge activés sur ce domaine</p>
          <p className="text-xs text-white/35 mb-3">
            Laissez tout décoché pour utiliser tous les types autorisés par l'administrateur. Une sélection ici restreint encore ce sous-ensemble pour ce domaine uniquement.
          </p>

          {loadingCatalog ? (
            <p className="text-xs text-white/40">Chargement…</p>
          ) : (
            <div className="space-y-4">
              {categories.map(cat => (
                <div key={cat}>
                  <p className="text-[11px] uppercase tracking-wider text-white/35 mb-2">{cat}</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {catalog.filter(t => t.category === cat).map(t => (
                      <TypeChip key={t.id} type={t} selected={selectedTypes.includes(t.id)} onToggle={toggleType} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] hover:from-[#7B2CBF] hover:to-[#5B1F9C] text-white rounded-lg text-sm font-light transition-all disabled:opacity-50"
        >
          {saving
            ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />Saving…</>
            : <><Save className="w-3.5 h-3.5" strokeWidth={1.5} />Save</>
          }
        </button>
      </Section>
    </div>
  );
}
