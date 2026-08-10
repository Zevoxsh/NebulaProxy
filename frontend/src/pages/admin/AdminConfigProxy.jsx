import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { adminAPI } from '../../api/client';
import { Switch } from '@/components/ui/switch';
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

function RowFull({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4 border-b border-admin-border last:border-0">
      <div>
        <p className="text-sm font-medium text-admin-text">{label}</p>
        {hint && <p className="text-xs text-admin-text-muted mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const KEYS = ['ALLOW_INSECURE_BACKENDS','ALLOW_PRIVATE_BACKENDS','HTTP_PROXY_REQUEST_TIMEOUT_MS','ALLOWED_ORIGINS'];

export default function AdminConfigProxy() {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const bool = k => form[k] === 'true' || form[k] === true;
  const setb = (k, v) => set(k, v ? 'true' : 'false');

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
      toast({ title: 'Sauvegardé', description: 'Configuration proxy mise à jour.' });
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
            <h1 className="text-3xl font-semibold text-admin-text">Proxy</h1>
            <p className="text-admin-text-muted text-sm mt-1">Comportement du proxy HTTP/HTTPS</p>
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
          <Row label="Autoriser les backends HTTP" hint="Permet de proxifier vers des serveurs sans HTTPS">
            <Switch checked={bool('ALLOW_INSECURE_BACKENDS')} onCheckedChange={v => setb('ALLOW_INSECURE_BACKENDS', v)} />
          </Row>
          <Row label="Autoriser les backends privés" hint="Adresses IP locales (192.168.x, 10.x, 172.16.x)">
            <Switch checked={bool('ALLOW_PRIVATE_BACKENDS')} onCheckedChange={v => setb('ALLOW_PRIVATE_BACKENDS', v)} />
          </Row>
          <Row label="Timeout des requêtes" hint="Délai maximum avant d'abandonner une requête proxifiée">
            <div className="flex items-center gap-2">
              <Input type="number" min="1000" step="1000" value={form['HTTP_PROXY_REQUEST_TIMEOUT_MS'] ?? ''} onChange={e => set('HTTP_PROXY_REQUEST_TIMEOUT_MS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              <span className="text-xs text-admin-text-muted shrink-0">ms</span>
            </div>
          </Row>
          <RowFull label="Origines CORS autorisées" hint="URLs autorisées à contacter l'API, séparées par des virgules">
            <Input value={form['ALLOWED_ORIGINS'] ?? ''} onChange={e => set('ALLOWED_ORIGINS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="https://proxy.example.com,https://app.example.com" />
          </RowFull>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
