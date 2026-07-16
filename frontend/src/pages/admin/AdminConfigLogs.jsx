import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { adminAPI } from '../../api/client';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { AdminButton, AdminAlert, AdminAlertDescription, AdminCard, AdminCardContent } from '@/components/admin';

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4 border-b border-admin-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-admin-text">{label}</p>
        {hint && <p className="text-xs text-admin-text-muted mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0 w-52">{children}</div>
    </div>
  );
}

const KEYS = ['LOG_LEVEL','LOG_RETENTION_DAYS','LOG_CLEANUP_INTERVAL_HOURS','LIVE_TRAFFIC_RETENTION_DAYS'];

export default function AdminConfigLogs() {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true); setError('');
      const res = await adminAPI.getConfig();
      const flat = {};
      (res.data.sections || []).forEach(s => s.variables.forEach(v => { flat[v.key] = v.value ?? ''; }));
      const next = {};
      KEYS.forEach(k => { next[k] = flat[k] ?? ''; });
      setForm(next);
    } catch { setError('Impossible de charger la configuration.'); }
    finally { setLoading(false); }
  };

  const save = async () => {
    try {
      setSaving(true);
      await adminAPI.updateConfig(form);
      toast({ title: 'Sauvegardé', description: 'Logs & rétention mis à jour.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec' });
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div data-admin-theme className="space-y-6">
      <Skeleton className="h-10 w-48 bg-admin-border" />
      <Skeleton className="h-64 bg-admin-border rounded-xl" />
    </div>
  );

  return (
    <div data-admin-theme className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/admin/config')} className="p-1.5 rounded-lg text-admin-text-muted hover:text-admin-text hover:bg-admin-border/40 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-semibold text-admin-text">Logs & Rétention</h1>
            <p className="text-admin-text-muted text-sm mt-1">Niveau de verbosité et durée de conservation des données</p>
          </div>
        </div>
        <AdminButton onClick={save} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </AdminButton>
      </div>

      {error && <AdminAlert variant="danger"><AdminAlertDescription>{error}</AdminAlertDescription></AdminAlert>}

      <AdminCard>
        <AdminCardContent className="p-0">
          <Row label="Niveau de log" hint="Verbosité des journaux du serveur">
            <select value={form['LOG_LEVEL'] ?? 'warn'} onChange={e => set('LOG_LEVEL', e.target.value)} className="w-full h-9 text-sm bg-admin-bg border border-admin-border text-admin-text rounded-md px-3 outline-none focus:border-admin-primary">
              {['warn','info','debug','error'].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Row>
          <Row label="Rétention des logs de requêtes" hint="Les logs plus anciens sont supprimés automatiquement">
            <div className="flex items-center gap-2">
              <Input type="number" min="1" value={form['LOG_RETENTION_DAYS'] ?? ''} onChange={e => set('LOG_RETENTION_DAYS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              <span className="text-xs text-admin-text-muted shrink-0">jours</span>
            </div>
          </Row>
          <Row label="Intervalle de nettoyage" hint="Fréquence de la purge automatique des logs">
            <div className="flex items-center gap-2">
              <Input type="number" min="1" value={form['LOG_CLEANUP_INTERVAL_HOURS'] ?? ''} onChange={e => set('LOG_CLEANUP_INTERVAL_HOURS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              <span className="text-xs text-admin-text-muted shrink-0">heures</span>
            </div>
          </Row>
          <Row label="Rétention du trafic live" hint="Données Redis du trafic temps réel">
            <div className="flex items-center gap-2">
              <Input type="number" min="1" value={form['LIVE_TRAFFIC_RETENTION_DAYS'] ?? ''} onChange={e => set('LIVE_TRAFFIC_RETENTION_DAYS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              <span className="text-xs text-admin-text-muted shrink-0">jours</span>
            </div>
          </Row>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
