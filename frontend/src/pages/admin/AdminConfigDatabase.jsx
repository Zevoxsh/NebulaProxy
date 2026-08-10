import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Eye, EyeOff } from 'lucide-react';
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

function PasswordInput({ value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} className="bg-admin-bg border-admin-border text-admin-text pr-9 h-9 text-sm" />
      <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-admin-text-muted hover:text-admin-text" tabIndex={-1}>
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

const KEYS = ['DB_TYPE','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'];

export default function AdminConfigDatabase() {
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
      toast({ title: 'Sauvegardé', description: 'Un redémarrage du backend est nécessaire pour appliquer les changements DB.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec' });
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
            <h1 className="text-3xl font-semibold text-admin-text">Base de données</h1>
            <p className="text-admin-text-muted text-sm mt-1">Connexion PostgreSQL — redémarrage requis après modification</p>
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
          <Row label="Type">
            <Input value={form['DB_TYPE'] ?? ''} onChange={e => set('DB_TYPE', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
          </Row>
          <Row label="Hôte">
            <Input value={form['DB_HOST'] ?? ''} onChange={e => set('DB_HOST', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
          </Row>
          <Row label="Port">
            <Input type="number" value={form['DB_PORT'] ?? ''} onChange={e => set('DB_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
          </Row>
          <Row label="Nom de la base">
            <Input value={form['DB_NAME'] ?? ''} onChange={e => set('DB_NAME', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
          </Row>
          <Row label="Utilisateur">
            <Input value={form['DB_USER'] ?? ''} onChange={e => set('DB_USER', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
          </Row>
          <Row label="Mot de passe">
            <PasswordInput value={form['DB_PASSWORD'] ?? ''} onChange={v => set('DB_PASSWORD', v)} />
          </Row>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
