import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock, Activity, FileText, Globe, Cable, Mail, Server,
  Database, ShieldCheck, ChevronRight, Save, Type
} from 'lucide-react';
import { adminAPI } from '../../api/client';
import { useBrandingStore } from '../../store/brandingStore';
import { Input } from '@/components/ui/input';
import { AdminButton } from '@/components/admin';
import { useToast } from '@/hooks/use-toast';

const SECTIONS = [
  { path: '/admin/config/health',     icon: Activity,      label: 'Health Checks',         desc: 'Intervalle, seuils DOWN/UP, timeout' },
  { path: '/admin/config/logs',       icon: FileText,      label: 'Logs & Rétention',       desc: 'Niveau de log, durée de conservation' },
  { path: '/admin/config/proxy',      icon: Globe,         label: 'Proxy',                  desc: 'Backends autorisés, timeout, CORS' },
  { path: '/admin/config/tunnels',    icon: Cable,         label: 'Tunnels',                desc: 'Domaine public, plage de ports' },
  { path: '/admin/config/database',   icon: Database,      label: 'Base de données',        desc: 'Connexion PostgreSQL' },
  { path: '/admin/config/tls',        icon: ShieldCheck,   label: 'Certificats TLS',        desc: 'Email ACME pour Let\'s Encrypt' },
  { path: '/admin/ldap',             icon: Lock,          label: 'Authentification / LDAP', desc: 'Mode de connexion et annuaire LDAP' },
  { path: '/admin/smtp',             icon: Mail,          label: 'Email SMTP',              desc: 'Notifications et alertes par email' },
  { path: '/admin/smtp-proxy',       icon: Server,        label: 'Proxy SMTP',             desc: 'Relais TCP pour le trafic email' },
];

export default function AdminConfig() {
  const navigate = useNavigate();
  const { appName: storeAppName, setAppName: setStoreAppName } = useBrandingStore();
  const [brandingName, setBrandingName] = useState(storeAppName);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const { toast } = useToast();

  const handleSaveBranding = async () => {
    if (!brandingName.trim()) return;
    try {
      setBrandingSaving(true);
      const res = await adminAPI.updateBranding({ appName: brandingName.trim() });
      setStoreAppName(res.data.appName);
      toast({ title: 'Branding mis à jour', description: `Nom : "${res.data.appName}"` });
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de sauvegarder' });
    } finally {
      setBrandingSaving(false);
    }
  };

  return (
    <div data-admin-theme className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-admin-text">Configuration</h1>
        <p className="text-admin-text-muted mt-1 text-sm">Paramètres système de NebulaProxy</p>
      </div>

      {/* Branding */}
      <div className="bg-admin-surface border border-admin-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-admin-primary/10 flex items-center justify-center">
            <Type className="w-4 h-4 text-admin-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-admin-text">Branding</h2>
            <p className="text-xs text-admin-text-muted">Nom affiché dans toute l'interface</p>
          </div>
        </div>
        <div className="flex items-center gap-3 max-w-xs">
          <Input
            value={brandingName}
            onChange={e => setBrandingName(e.target.value)}
            className="bg-admin-bg border-admin-border text-admin-text h-9 text-sm"
            placeholder="NebulaProxy"
            maxLength={64}
          />
          <AdminButton onClick={handleSaveBranding} disabled={brandingSaving || !brandingName.trim()}>
            <Save className="w-4 h-4 mr-2" />
            {brandingSaving ? '…' : 'Sauvegarder'}
          </AdminButton>
        </div>
      </div>

      {/* Section cards */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-admin-text-subtle mb-3">Sections</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {SECTIONS.map(({ path, icon: Icon, label, desc }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className="flex items-center gap-4 p-4 bg-admin-surface border border-admin-border rounded-xl hover:border-admin-primary/50 hover:bg-admin-primary/5 transition-all text-left group"
            >
              <div className="w-10 h-10 rounded-lg bg-admin-primary/10 flex items-center justify-center shrink-0 group-hover:bg-admin-primary/20 transition-colors">
                <Icon className="w-5 h-5 text-admin-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-admin-text">{label}</p>
                <p className="text-xs text-admin-text-muted mt-0.5">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-admin-text-subtle group-hover:text-admin-primary shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
