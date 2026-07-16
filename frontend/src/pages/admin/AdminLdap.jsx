import { useEffect, useState } from 'react';
import { Save, Loader, Check, AlertCircle, Eye, EyeOff, Plug, RefreshCw, ArrowRight, Info } from 'lucide-react';
import { adminAPI } from '../../api/client';
import { useModal } from '../../context/ModalContext';
import {
  AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent,
  AdminButton,
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const inputCls = 'bg-admin-bg border-admin-border text-admin-text placeholder:text-admin-text-subtle focus:border-admin-primary text-sm font-mono';
const selectCls = 'w-full bg-admin-bg border border-admin-border text-admin-text text-sm rounded-md px-3 py-2 focus:outline-none focus:border-admin-primary';

export default function AdminLdap() {
  const { confirm: confirmModal } = useModal();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [transferResult, setTransferResult] = useState('');
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
        setError('Impossible de charger la configuration.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const payload = { ...form };
      if (!payload.bindPassword) delete payload.bindPassword;
      await adminAPI.saveLdapConfig(payload);
      setSuccess('Configuration sauvegardée. Redémarrez le backend pour appliquer le changement de mode.');
      setTimeout(() => setSuccess(''), 8000);
    } catch (e) {
      setError(e.response?.data?.error || 'Échec de la sauvegarde.');
    } finally {
      setSaving(false);
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
      setTransferResult(`${fromU.username} n'a aucun domaine personnel à transférer.`);
      setTimeout(() => setTransferResult(''), 4000);
      return;
    }

    const ok = await confirmModal(
      `Transférer ${count} domaine(s) de "${fromU.username}" vers "${toU.username}" ? Cette action est irréversible.`,
      { title: 'Transférer les domaines', danger: true, confirmLabel: 'Transférer' }
    );
    if (!ok) return;

    try {
      setTransferring(true);
      setTransferResult('');
      const res = await adminAPI.transferDomains(fromU.id, toU.id);
      setTransferResult(`✓ ${res.data.transferred} domaine(s) transféré(s).`);
      await loadUsers();
      setFromUser('');
      setToUser('');
    } catch (e) {
      setTransferResult(`Erreur : ${e.response?.data?.error || 'Transfert échoué'}`);
    } finally {
      setTransferring(false);
    }
  };

  const fromUserObj = users.find(u => String(u.id) === fromUser);
  const toUserObj = users.find(u => String(u.id) === toUser);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader className="w-5 h-5 text-admin-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-admin-text">LDAP / Authentification</h1>
        <p className="text-sm text-admin-text-muted mt-1">
          Configurez l'authentification LDAP/Active Directory et gérez le transfert de domaines.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />
          {success}
        </div>
      )}

      {/* Auth mode */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Mode d'authentification</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'local', label: 'Local', desc: 'Comptes en base de données. Inscription possible.' },
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
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    form.authMode === opt.value ? 'border-admin-primary' : 'border-admin-border'
                  }`}>
                    {form.authMode === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-admin-primary" />}
                  </div>
                  <span className="text-sm font-medium text-admin-text">{opt.label}</span>
                </div>
                <p className="text-xs text-admin-text-muted ml-5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {form.authMode === 'ldap' && (
            <div className="mt-4 flex items-start gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" strokeWidth={1.5} />
              <p className="text-xs text-amber-300/80">
                Le compte admin local reste actif même en mode LDAP — vous pouvez toujours vous y connecter.
                Les nouveaux utilisateurs LDAP sont créés automatiquement à leur première connexion.
              </p>
            </div>
          )}
        </AdminCardContent>
      </AdminCard>

      {/* LDAP config */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Serveur LDAP</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-admin-text-muted uppercase tracking-wider">URL du serveur</Label>
              <Input
                value={form.url}
                onChange={e => set('url', e.target.value)}
                placeholder="ldap://192.168.1.1:389"
                className={inputCls}
              />
              <p className="text-xs text-admin-text-muted">ex: ldap:// ou ldaps:// pour TLS</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Base DN</Label>
              <Input
                value={form.baseDN}
                onChange={e => set('baseDN', e.target.value)}
                placeholder="dc=exemple,dc=com"
                className={inputCls}
              />
              <p className="text-xs text-admin-text-muted">Racine de l'annuaire LDAP</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Bind DN</Label>
              <Input
                value={form.bindDN}
                onChange={e => set('bindDN', e.target.value)}
                placeholder="cn=svc-proxy,ou=ServiceAccounts,dc=exemple,dc=com"
                className={inputCls}
              />
              <p className="text-xs text-admin-text-muted">Compte de service pour les recherches</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Bind Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.bindPassword}
                  onChange={e => set('bindPassword', e.target.value)}
                  placeholder={form.bindPassword === '' ? 'Laisser vide pour conserver l\'actuel' : ''}
                  className={`${inputCls} pr-10`}
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

          <div className="space-y-1">
            <p className="text-xs font-medium text-admin-text-muted uppercase tracking-wider mb-3">Groupes (optionnel)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Groupe Admins</Label>
                <Input
                  value={form.adminGroup}
                  onChange={e => set('adminGroup', e.target.value)}
                  placeholder="CN=Proxy_Admins,OU=Groups,DC=exemple,DC=com"
                  className={inputCls}
                />
                <p className="text-xs text-admin-text-muted">Membres → rôle admin</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Groupe Users</Label>
                <Input
                  value={form.userGroup}
                  onChange={e => set('userGroup', e.target.value)}
                  placeholder="CN=Proxy_Users,OU=Groups,DC=exemple,DC=com"
                  className={inputCls}
                />
                <p className="text-xs text-admin-text-muted">Membres → rôle utilisateur</p>
              </div>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={form.requireGroup}
                onChange={e => set('requireGroup', e.target.checked)}
                className="w-4 h-4 rounded accent-admin-primary"
              />
              <span className="text-sm text-admin-text">Refuser la connexion si l'utilisateur n'appartient à aucun groupe configuré</span>
            </label>
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-red-500/10 border-red-500/25 text-red-400'
            }`}>
              {testResult.ok
                ? <Check className="w-4 h-4 shrink-0" strokeWidth={2} />
                : <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={2} />}
              {testResult.message}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <AdminButton
              variant="secondary"
              onClick={handleTest}
              disabled={testing || !form.url || !form.bindDN}
            >
              {testing
                ? <Loader className="w-4 h-4 animate-spin mr-2" strokeWidth={1.5} />
                : <Plug className="w-4 h-4 mr-2" strokeWidth={1.5} />}
              Tester la connexion
            </AdminButton>
            <AdminButton onClick={handleSave} disabled={saving}>
              {saving
                ? <Loader className="w-4 h-4 animate-spin mr-2" strokeWidth={1.5} />
                : <Save className="w-4 h-4 mr-2" strokeWidth={1.5} />}
              Sauvegarder
            </AdminButton>
          </div>
        </AdminCardContent>
      </AdminCard>

      {/* Domain transfer */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Transfert de domaines</AdminCardTitle>
          <p className="text-xs text-admin-text-muted mt-1">
            Transférez les domaines personnels d'un compte local vers un compte LDAP (ou tout autre compte).
          </p>
        </AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Compte source</Label>
              <select value={fromUser} onChange={e => setFromUser(e.target.value)} className={selectCls}>
                <option value="">— Sélectionner —</option>
                {users.map(u => (
                  <option key={u.id} value={String(u.id)}>
                    {u.username}{u.display_name && u.display_name !== u.username ? ` (${u.display_name})` : ''} — {u.domain_count} domaine(s)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-center mb-1">
              <ArrowRight className="w-5 h-5 text-admin-text-muted" strokeWidth={1.5} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-admin-text-muted uppercase tracking-wider">Compte destination</Label>
              <select value={toUser} onChange={e => setToUser(e.target.value)} className={selectCls}>
                <option value="">— Sélectionner —</option>
                {users.filter(u => String(u.id) !== fromUser).map(u => (
                  <option key={u.id} value={String(u.id)}>
                    {u.username}{u.display_name && u.display_name !== u.username ? ` (${u.display_name})` : ''} — {u.domain_count} domaine(s)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {fromUserObj && toUserObj && (
            <div className="bg-admin-surface rounded-lg px-4 py-3 text-xs text-admin-text-muted">
              <span className="font-medium text-admin-text">{fromUserObj.domain_count}</span> domaine(s) personnel(s) de{' '}
              <span className="font-medium text-admin-text">{fromUserObj.username}</span>{' '}
              seront transférés vers{' '}
              <span className="font-medium text-admin-text">{toUserObj.username}</span>
            </div>
          )}

          {transferResult && (
            <p className={`text-sm ${transferResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
              {transferResult}
            </p>
          )}

          <div className="flex justify-end">
            <AdminButton
              onClick={handleTransfer}
              disabled={!fromUser || !toUser || transferring}
            >
              {transferring
                ? <Loader className="w-4 h-4 animate-spin mr-2" strokeWidth={1.5} />
                : <RefreshCw className="w-4 h-4 mr-2" strokeWidth={1.5} />}
              Transférer les domaines
            </AdminButton>
          </div>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
