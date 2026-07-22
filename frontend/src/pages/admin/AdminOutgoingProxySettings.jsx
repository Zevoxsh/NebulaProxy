import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Trash2, RotateCw } from 'lucide-react';
import { adminAPI, socks5ProxyAPI } from '../../api/client';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useModal } from '../../context/ModalContext';
import { useConnectivityStore } from '../../store/connectivityStore';
import { AdminButton, AdminAlert, AdminAlertDescription, AdminCard, AdminCardContent } from '@/components/admin';

const BACKEND_CONTAINER_NAME = 'nebulaproxy-backend';

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

const KEYS = [
  'SOCKS5_PROXY_ENABLED',
  'SOCKS5_PROXY_PORT',
  'SOCKS5_PROXY_BIND_ADDRESS',
  'SOCKS5_PROXY_PUBLIC_HOST',
  'SOCKS5_PROXY_MAX_THROTTLE_BPS',
  'SOCKS5_PROXY_DEFAULT_THROTTLE_BPS',
  'SOCKS5_PROXY_MAX_CONNECTIONS_PER_CREDENTIAL',
  'SOCKS5_PROXY_MAX_CREDENTIALS_PER_USER'
];

export default function AdminOutgoingProxySettings() {
  const [form, setForm] = useState({});
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { confirm: confirmModal } = useModal();

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true); setError('');
      const [configRes, credentialsRes] = await Promise.all([
        adminAPI.getConfig(),
        socks5ProxyAPI.getAll()
      ]);
      const flat = {};
      (configRes.data.sections || []).forEach((s) => s.variables.forEach((v) => { flat[v.key] = v.value ?? ''; }));
      const next = {};
      KEYS.forEach((k) => { next[k] = flat[k] ?? ''; });
      setForm(next);
      setCredentials(credentialsRes.data.credentials || []);
    } catch {
      setError('Impossible de charger la configuration.');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      await adminAPI.updateConfig(form);
      toast({ title: 'Sauvegardé', description: 'Configuration mise à jour. Utilise "Redémarrer le backend" pour appliquer l\'activation/le port.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec' });
    } finally { setSaving(false); }
  };

  const restartBackend = async () => {
    if (!await confirmModal(
      'Redémarrer le backend maintenant ? Ceci coupera brièvement le proxy (quelques secondes) le temps que le container redémarre.',
      { title: 'Redémarrer le backend', danger: true, confirmLabel: 'Redémarrer' }
    )) return;

    try {
      setRestarting(true);
      await adminAPI.restartContainer(BACKEND_CONTAINER_NAME);
      // This page makes no other background requests, so nothing would
      // otherwise notice the backend going down for the few seconds it
      // takes to actually cycle — flip the flag ourselves so the app-wide
      // BackendUnreachableOverlay (mounted in App.jsx) shows up right away
      // instead of waiting on an incidental failed request that may never
      // come. It polls /api/status itself and clears the flag once the
      // backend answers again, picking this same page back up.
      useConnectivityStore.getState().setBackendUnreachable(true);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec du redémarrage' });
    } finally {
      setRestarting(false);
    }
  };

  const deleteCredential = async (credential) => {
    try {
      await socks5ProxyAPI.delete(credential.id);
      setCredentials((prev) => prev.filter((c) => c.id !== credential.id));
      toast({ title: 'Supprimé', description: `Configuration "${credential.label}" supprimée.` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec de la suppression' });
    }
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
            <h1 className="text-3xl font-semibold text-admin-text">Proxy sortant</h1>
            <p className="text-admin-text-muted text-sm mt-1">Configuration du proxy SOCKS5 sortant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AdminButton variant="secondary" onClick={restartBackend} disabled={restarting}>
            <RotateCw className={`w-4 h-4 mr-2 ${restarting ? 'animate-spin' : ''}`} />
            {restarting ? 'Redémarrage…' : 'Redémarrer le backend'}
          </AdminButton>
          <AdminButton onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </AdminButton>
        </div>
      </div>

      {error && <AdminAlert variant="danger"><AdminAlertDescription>{error}</AdminAlertDescription></AdminAlert>}

      <AdminCard>
        <AdminCardContent className="p-0">
          <Row label="Activé" hint="Nécessite un redémarrage du backend pour prendre effet">
            <Switch checked={form['SOCKS5_PROXY_ENABLED'] === 'true' || form['SOCKS5_PROXY_ENABLED'] === true} onCheckedChange={(v) => set('SOCKS5_PROXY_ENABLED', v ? 'true' : 'false')} />
          </Row>
          <Row label="Port d'écoute" hint="Port SOCKS5 (nécessite un redémarrage)">
            <Input type="number" value={form['SOCKS5_PROXY_PORT'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="1080" />
          </Row>
          <Row label="Adresse d'écoute" hint="Interface réseau (nécessite un redémarrage)">
            <Input value={form['SOCKS5_PROXY_BIND_ADDRESS'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_BIND_ADDRESS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="0.0.0.0" />
          </Row>
          <Row label="Domaine public affiché" hint="Hostname montré aux utilisateurs pour se connecter — ex. un sous-domaine DNS-only (pas Cloudflare orange), sinon l'hôte du panel est utilisé. Pas de redémarrage requis.">
            <Input value={form['SOCKS5_PROXY_PUBLIC_HOST'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_PUBLIC_HOST', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="socks5.paxcia.net" />
          </Row>
          <Row label="Limite de bande passante max." hint="Plafond en octets/sec autorisé par configuration utilisateur">
            <Input type="number" value={form['SOCKS5_PROXY_MAX_THROTTLE_BPS'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_MAX_THROTTLE_BPS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="10485760" />
          </Row>
          <Row label="Limite par défaut" hint="Valeur par défaut à la création d'une configuration (octets/sec)">
            <Input type="number" value={form['SOCKS5_PROXY_DEFAULT_THROTTLE_BPS'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_DEFAULT_THROTTLE_BPS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="2097152" />
          </Row>
          <Row label="Connexions simultanées max." hint="Par configuration SOCKS5">
            <Input type="number" value={form['SOCKS5_PROXY_MAX_CONNECTIONS_PER_CREDENTIAL'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_MAX_CONNECTIONS_PER_CREDENTIAL', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="10" />
          </Row>
          <Row label="Configurations max. par utilisateur" hint="Nombre de credentials SOCKS5 qu'un utilisateur peut créer">
            <Input type="number" value={form['SOCKS5_PROXY_MAX_CREDENTIALS_PER_USER'] ?? ''} onChange={(e) => set('SOCKS5_PROXY_MAX_CREDENTIALS_PER_USER', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="5" />
          </Row>
        </AdminCardContent>
      </AdminCard>

      <div>
        <h2 className="text-lg font-medium text-admin-text mb-3">Toutes les configurations ({credentials.length})</h2>
        <AdminCard>
          <AdminCardContent className="p-0">
            {credentials.length === 0 ? (
              <p className="text-sm text-admin-text-muted px-5 py-6">Aucune configuration SOCKS5 créée pour le moment.</p>
            ) : credentials.map((credential) => (
              <div key={credential.id} className="flex items-center justify-between gap-4 px-5 py-3 border-b border-admin-border last:border-0">
                <div className="min-w-0">
                  <p className="text-sm text-admin-text truncate">{credential.label} <span className="text-admin-text-muted">— {credential.owner_username || credential.user_id}</span></p>
                  <p className="text-xs text-admin-text-muted font-mono truncate">{credential.username} · {credential.is_enabled ? 'active' : 'désactivée'}</p>
                </div>
                <button onClick={() => deleteCredential(credential)} className="p-1.5 rounded-lg text-admin-text-muted hover:text-red-400 hover:bg-admin-border/40 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </AdminCardContent>
        </AdminCard>
      </div>
    </div>
  );
}
