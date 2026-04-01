import { useState, useEffect } from 'react';
import { Zap, Save } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent, AdminCardFooter,
  AdminButton, AdminAlert, AdminAlertDescription
} from '@/components/admin';

export default function AdminDdos() {
  const [types, setTypes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [message, setMessage] = useState(null);

  const showMsg = (type, text, ms = 4000) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), ms);
  };

  useEffect(() => {
    adminAPI.getChallengeTypes()
      .then(res => setTypes(res.data.types || []))
      .catch(() => showMsg('error', 'Impossible de charger les types de challenge'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id) => {
    setTypes(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const save = async () => {
    const enabledIds = types.filter(t => t.enabled).map(t => t.id);
    if (enabledIds.length === 0) {
      showMsg('error', 'Au moins un type doit rester actif');
      return;
    }
    setSaving(true);
    try {
      await adminAPI.setChallengeTypes(enabledIds);
      showMsg('success', `${enabledIds.length} type(s) actif(s) enregistré(s)`);
    } catch (e) {
      showMsg('error', e.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const allEnabled   = types.every(t => t.enabled);
  const toggleAll    = () => setTypes(prev => prev.map(t => ({ ...t, enabled: !allEnabled })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Challenge</h1>
        <p className="text-white/50 mt-1 text-sm">Choisissez les types de challenge présentés aux visiteurs HTTP.</p>
      </div>

      {message && (
        <AdminAlert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AdminAlertDescription>{message.text}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Types de challenge
          </AdminCardTitle>
        </AdminCardHeader>

        <AdminCardContent>
          {loading ? (
            <p className="text-white/40 text-sm">Chargement…</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                <button
                  onClick={toggleAll}
                  className={`w-10 h-5 rounded-full transition-colors ${allEnabled ? 'bg-blue-500' : 'bg-white/10'}`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white mx-auto transition-transform ${allEnabled ? 'translate-x-2.5' : '-translate-x-2.5'}`} />
                </button>
                <span className="text-white/60 text-sm">{allEnabled ? 'Tout désactiver' : 'Tout activer'}</span>
              </div>

              {types.map(t => (
                <div key={t.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-white text-sm font-medium">{t.label}</p>
                    {t.description && <p className="text-white/40 text-xs mt-0.5">{t.description}</p>}
                  </div>
                  <button
                    onClick={() => toggle(t.id)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${t.enabled ? 'bg-blue-500' : 'bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${t.enabled ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </AdminCardContent>

        {!loading && (
          <AdminCardFooter>
            <AdminButton onClick={save} disabled={saving} className="flex items-center gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </AdminButton>
          </AdminCardFooter>
        )}
      </AdminCard>
    </div>
  );
}
