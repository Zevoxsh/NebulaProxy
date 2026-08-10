import { useEffect, useState } from 'react';
import { Save, Loader, Check, AlertCircle, Bell, Webhook, ChevronRight, Send } from 'lucide-react';
import { notificationAPI } from '../api/client';
import AccountNav from '../components/features/AccountNav';

const DEFAULT_PREFS = {
  webhook_enabled: false,
  webhook_url: '',
  webhook_secret: '',
  domain_down_enabled: true,
  domain_up_enabled: true,
};

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/80">{label}</p>
        {description && <p className="text-xs text-white/40 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-admin-primary' : 'bg-white/10'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}

export default function Notifications() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  useEffect(() => {
    (async () => {
      try {
        const res = await notificationAPI.getPreferences();
        const data = res.data?.preferences || {};
        setPrefs({ ...DEFAULT_PREFS, ...data });
      } catch {
        setError('Impossible de charger les préférences.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (key, val) => setPrefs(p => ({ ...p, [key]: val }));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      await notificationAPI.updatePreferences(prefs);
      setSuccess('Préférences sauvegardées.');
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Échec de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!prefs.webhook_url) {
      setTestMsg('Configurez d\'abord une URL webhook.');
      setTimeout(() => setTestMsg(''), 4000);
      return;
    }
    try {
      setTesting(true);
      setTestMsg('');
      await notificationAPI.updatePreferences(prefs);
      await notificationAPI.testWebhook();
      setTestMsg('Test envoyé avec succès !');
    } catch {
      setTestMsg('Échec du test webhook.');
    } finally {
      setTesting(false);
      setTimeout(() => setTestMsg(''), 5000);
    }
  };

  const isDiscord = prefs.webhook_url?.includes('discord.com/api/webhooks/') ||
                    prefs.webhook_url?.includes('discordapp.com/api/webhooks/');

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <Loader className="w-5 h-5 text-white/40 animate-spin" />
      </div>
    );
  }

  return (
    <div className="pb-12 animate-fade-in">
      {/* Hero */}
      <div className="relative mb-16">
        <div className="h-32 rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.06] relative">
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
          <div className="w-24 h-24 rounded-full ring-4 ring-admin-bg bg-zinc-800 border border-white/[0.08] flex items-center justify-center">
            <Bell className="w-8 h-8 text-white/60" strokeWidth={1.5} />
          </div>
        </div>
      </div>

      <div className="text-center mt-4">
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <p className="text-sm text-white/40 mt-1">Alertes domain down / up</p>
        <div className="flex items-center justify-center mt-4">
          <AccountNav current="notifications" />
        </div>
      </div>

      {(error || success) && (
        <div className={`mt-8 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${
          error
            ? 'bg-red-500/10 border-red-500/25 text-red-300'
            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
        }`}>
          {error
            ? <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            : <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />}
          {error || success}
        </div>
      )}

      <div className="h-px bg-white/10 my-8" />

      {/* Domain alerts */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-5">
          <ChevronRight className="w-4 h-4 text-white/30" strokeWidth={1.5} />
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">Alertes domaine</h2>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-5 py-4 space-y-5">
          <Toggle
            checked={prefs.domain_down_enabled}
            onChange={v => set('domain_down_enabled', v)}
            label="Domaine inaccessible"
            description="Reçois une alerte quand un domaine tombe (après 3 échecs consécutifs)"
          />
          <div className="h-px bg-white/[0.06]" />
          <Toggle
            checked={prefs.domain_up_enabled}
            onChange={v => set('domain_up_enabled', v)}
            label="Domaine rétabli"
            description="Reçois une alerte quand un domaine revient en ligne"
          />
        </div>
      </section>

      <div className="h-px bg-white/[0.06] my-8" />

      {/* Webhook */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-5">
          <ChevronRight className="w-4 h-4 text-white/30" strokeWidth={1.5} />
          <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">Webhook</h2>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-5 py-4 space-y-5">
          <Toggle
            checked={prefs.webhook_enabled}
            onChange={v => set('webhook_enabled', v)}
            label="Activer le webhook"
            description="Envoie les alertes vers l'URL ci-dessous"
          />

          <div className="h-px bg-white/[0.06]" />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-white/50 flex-1">URL Webhook</label>
              {isDiscord && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#5865F2]/20 text-[#7289DA]">
                  Discord détecté
                </span>
              )}
            </div>
            <input
              type="url"
              value={prefs.webhook_url}
              onChange={e => set('webhook_url', e.target.value)}
              className="input-futuristic text-sm w-full"
              placeholder="https://discord.com/api/webhooks/..."
            />
            <p className="text-xs text-white/30">
              Compatible Discord, Slack, n8n ou tout endpoint HTTP POST.
            </p>
          </div>

          {!isDiscord && (
            <>
              <div className="h-px bg-white/[0.06]" />
              <div className="space-y-2">
                <label className="text-sm text-white/50">Secret HMAC (optionnel)</label>
                <input
                  type="password"
                  value={prefs.webhook_secret}
                  onChange={e => set('webhook_secret', e.target.value)}
                  className="input-futuristic text-sm w-full"
                  placeholder="Clé secrète pour signer les requêtes"
                />
                <p className="text-xs text-white/30">
                  Fourni dans le header <code className="text-white/50">X-Nebula-Signature</code>.
                </p>
              </div>
            </>
          )}

          {testMsg && (
            <p className={`text-xs ${testMsg.includes('succès') ? 'text-emerald-400' : 'text-red-400'}`}>
              {testMsg}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !prefs.webhook_url}
              className="btn-secondary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40"
            >
              {testing
                ? <Loader className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                : <Send className="w-4 h-4" strokeWidth={1.5} />}
              Tester
            </button>
          </div>
        </div>
      </section>

      <div className="flex justify-end mt-8">
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2">
          {saving
            ? <><Loader className="w-4 h-4 animate-spin" strokeWidth={1.5} /> Sauvegarde…</>
            : <><Save className="w-4 h-4" strokeWidth={1.5} /> Sauvegarder</>}
        </button>
      </div>
    </div>
  );
}
