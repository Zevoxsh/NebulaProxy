import { useEffect, useState } from 'react';
import { KeyRound, Save, Plug, RefreshCw, ArrowRight, AlertCircle, Eye, EyeOff, Info, Users, CheckCircle } from 'lucide-react';
import { adminAPI } from '../../api/client';
import { useModal } from '../../context/ModalContext';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminAlert,
  AdminAlertDescription,
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export default function AdminLdap() {
  const { confirm: confirmModal } = useModal();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    authMode: 'local',
    url: '',
    baseDN: '',
    bindDN: '',
    bindPassword: '',
    adminGroup: '',
    userGroup: '',
    requireGroup: false,
  });

  const [users, setUsers] = useState([]);
  const [fromUser, setFromUser] = useState('');
  const [toUser, setToUser] = useState('');

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const loadUsers = async () => {
    const res = await adminAPI.getUsersForTransfer();
    setUsers(res.data.users || []);
  };

  useEffect(() => {
    (async () => {
      try {
        const [cfgRes, usersRes] = await Promise.all([
          adminAPI.getLdapConfig(),
          adminAPI.getUsersForTransfer(),
        ]);
        const c = cfgRes.data.config || {};
        setForm({
          authMode: c.authMode || 'local',
          url: c.url || '',
          baseDN: c.baseDN || '',
          bindDN: c.bindDN || '',
          bindPassword: '',
          adminGroup: c.adminGroup || '',
          userGroup: c.userGroup || '',
          requireGroup: Boolean(c.requireGroup),
        });
        setUsers(usersRes.data.users || []);
      } catch {
        setError('Impossible de charger la configuration LDAP.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const payload = { ...form };
      if (!payload.bindPassword) delete payload.bindPassword;
      await adminAPI.saveLdapConfig(payload);
      toast({
        title: 'Configuration sauvegardée',
        description: 'Redémarrez le backend pour appliquer le changement de mode.',
      });
    } catch (e) {
      const msg = e.response?.data?.error || 'Échec de la sauvegarde.';
      setError(msg);
      toast({ variant: 'destructive', title: 'Erreur', description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const res = await adminAPI.syncLdapUsers();
      setSyncResult(res.data);
      toast({
        title: 'Synchronisation terminée',
        description: `${res.data.created} créé(s), ${res.data.updated} mis à jour sur ${res.data.total} utilisateurs LDAP.`,
      });
      await loadUsers();
    } catch (e) {
      const msg = e.response?.data?.error || 'Synchronisation échouée';
      toast({ variant: 'destructive', title: 'Erreur de sync', description: msg });
    } finally {
      setSyncing(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await adminAPI.testLdapConnection({
        url: form.url,
        bindDN: form.bindDN,
        bindPassword: form.bindPassword || undefined,
      });
      setTestResult({ ok: true, message: res.data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.error || 'Connexion échouée' });
    } finally {
      setTesting(false);
    }
  };

  const handleTransfer = async () => {
    if (!fromUser || !toUser) return;
    const fromU = users.find(u => String(u.id) === fromUser);
    const toU = users.find(u => String(u.id) === toUser);
    if (!fromU || !toU) return;

    const count = parseInt(fromU.domain_count, 10);
    if (count === 0) {
      toast({ title: 'Aucun domaine', description: `${fromU.username} n'a aucun domaine personnel à transférer.` });
      return;
    }

    const ok = await confirmModal(
      `Transférer ${count} domaine(s) de "${fromU.username}" vers "${toU.username}" ? Cette action est irréversible.`,
      { title: 'Transférer les domaines', danger: true, confirmLabel: 'Transférer' }
    );
    if (!ok) return;

    try {
      setTransferring(true);
      const res = await adminAPI.transferDomains(fromU.id, toU.id);
      toast({ title: 'Transfert effectué', description: `${res.data.transferred} domaine(s) transféré(s) avec succès.` });
      await loadUsers();
      setFromUser('');
      setToUser('');
    } catch (e) {
      const msg = e.response?.data?.error || 'Transfert échoué';
      toast({ variant: 'destructive', title: 'Erreur', description: msg });
    } finally {
      setTransferring(false);
    }
  };

  const fromUserObj = users.find(u => String(u.id) === fromUser);
  const toUserObj = users.find(u => String(u.id) === toUser);

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <Skeleton className="h-64 bg-admin-border" />
        <Skeleton className="h-96 bg-admin-border" />
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">LDAP / Authentification</h1>
          <p className="text-admin-text-muted">Configurez l'annuaire LDAP/Active Directory et gérez le transfert de domaines entre comptes.</p>
        </div>
        <AdminButton onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </AdminButton>
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Auth mode */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Mode d'authentification
          </AdminCardTitle>
          <p className="text-xs text-admin-text-muted mt-1">Choisissez comment les utilisateurs se connectent à la plateforme.</p>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'local', label: 'Local', desc: 'Comptes en base de données. Inscription possible si activée.' },
              { value: 'ldap', label: 'LDAP / Active Directory', desc: 'Connexion via votre annuaire d\'entreprise.' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('authMode', opt.value)}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  form.authMode === opt.value
                    ? 'border-admin-primary/50 bg-admin-primary/10'
                    : 'border-admin-border bg-admin-surface hover:border-admin-border-strong'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-1.5">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    form.authMode === opt.value ? 'border-admin-primary' : 'border-admin-border'
                  }`}>
                    {form.authMode === opt.value && <div className="w-2 h-2 rounded-full bg-admin-primary" />}
                  </div>
                  <span className="text-sm font-medium text-admin-text">{opt.label}</span>
                </div>
                <p className="text-xs text-admin-text-muted ml-6.5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {form.authMode === 'ldap' && (
            <div className="mt-4 space-y-4">
              <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-lg px-4 py-3">
                <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" strokeWidth={1.5} />
                <p className="text-sm text-amber-300/80">
                  Le compte admin local reste actif même en mode LDAP — vous pouvez toujours vous y connecter.
                  Les nouveaux utilisateurs LDAP sont créés automatiquement à leur première connexion.
                </p>
              </div>

              <div className="bg-admin-surface border border-admin-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-admin-text">Synchroniser tous les utilisateurs LDAP</p>
                    <p className="text-xs text-admin-text-muted mt-0.5">
                      Importe tous les comptes de l'annuaire sans attendre leur connexion.
                    </p>
                  </div>
                  <AdminButton variant="secondary" onClick={handleSync} disabled={syncing}>
                    <Users className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    {syncing ? 'Synchronisation...' : 'Synchroniser'}
                  </AdminButton>
                </div>

                {syncResult && (
                  <div className="mt-3 flex items-center gap-2.5 text-sm px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                    <CheckCircle className="w-4 h-4 shrink-0" strokeWidth={2} />
                    <span>
                      {syncResult.total} utilisateur(s) trouvé(s) —{' '}
                      <strong>{syncResult.created}</strong> créé(s),{' '}
                      <strong>{syncResult.updated}</strong> mis à jour
                      {syncResult.errors?.length > 0 && (
                        <span className="text-amber-400 ml-1">({syncResult.errors.length} erreur(s))</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </AdminCardContent>
      </AdminCard>

      {/* LDAP server config */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle className="flex items-center gap-2">
            <Plug className="w-5 h-5" />
            Serveur LDAP
          </AdminCardTitle>
          <p className="text-xs text-admin-text-muted mt-1">Paramètres de connexion à votre annuaire LDAP.</p>
        </AdminCardHeader>
        <AdminCardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-admin-text">URL du serveur</Label>
              <Input
                value={form.url}
                onChange={e => set('url', e.target.value)}
                placeholder="ldap://192.168.1.1:389"
                className="bg-admin-bg border-admin-border text-admin-text font-mono"
              />
              <p className="text-xs text-admin-text-muted">Utilisez ldaps:// pour une connexion TLS</p>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Base DN</Label>
              <Input
                value={form.baseDN}
                onChange={e => set('baseDN', e.target.value)}
                placeholder="dc=exemple,dc=com"
                className="bg-admin-bg border-admin-border text-admin-text font-mono"
              />
              <p className="text-xs text-admin-text-muted">Racine de l'annuaire LDAP</p>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Bind DN</Label>
              <Input
                value={form.bindDN}
                onChange={e => set('bindDN', e.target.value)}
                placeholder="cn=svc-proxy,ou=ServiceAccounts,dc=exemple,dc=com"
                className="bg-admin-bg border-admin-border text-admin-text font-mono"
              />
              <p className="text-xs text-admin-text-muted">Compte de service pour les recherches LDAP</p>
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Bind Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.bindPassword}
                  onChange={e => set('bindPassword', e.target.value)}
                  placeholder="Laisser vide pour conserver l'actuel"
                  className="bg-admin-bg border-admin-border text-admin-text pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-admin-text-muted hover:text-admin-text"
                >
                  {showPassword
                    ? <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                    : <Eye className="w-4 h-4" strokeWidth={1.5} />}
                </button>
              </div>
            </div>
          </div>

          <Separator className="bg-admin-border" />

          <div>
            <p className="text-sm font-medium text-admin-text mb-4">Groupes <span className="text-admin-text-muted font-normal">(optionnel)</span></p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-admin-text">Groupe Admins</Label>
                <Input
                  value={form.adminGroup}
                  onChange={e => set('adminGroup', e.target.value)}
                  placeholder="CN=Proxy_Admins,OU=Groups,DC=exemple,DC=com"
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                />
                <p className="text-xs text-admin-text-muted">Les membres de ce groupe obtiennent le rôle admin</p>
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Groupe Users</Label>
                <Input
                  value={form.userGroup}
                  onChange={e => set('userGroup', e.target.value)}
                  placeholder="CN=Proxy_Users,OU=Groups,DC=exemple,DC=com"
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                />
                <p className="text-xs text-admin-text-muted">Les membres de ce groupe obtiennent le rôle utilisateur</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 mt-4">
              <Checkbox
                id="require-group"
                checked={form.requireGroup}
                onCheckedChange={val => set('requireGroup', val)}
                className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
              />
              <Label htmlFor="require-group" className="text-admin-text cursor-pointer">
                Refuser la connexion si l'utilisateur n'appartient à aucun groupe configuré
              </Label>
            </div>
          </div>

          {testResult && (
            <div className={`flex items-center gap-2.5 text-sm px-4 py-3 rounded-lg border ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-red-500/10 border-red-500/25 text-red-400'
            }`}>
              <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={2} />
              {testResult.message}
            </div>
          )}

          <Separator className="bg-admin-border" />

          <AdminButton
            variant="secondary"
            onClick={handleTest}
            disabled={testing || !form.url || !form.bindDN}
          >
            <Plug className="w-4 h-4 mr-2" strokeWidth={1.5} />
            {testing ? 'Test en cours...' : 'Tester la connexion'}
          </AdminButton>
        </AdminCardContent>
      </AdminCard>

      {/* Domain transfer */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Transfert de domaines
          </AdminCardTitle>
          <p className="text-xs text-admin-text-muted mt-1">
            Transférez les domaines personnels d'un compte local vers un compte LDAP (ou entre n'importe quels comptes).
          </p>
        </AdminCardHeader>
        <AdminCardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
            <div className="space-y-2">
              <Label className="text-admin-text">Compte source</Label>
              <select
                value={fromUser}
                onChange={e => setFromUser(e.target.value)}
                className="w-full h-10 bg-admin-bg border border-admin-border text-admin-text text-sm rounded-md px-3 focus:outline-none focus:border-admin-primary"
              >
                <option value="">— Sélectionner un compte —</option>
                {users.map(u => (
                  <option key={u.id} value={String(u.id)}>
                    {u.username}{u.display_name && u.display_name !== u.username ? ` (${u.display_name})` : ''} — {u.domain_count} domaine(s)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-center pb-1">
              <ArrowRight className="w-5 h-5 text-admin-text-muted" strokeWidth={1.5} />
            </div>

            <div className="space-y-2">
              <Label className="text-admin-text">Compte destination</Label>
              <select
                value={toUser}
                onChange={e => setToUser(e.target.value)}
                className="w-full h-10 bg-admin-bg border border-admin-border text-admin-text text-sm rounded-md px-3 focus:outline-none focus:border-admin-primary"
              >
                <option value="">— Sélectionner un compte —</option>
                {users.filter(u => String(u.id) !== fromUser).map(u => (
                  <option key={u.id} value={String(u.id)}>
                    {u.username}{u.display_name && u.display_name !== u.username ? ` (${u.display_name})` : ''} — {u.domain_count} domaine(s)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {fromUserObj && toUserObj && (
            <div className="bg-admin-surface border border-admin-border rounded-lg px-4 py-3 text-sm text-admin-text-muted">
              <span className="font-medium text-admin-text">{fromUserObj.domain_count}</span> domaine(s) personnel(s) de{' '}
              <span className="font-medium text-admin-text">{fromUserObj.username}</span>{' '}
              seront transférés vers{' '}
              <span className="font-medium text-admin-text">{toUserObj.username}</span>
            </div>
          )}

          <Separator className="bg-admin-border" />

          <div className="flex justify-end">
            <AdminButton
              onClick={handleTransfer}
              disabled={!fromUser || !toUser || transferring}
            >
              <RefreshCw className="w-4 h-4 mr-2" strokeWidth={1.5} />
              {transferring ? 'Transfert...' : 'Transférer les domaines'}
            </AdminButton>
          </div>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
