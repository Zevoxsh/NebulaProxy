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

const KEYS = ['TUNNEL_PUBLIC_DOMAIN','TUNNEL_PORT_RANGE_MIN','TUNNEL_PORT_RANGE_MAX','TUNNEL_ENROLLMENT_CODE_TTL_MINUTES'];

export default function AdminConfigTunnels() {
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
      toast({ title: 'Sauvegardé', description: 'Configuration tunnels mise à jour.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec' });
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div data-admin-theme className="space-y-6">
      <Skeleton className="h-10 w-48 bg-admin-border" />
      <Skeleton className="h-56 bg-admin-border rounded-xl" />
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
            <h1 className="text-3xl font-semibold text-admin-text">Tunnels</h1>
            <p className="text-admin-text-muted text-sm mt-1">Configuration des tunnels TCP/UDP sortants</p>
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
          <Row label="Domaine public" hint="Domaine utilisé pour l'URL publique des tunnels">
            <Input value={form['TUNNEL_PUBLIC_DOMAIN'] ?? ''} onChange={e => set('TUNNEL_PUBLIC_DOMAIN', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="paxcia.net" />
          </Row>
          <Row label="Plage de ports" hint="Ports assignés aux tunnels (minimum – maximum)">
            <div className="flex items-center gap-2">
              <Input type="number" value={form['TUNNEL_PORT_RANGE_MIN'] ?? ''} onChange={e => set('TUNNEL_PORT_RANGE_MIN', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="20000" />
              <span className="text-admin-text-muted text-xs shrink-0">–</span>
              <Input type="number" value={form['TUNNEL_PORT_RANGE_MAX'] ?? ''} onChange={e => set('TUNNEL_PORT_RANGE_MAX', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="29999" />
            </div>
          </Row>
          <Row label="Durée du code d'enrôlement" hint="Durée de validité du code pour connecter un nouveau tunnel">
            <div className="flex items-center gap-2">
              <Input type="number" min="1" value={form['TUNNEL_ENROLLMENT_CODE_TTL_MINUTES'] ?? ''} onChange={e => set('TUNNEL_ENROLLMENT_CODE_TTL_MINUTES', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              <span className="text-xs text-admin-text-muted shrink-0">min</span>
            </div>
          </Row>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
