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
      <div className="shrink-0 w-64">{children}</div>
    </div>
  );
}

const FIELDS = [
  ['BAD_GATEWAY_HTML_TITLE',  'Titre de l\'onglet navigateur'],
  ['BAD_GATEWAY_BADGE',       'Texte du badge'],
  ['BAD_GATEWAY_TITLE',       'Titre principal'],
  ['BAD_GATEWAY_SUBTITLE',    'Sous-titre'],
  ['BAD_GATEWAY_MESSAGE',     'Message principal'],
  ['BAD_GATEWAY_CAUSE_VALUE', 'Cause affichée'],
  ['BAD_GATEWAY_STATUS_VALUE','Statut HTTP affiché'],
  ['BAD_GATEWAY_RETRY_BUTTON','Bouton « Réessayer »'],
  ['BAD_GATEWAY_BACK_BUTTON', 'Bouton « Retour »'],
  ['BAD_GATEWAY_FOOTER_TEXT', 'Pied de page'],
];

const KEYS = FIELDS.map(([k]) => k);

export default function AdminConfigErrorPage() {
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
      toast({ title: 'Sauvegardé', description: 'Page d\'erreur 502 mise à jour.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec' });
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div data-admin-theme className="space-y-6">
      <Skeleton className="h-10 w-48 bg-admin-border" />
      <Skeleton className="h-96 bg-admin-border rounded-xl" />
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
            <h1 className="text-3xl font-semibold text-admin-text">Page d'erreur 502</h1>
            <p className="text-admin-text-muted text-sm mt-1">Textes affichés quand un backend est inaccessible</p>
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
          {FIELDS.map(([key, label]) => (
            <Row key={key} label={label}>
              <Input value={form[key] ?? ''} onChange={e => set(key, e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
          ))}
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
