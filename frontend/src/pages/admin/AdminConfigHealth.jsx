import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Activity } from 'lucide-react';
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

function NumRow({ label, hint, k, unit, min, step, form, set }) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input type="number" min={min} step={step} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
        {unit && <span className="text-xs text-admin-text-muted shrink-0">{unit}</span>}
      </div>
    </Row>
  );
}

const KEYS = ['HEALTHCHECK_INTERVAL_SECONDS','HEALTHCHECK_FAILURE_THRESHOLD','HEALTHCHECK_SUCCESS_THRESHOLD','HEALTHCHECK_TIMEOUT_MS','HEALTHCHECK_CONCURRENCY'];

export default function AdminConfigHealth() {
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
      toast({ title: 'Sauvegardé', description: 'Health checks mis à jour.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec de la sauvegarde' });
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div data-admin-theme className="space-y-6">
      <Skeleton className="h-10 w-48 bg-admin-border" />
      <Skeleton className="h-72 bg-admin-border rounded-xl" />
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
            <h1 className="text-3xl font-semibold text-admin-text">Health Checks</h1>
            <p className="text-admin-text-muted text-sm mt-1">Fréquence et seuils de détection des pannes</p>
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
          <NumRow label="Intervalle" hint="Durée entre deux vérifications" k="HEALTHCHECK_INTERVAL_SECONDS" unit="sec" min="5" form={form} set={set} />
          <NumRow label="Seuil DOWN" hint="Checks consécutifs en échec avant de marquer le domaine DOWN" k="HEALTHCHECK_FAILURE_THRESHOLD" unit="checks" min="1" form={form} set={set} />
          <NumRow label="Seuil UP" hint="Checks consécutifs réussis avant de marquer le domaine UP" k="HEALTHCHECK_SUCCESS_THRESHOLD" unit="checks" min="1" form={form} set={set} />
          <NumRow label="Timeout" hint="Délai maximum par vérification" k="HEALTHCHECK_TIMEOUT_MS" unit="ms" min="1000" step="500" form={form} set={set} />
          <NumRow label="Concurrence" hint="Vérifications effectuées simultanément" k="HEALTHCHECK_CONCURRENCY" min="1" max="100" form={form} set={set} />
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
