import { useState, useEffect } from 'react';
import { ShieldCheck, Save, TestTube, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent,
  AdminButton, AdminAlert, AdminAlertDescription
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

const DEFAULT = {
  enabled: false,
  issuer_url: '',
  client_id: '',
  client_secret: '',
  redirect_uri: '',
  scope: 'openid email profile',
  role_claim: '',
  admin_group: '',
  auto_create_users: true,
  sync_roles: false
};

export default function AdminOidc() {
  const [config, setConfig]   = useState({ ...DEFAULT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError]     = useState('');
  const { toast } = useToast();

  useEffect(() => { fetchConfig(); }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await adminAPI.getOidcConfig();
      setConfig({ ...DEFAULT, ...res.data.config });
    } catch { setError('Failed to load OIDC configuration'); }
    finally  { setLoading(false); }
  };

  const update = (key, value) => {
    setTestResult(null);
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await adminAPI.updateOidcConfig(config);
      toast({ title: 'Saved', description: 'OIDC configuration saved' });
    } catch (err) {
      const msg = err.response?.data?.message || 'Save failed';
      setError(msg);
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await adminAPI.testOidcDiscovery(config.issuer_url);
      setTestResult({ success: true, data: res.data });
      toast({ title: 'Discovery OK', description: `Issuer: ${res.data.issuer}` });
    } catch (err) {
      const msg = err.response?.data?.message || 'Discovery failed';
      setTestResult({ success: false, message: msg });
      toast({ variant: 'destructive', title: 'Test Failed', description: msg });
    } finally { setTesting(false); }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
        <Skeleton className="h-96 bg-admin-border" />
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">SSO / OIDC</h1>
          <p className="text-admin-text-muted">
            Single Sign-On via OpenID Connect — compatible avec Keycloak, Okta, Azure AD, Auth0
          </p>
        </div>
        <AdminButton onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save'}
        </AdminButton>
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {testResult && (
        <AdminAlert variant={testResult.success ? 'success' : 'danger'}>
          {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AdminAlertDescription>
            {testResult.success
              ? `Provider: ${testResult.data?.issuer} — Discovery OK`
              : testResult.message}
          </AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-admin-primary" />
              <div>
                <AdminCardTitle>Provider OIDC</AdminCardTitle>
                <p className="text-xs text-admin-text-muted mt-0.5">Identifiants de l'application enregistrée chez le fournisseur d'identité</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="oidc-enabled"
                checked={Boolean(config.enabled)}
                onCheckedChange={v => update('enabled', v)}
                className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
              />
              <Label htmlFor="oidc-enabled" className="text-admin-text cursor-pointer">Activé</Label>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label className="text-admin-text">Issuer URL</Label>
            <Input value={config.issuer_url} onChange={e => update('issuer_url', e.target.value)}
              placeholder="https://keycloak.example.com/realms/myrealm"
              className="bg-admin-bg border-admin-border text-admin-text font-mono text-sm"
              disabled={!config.enabled} />
            <p className="text-xs text-admin-text-muted">
              Base URL du realm/tenant. NebulaProxy appelle automatiquement <code className="bg-admin-border px-1 rounded">{'<issuer>'}/.well-known/openid-configuration</code>
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-admin-text">Client ID</Label>
              <Input value={config.client_id} onChange={e => update('client_id', e.target.value)}
                placeholder="nebulaproxy" className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.enabled} />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Client Secret</Label>
              <Input type="password" value={config.client_secret} onChange={e => update('client_secret', e.target.value)}
                placeholder="••••••••" className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.enabled} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-admin-text">Redirect URI</Label>
            <Input value={config.redirect_uri} onChange={e => update('redirect_uri', e.target.value)}
              placeholder={`${window.location.origin}/api/auth/oidc/callback`}
              className="bg-admin-bg border-admin-border text-admin-text font-mono text-sm"
              disabled={!config.enabled} />
            <p className="text-xs text-admin-text-muted">À ajouter dans les redirect URIs autorisées de votre IdP</p>
          </div>
          <div className="space-y-2">
            <Label className="text-admin-text">Scopes</Label>
            <Input value={config.scope} onChange={e => update('scope', e.target.value)}
              placeholder="openid email profile" className="bg-admin-bg border-admin-border text-admin-text"
              disabled={!config.enabled} />
          </div>
          <Separator className="bg-admin-border" />
          <AdminButton variant="secondary" onClick={handleTest} disabled={!config.issuer_url || testing}>
            <TestTube className="w-4 h-4 mr-2" />
            {testing ? 'Testing...' : 'Test Discovery'}
          </AdminButton>
        </AdminCardContent>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader><AdminCardTitle>Mappage des rôles</AdminCardTitle></AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-admin-text">Claim de rôle/groupe</Label>
              <Input value={config.role_claim} onChange={e => update('role_claim', e.target.value)}
                placeholder="groups" className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.enabled} />
              <p className="text-xs text-admin-text-muted">Nom du claim dans l'userinfo contenant les groupes (ex: <code className="bg-admin-border px-1 rounded">groups</code>, <code className="bg-admin-border px-1 rounded">roles</code>)</p>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Groupe admin</Label>
              <Input value={config.admin_group} onChange={e => update('admin_group', e.target.value)}
                placeholder="nebula-admins" className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.enabled} />
              <p className="text-xs text-admin-text-muted">Les membres de ce groupe reçoivent le rôle <code className="bg-admin-border px-1 rounded">admin</code></p>
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex items-center gap-3">
              <Checkbox id="auto-create" checked={Boolean(config.auto_create_users)}
                onCheckedChange={v => update('auto_create_users', v)} disabled={!config.enabled}
                className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black" />
              <div>
                <Label htmlFor="auto-create" className="text-admin-text cursor-pointer">Créer les utilisateurs automatiquement</Label>
                <p className="text-xs text-admin-text-muted">Si désactivé, seuls les comptes pré-créés peuvent se connecter via SSO</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox id="sync-roles" checked={Boolean(config.sync_roles)}
                onCheckedChange={v => update('sync_roles', v)} disabled={!config.enabled}
                className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black" />
              <div>
                <Label htmlFor="sync-roles" className="text-admin-text cursor-pointer">Synchroniser les rôles à chaque connexion</Label>
                <p className="text-xs text-admin-text-muted">Met à jour le rôle Nebula selon les groupes IdP à chaque login SSO</p>
              </div>
            </div>
          </div>
        </AdminCardContent>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader><AdminCardTitle>Providers testés</AdminCardTitle></AdminCardHeader>
        <AdminCardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-admin-text-muted">
            {[['Keycloak','https://www.keycloak.org'],['Okta','https://developer.okta.com'],['Azure AD','https://azure.microsoft.com'],['Auth0','https://auth0.com']].map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-admin-text transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />{name}
              </a>
            ))}
          </div>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
