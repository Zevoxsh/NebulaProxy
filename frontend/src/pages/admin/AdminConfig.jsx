import { useState, useEffect, useRef } from 'react';
import {
  Lock, Activity, FileText, Globe, Cable, Mail, Server,
  Database, ShieldCheck, AlertTriangle, Eye, EyeOff, Save,
  Type, Download, RefreshCw
} from 'lucide-react';
import { adminAPI } from '../../api/client';
import { useBrandingStore } from '../../store/brandingStore';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  AdminButton,
  AdminAlert,
  AdminAlertDescription,
} from '@/components/admin';

const NAV = [
  { id: 'auth',      label: 'Authentification', icon: Lock },
  { id: 'health',    label: 'Health Checks',     icon: Activity },
  { id: 'logs',      label: 'Logs & Rétention',  icon: FileText },
  { id: 'proxy',     label: 'Proxy',             icon: Globe },
  { id: 'tunnels',   label: 'Tunnels',           icon: Cable },
  { id: 'smtp',      label: 'Email SMTP',        icon: Mail },
  { id: 'smtpproxy', label: 'Proxy SMTP',        icon: Server },
  { id: 'database',  label: 'Base de données',   icon: Database },
  { id: 'tls',       label: 'Certificats TLS',   icon: ShieldCheck },
  { id: 'error502',  label: 'Page d\'erreur 502', icon: AlertTriangle },
];

function Row({ label, hint, full = false, children }) {
  return (
    <div className={`flex ${full ? 'flex-col gap-2' : 'items-center justify-between gap-6'} px-5 py-3.5`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-admin-text leading-none">{label}</p>
        {hint && <p className="text-xs text-admin-text-muted mt-1 leading-relaxed">{hint}</p>}
      </div>
      <div className={full ? 'w-full' : 'shrink-0 w-56'}>{children}</div>
    </div>
  );
}

function Section({ id, icon: Icon, title, subtitle, children }) {
  return (
    <div id={`s-${id}`} className="scroll-mt-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-admin-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-admin-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-admin-text">{title}</h2>
          {subtitle && <p className="text-xs text-admin-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="bg-admin-surface border border-admin-border rounded-xl overflow-hidden divide-y divide-admin-border">
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-admin-bg border-admin-border text-admin-text pr-9 h-9 text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-admin-text-muted hover:text-admin-text"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, min, max, step, unit }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm"
      />
      {unit && <span className="text-xs text-admin-text-muted shrink-0">{unit}</span>}
    </div>
  );
}

export default function AdminConfig() {
  const [form, setForm]           = useState({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [active, setActive]       = useState('auth');
  const { toast }                 = useToast();
  const { appName: storeAppName, setAppName: setStoreAppName } = useBrandingStore();
  const [brandingName, setBrandingName] = useState(storeAppName);
  const [brandingSaving, setBrandingSaving] = useState(false);

  useEffect(() => { setBrandingName(storeAppName); }, [storeAppName]);

  const set   = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const bool  = (key)        => form[key] === 'true' || form[key] === true;
  const setb  = (key, val)   => set(key, val ? 'true' : 'false');
  const str   = (key, fb='') => form[key] ?? fb;

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await adminAPI.getConfig();
      const flat = {};
      (res.data.sections || []).forEach(s => s.variables.forEach(v => { flat[v.key] = v.value ?? ''; }));
      setForm(flat);
    } catch {
      setError('Impossible de charger la configuration.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await adminAPI.updateConfig(form);
      toast({ title: 'Sauvegardé', description: 'Configuration mise à jour.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await adminAPI.exportConfig();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nebulaproxy-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Export impossible' });
    }
  };

  const handleSaveBranding = async () => {
    if (!brandingName.trim()) return;
    try {
      setBrandingSaving(true);
      const res = await adminAPI.updateBranding({ appName: brandingName.trim() });
      setStoreAppName(res.data.appName);
      toast({ title: 'Branding mis à jour' });
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Échec du branding' });
    } finally {
      setBrandingSaving(false);
    }
  };

  const scrollTo = (id) => {
    setActive(id);
    document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id.replace('s-', '')); });
      },
      { rootMargin: '-20% 0px -65% 0px' }
    );
    NAV.forEach(({ id }) => {
      const el = document.getElementById(`s-${id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading]);

  if (loading) {
    return (
      <div className="space-y-4" data-admin-theme>
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48 bg-admin-border" />
          <Skeleton className="h-9 w-32 bg-admin-border" />
        </div>
        <div className="flex gap-6">
          <Skeleton className="w-52 h-[480px] bg-admin-border shrink-0 rounded-xl" />
          <div className="flex-1 space-y-6">
            {[1,2,3].map(i => <Skeleton key={i} className="h-48 bg-admin-border rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text">Configuration</h1>
          <p className="text-admin-text-muted mt-1 text-sm">Paramètres runtime stockés dans Redis</p>
        </div>
        <div className="flex items-center gap-2">
          <AdminButton variant="secondary" onClick={handleExport} title="Exporter la config en JSON">
            <Download className="w-4 h-4 mr-2" />
            Exporter
          </AdminButton>
          <AdminButton variant="secondary" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Recharger
          </AdminButton>
          <AdminButton onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </AdminButton>
        </div>
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <div className="flex gap-6 items-start">
        {/* ── Left nav ─────────────────────────────────────────── */}
        <nav className="w-52 shrink-0 sticky top-6 bg-admin-surface border border-admin-border rounded-xl overflow-hidden">
          {/* Branding inline */}
          <div className="px-4 py-3 border-b border-admin-border">
            <div className="flex items-center gap-1.5 mb-2">
              <Type className="w-3 h-3 text-admin-text-subtle" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-admin-text-subtle">Branding</p>
            </div>
            <div className="flex gap-1.5">
              <input
                value={brandingName}
                onChange={e => setBrandingName(e.target.value)}
                className="flex-1 min-w-0 text-xs bg-admin-bg border border-admin-border text-admin-text rounded-md px-2 py-1.5 outline-none focus:border-admin-primary"
                placeholder="NebulaProxy"
                maxLength={64}
              />
              <button
                type="button"
                onClick={handleSaveBranding}
                disabled={brandingSaving || !brandingName.trim()}
                className="text-xs px-2.5 py-1.5 rounded-md bg-admin-primary/10 text-admin-primary hover:bg-admin-primary/20 disabled:opacity-40 shrink-0 font-medium"
              >
                OK
              </button>
            </div>
          </div>
          {/* Nav items */}
          <div className="py-1.5">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollTo(id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  active === id
                    ? 'text-admin-primary bg-admin-primary/10 font-medium'
                    : 'text-admin-text-muted hover:text-admin-text hover:bg-admin-border/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Content ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-8">

          {/* AUTHENTIFICATION */}
          <Section id="auth" icon={Lock} title="Authentification" subtitle="Mode de connexion des utilisateurs">
            <Row label="Mode" hint="local = comptes internes · ldap = annuaire Active Directory / OpenLDAP">
              <div className="flex rounded-lg border border-admin-border overflow-hidden text-sm">
                {['local', 'ldap'].map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set('AUTH_MODE', mode)}
                    className={`flex-1 py-1.5 transition-colors font-medium ${form['AUTH_MODE'] === mode ? 'bg-admin-primary text-white' : 'text-admin-text-muted hover:bg-admin-border/40'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </Row>
            {form['AUTH_MODE'] === 'ldap' && <>
              <Row label="URL serveur LDAP">
                <Input value={str('LDAP_URL')} onChange={e => set('LDAP_URL', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="ldap://192.168.1.1:389" />
              </Row>
              <Row label="Base DN">
                <Input value={str('LDAP_BASE_DN')} onChange={e => set('LDAP_BASE_DN', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="dc=example,dc=com" />
              </Row>
              <Row label="Bind DN (compte de service)">
                <Input value={str('LDAP_BIND_DN')} onChange={e => set('LDAP_BIND_DN', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="cn=svc,dc=example,dc=com" />
              </Row>
              <Row label="Mot de passe Bind">
                <PasswordInput value={str('LDAP_BIND_PASSWORD')} onChange={v => set('LDAP_BIND_PASSWORD', v)} />
              </Row>
              <Row label="Groupe admins" hint="DN complet du groupe administrateurs">
                <Input value={str('LDAP_ADMIN_GROUP')} onChange={e => set('LDAP_ADMIN_GROUP', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              </Row>
              <Row label="Groupe utilisateurs" hint="DN complet du groupe utilisateurs standard">
                <Input value={str('LDAP_USER_GROUP')} onChange={e => set('LDAP_USER_GROUP', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              </Row>
              <Row label="Requérir appartenance au groupe" hint="Bloque les utilisateurs hors groupe">
                <Switch checked={bool('LDAP_REQUIRE_GROUP')} onCheckedChange={v => setb('LDAP_REQUIRE_GROUP', v)} />
              </Row>
            </>}
          </Section>

          {/* HEALTH CHECKS */}
          <Section id="health" icon={Activity} title="Health Checks" subtitle="Fréquence et seuils de détection des pannes">
            <Row label="Intervalle" hint="Durée entre deux vérifications">
              <NumInput value={str('HEALTHCHECK_INTERVAL_SECONDS')} onChange={v => set('HEALTHCHECK_INTERVAL_SECONDS', v)} min="5" unit="sec" />
            </Row>
            <Row label="Seuil DOWN" hint="Checks consécutifs en échec avant de marquer le domaine DOWN">
              <NumInput value={str('HEALTHCHECK_FAILURE_THRESHOLD')} onChange={v => set('HEALTHCHECK_FAILURE_THRESHOLD', v)} min="1" unit="checks" />
            </Row>
            <Row label="Seuil UP" hint="Checks consécutifs réussis avant de marquer le domaine UP">
              <NumInput value={str('HEALTHCHECK_SUCCESS_THRESHOLD')} onChange={v => set('HEALTHCHECK_SUCCESS_THRESHOLD', v)} min="1" unit="checks" />
            </Row>
            <Row label="Timeout" hint="Délai maximum par vérification">
              <NumInput value={str('HEALTHCHECK_TIMEOUT_MS')} onChange={v => set('HEALTHCHECK_TIMEOUT_MS', v)} min="1000" step="500" unit="ms" />
            </Row>
            <Row label="Concurrence" hint="Vérifications simultanées maximum">
              <Input type="number" min="1" max="100" value={str('HEALTHCHECK_CONCURRENCY')} onChange={e => set('HEALTHCHECK_CONCURRENCY', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
          </Section>

          {/* LOGS */}
          <Section id="logs" icon={FileText} title="Logs & Rétention" subtitle="Conservation et niveau de verbosité des journaux">
            <Row label="Niveau de log">
              <select
                value={str('LOG_LEVEL', 'warn')}
                onChange={e => set('LOG_LEVEL', e.target.value)}
                className="w-full h-9 text-sm bg-admin-bg border border-admin-border text-admin-text rounded-md px-3 outline-none focus:border-admin-primary"
              >
                {['warn','info','debug','error'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Row>
            <Row label="Rétention logs de requêtes" hint="Les logs plus anciens sont supprimés automatiquement">
              <NumInput value={str('LOG_RETENTION_DAYS')} onChange={v => set('LOG_RETENTION_DAYS', v)} min="1" unit="jours" />
            </Row>
            <Row label="Rétention trafic live" hint="Données Redis du trafic temps réel">
              <NumInput value={str('LIVE_TRAFFIC_RETENTION_DAYS')} onChange={v => set('LIVE_TRAFFIC_RETENTION_DAYS', v)} min="1" unit="jours" />
            </Row>
            <Row label="Intervalle nettoyage" hint="Fréquence de la purge automatique">
              <NumInput value={str('LOG_CLEANUP_INTERVAL_HOURS')} onChange={v => set('LOG_CLEANUP_INTERVAL_HOURS', v)} min="1" unit="heures" />
            </Row>
          </Section>

          {/* PROXY */}
          <Section id="proxy" icon={Globe} title="Proxy" subtitle="Comportement du proxy HTTP/HTTPS">
            <Row label="Autoriser les backends HTTP" hint="Permet de proxifier vers des serveurs sans HTTPS">
              <Switch checked={bool('ALLOW_INSECURE_BACKENDS')} onCheckedChange={v => setb('ALLOW_INSECURE_BACKENDS', v)} />
            </Row>
            <Row label="Autoriser les backends privés" hint="Adresses IP locales (192.168.x, 10.x, 172.16.x)">
              <Switch checked={bool('ALLOW_PRIVATE_BACKENDS')} onCheckedChange={v => setb('ALLOW_PRIVATE_BACKENDS', v)} />
            </Row>
            <Row label="Timeout requêtes" hint="Délai maximum avant d'abandonner une requête proxifiée">
              <NumInput value={str('HTTP_PROXY_REQUEST_TIMEOUT_MS')} onChange={v => set('HTTP_PROXY_REQUEST_TIMEOUT_MS', v)} min="1000" step="1000" unit="ms" />
            </Row>
            <Row label="Origines CORS autorisées" hint="URLs séparées par des virgules" full>
              <Input value={str('ALLOWED_ORIGINS')} onChange={e => set('ALLOWED_ORIGINS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="https://proxy.example.com" />
            </Row>
          </Section>

          {/* TUNNELS */}
          <Section id="tunnels" icon={Cable} title="Tunnels" subtitle="Configuration des tunnels TCP/UDP sortants">
            <Row label="Domaine public">
              <Input value={str('TUNNEL_PUBLIC_DOMAIN')} onChange={e => set('TUNNEL_PUBLIC_DOMAIN', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="paxcia.net" />
            </Row>
            <Row label="Plage de ports" hint="Ports assignés aux tunnels (min – max)">
              <div className="flex items-center gap-2">
                <Input type="number" value={str('TUNNEL_PORT_RANGE_MIN')} onChange={e => set('TUNNEL_PORT_RANGE_MIN', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="20000" />
                <span className="text-admin-text-muted text-xs">–</span>
                <Input type="number" value={str('TUNNEL_PORT_RANGE_MAX')} onChange={e => set('TUNNEL_PORT_RANGE_MAX', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="29999" />
              </div>
            </Row>
            <Row label="Durée du code d'enrôlement" hint="Durée de validité du code pour connecter un nouveau tunnel">
              <NumInput value={str('TUNNEL_ENROLLMENT_CODE_TTL_MINUTES')} onChange={v => set('TUNNEL_ENROLLMENT_CODE_TTL_MINUTES', v)} min="1" unit="min" />
            </Row>
          </Section>

          {/* SMTP */}
          <Section id="smtp" icon={Mail} title="Email SMTP" subtitle="Envoi de notifications et alertes par email">
            <Row label="Serveur SMTP">
              <Input value={str('SMTP_HOST')} onChange={e => set('SMTP_HOST', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="smtp.gmail.com" />
            </Row>
            <Row label="Port">
              <Input type="number" value={str('SMTP_PORT')} onChange={e => set('SMTP_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="TLS direct (SMTPS)" hint="Activer si le port est 465">
              <Switch checked={bool('SMTP_SECURE')} onCheckedChange={v => setb('SMTP_SECURE', v)} />
            </Row>
            <Row label="Identifiant">
              <Input value={str('SMTP_USER')} onChange={e => set('SMTP_USER', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Mot de passe">
              <PasswordInput value={str('SMTP_PASS')} onChange={v => set('SMTP_PASS', v)} />
            </Row>
            <Row label="Nom de l'expéditeur">
              <Input value={str('SMTP_FROM_NAME')} onChange={e => set('SMTP_FROM_NAME', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="NebulaProxy" />
            </Row>
            <Row label="Email expéditeur">
              <Input type="email" value={str('SMTP_FROM_EMAIL')} onChange={e => set('SMTP_FROM_EMAIL', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="noreply@example.com" />
            </Row>
            <Row label="Vérifier les certificats TLS" hint="Désactiver uniquement pour les serveurs auto-signés">
              <Switch checked={bool('SMTP_TLS_REJECT_UNAUTHORIZED')} onCheckedChange={v => setb('SMTP_TLS_REJECT_UNAUTHORIZED', v)} />
            </Row>
          </Section>

          {/* SMTP PROXY */}
          <Section id="smtpproxy" icon={Server} title="Proxy SMTP" subtitle="Relais TCP transparent pour le trafic email entrant">
            <Row label="Activé">
              <Switch checked={bool('SMTP_PROXY_ENABLED')} onCheckedChange={v => setb('SMTP_PROXY_ENABLED', v)} />
            </Row>
            <Row label="Serveur mail backend">
              <Input value={str('SMTP_PROXY_BACKEND_HOST')} onChange={e => set('SMTP_PROXY_BACKEND_HOST', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="mail.example.com" />
            </Row>
            <Row label="Port backend">
              <Input type="number" value={str('SMTP_PROXY_BACKEND_PORT')} onChange={e => set('SMTP_PROXY_BACKEND_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Adresse d'écoute">
              <Input value={str('SMTP_PROXY_BIND_ADDRESS')} onChange={e => set('SMTP_PROXY_BIND_ADDRESS', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="0.0.0.0" />
            </Row>
            <Row label="Ports d'écoute" hint="SMTP (25) · Soumission (587) · SMTPS (465)">
              <div className="flex items-center gap-2">
                <Input type="number" value={str('SMTP_PROXY_PORT')} onChange={e => set('SMTP_PROXY_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="25" />
                <Input type="number" value={str('SMTP_PROXY_SUBMISSION_PORT')} onChange={e => set('SMTP_PROXY_SUBMISSION_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="587" />
                <Input type="number" value={str('SMTP_PROXY_SMTPS_PORT')} onChange={e => set('SMTP_PROXY_SMTPS_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="465" />
              </div>
            </Row>
            <Row label="Logs du proxy SMTP">
              <Switch checked={bool('SMTP_PROXY_LOGGING_ENABLED')} onCheckedChange={v => setb('SMTP_PROXY_LOGGING_ENABLED', v)} />
            </Row>
          </Section>

          {/* DATABASE */}
          <Section id="database" icon={Database} title="Base de données" subtitle="Connexion PostgreSQL — redémarrage requis après modification">
            <Row label="Type">
              <Input value={str('DB_TYPE')} onChange={e => set('DB_TYPE', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Hôte">
              <Input value={str('DB_HOST')} onChange={e => set('DB_HOST', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Port">
              <Input type="number" value={str('DB_PORT')} onChange={e => set('DB_PORT', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Nom de la base">
              <Input value={str('DB_NAME')} onChange={e => set('DB_NAME', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Utilisateur">
              <Input value={str('DB_USER')} onChange={e => set('DB_USER', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
            </Row>
            <Row label="Mot de passe">
              <PasswordInput value={str('DB_PASSWORD')} onChange={v => set('DB_PASSWORD', v)} />
            </Row>
          </Section>

          {/* TLS */}
          <Section id="tls" icon={ShieldCheck} title="Certificats TLS" subtitle="Renouvellement automatique via Let's Encrypt / ACME">
            <Row label="Email de contact" hint="Utilisé par Let's Encrypt pour les alertes d'expiration">
              <Input type="email" value={str('ACME_EMAIL')} onChange={e => set('ACME_EMAIL', e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" placeholder="admin@example.com" />
            </Row>
          </Section>

          {/* 502 */}
          <Section id="error502" icon={AlertTriangle} title="Page d'erreur 502" subtitle="Textes affichés quand un backend est inaccessible">
            {[
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
            ].map(([key, label]) => (
              <Row key={key} label={label}>
                <Input value={str(key)} onChange={e => set(key, e.target.value)} className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm" />
              </Row>
            ))}
          </Section>

        </div>
      </div>
    </div>
  );
}
