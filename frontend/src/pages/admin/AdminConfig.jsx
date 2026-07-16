import { useState, useEffect, useMemo } from 'react';
import { Settings, AlertCircle, CheckCircle, Save, RefreshCw, ChevronLeft, ChevronRight, Type, Download } from 'lucide-react';
import { adminAPI } from '../../api/client';
import { useBrandingStore } from '../../store/brandingStore';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle
} from '@/components/admin';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

// Infra-level keys hidden from the UI — dangerous to change or irrelevant at runtime
const INFRA_HIDDEN = new Set([
  'JWT_SECRET', 'JWT_SECRET_PREVIOUS',
  'NODE_ENV', 'HOST', 'PORT',
  'FRONTEND_PORT', 'FRONTEND_DIST_PATH', 'FRONTEND_BUILD_ON_START',
  'VITE_API_BASE_URL',
  'CSRF_ENABLED', 'DNS_REBINDING_PROTECTION', 'AUTH_DEBUG',
  'PROXY_ENABLED',
  'LOG_BACKEND', 'LOG_QUIET', 'LOG_STARTUP_SUMMARY', 'LOG_SUPPRESS_PREFIXES',
  'LOG_SYSLOG_HOST', 'LOG_SYSLOG_PORT', 'LOG_SYSLOG_PROTOCOL',
  'LOG_SYSLOG_APP_NAME', 'LOG_SYSLOG_FACILITY',
]);

export default function AdminConfig() {
  const [configSections, setConfigSections] = useState([]);
  const [configForm, setConfigForm] = useState({});
  const [configSubmitting, setConfigSubmitting] = useState(false);
  const [configErrors, setConfigErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('0');
  const { toast } = useToast();

  // Branding
  const { appName: storeAppName, setAppName: setStoreAppName } = useBrandingStore();
  const [brandingName, setBrandingName] = useState(storeAppName);
  const [brandingSaving, setBrandingSaving] = useState(false);

  useEffect(() => { setBrandingName(storeAppName); }, [storeAppName]);

  const handleSaveBranding = async () => {
    if (!brandingName.trim()) return;
    try {
      setBrandingSaving(true);
      const res = await adminAPI.updateBranding({ appName: brandingName.trim() });
      setStoreAppName(res.data.appName);
      toast({ title: 'Branding updated', description: `App name set to "${res.data.appName}"` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.error || 'Failed to save branding' });
    } finally {
      setBrandingSaving(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleExportConfig = async () => {
    try {
      const res = await adminAPI.exportConfig();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nebulaproxy-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Export failed', description: err.response?.data?.message || 'Failed to export configuration' });
    }
  };

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getConfig();
      setConfigSections(response.data.sections || []);
      const nextForm = {};
      (response.data.sections || []).forEach(section => {
        section.variables.forEach(variable => {
          nextForm[variable.key] = variable.value ?? '';
        });
      });
      setConfigForm(nextForm);
      setConfigErrors([]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConfig = async (e) => {
    e.preventDefault();
    try {
      setConfigSubmitting(true);
      setError('');
      setConfigErrors([]);

      const validation = await adminAPI.validateConfig(configForm);
      if (!validation.data.valid) {
        setConfigErrors(validation.data.errors || []);
        toast({
          variant: 'destructive',
          title: 'Validation Failed',
          description: `${validation.data.errors.length} error(s) found`
        });
        return;
      }

      const response = await adminAPI.updateConfig(configForm);
      if (!response.data.success) {
        setConfigErrors(response.data.errors || ['Failed to save configuration']);
        toast({
          variant: 'destructive',
          title: 'Update Failed',
          description: 'Failed to save configuration'
        });
        return;
      }
      toast({
        title: 'Configuration Updated',
        description: 'Configuration updated successfully. Server restart may be required for some changes.'
      });
    } catch (err) {
      const errors = err.response?.data?.errors || [];
      if (errors.length > 0) {
        setConfigErrors(errors);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `${errors.length} error(s) occurred`
        });
      } else {
        const errorMsg = err.response?.data?.message || 'Failed to update configuration';
        setError(errorMsg);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: errorMsg
        });
      }
    } finally {
      setConfigSubmitting(false);
    }
  };

  const handleValidateConfig = async () => {
    try {
      setError('');
      setConfigErrors([]);
      const validation = await adminAPI.validateConfig(configForm);
      if (!validation.data.valid) {
        setConfigErrors(validation.data.errors || []);
        toast({
          variant: 'destructive',
          title: 'Validation Failed',
          description: `${validation.data.errors.length} error(s) found`
        });
        return;
      }
      toast({
        title: 'Validation Passed',
        description: 'Configuration validation passed successfully'
      });
    } catch (err) {
      const errors = err.response?.data?.errors || [];
      if (errors.length > 0) {
        setConfigErrors(errors);
        toast({
          variant: 'destructive',
          title: 'Validation Failed',
          description: `${errors.length} error(s) found`
        });
      } else {
        const errorMsg = err.response?.data?.message || 'Failed to validate configuration';
        setError(errorMsg);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: errorMsg
        });
      }
    }
  };

  const handleConfigChange = (key, value) => {
    setConfigForm(prev => ({ ...prev, [key]: value }));
  };

  const sectionLabelMap = {
    'Proxy + security': 'Proxy & Sécurité',
    'ACME / Let\'s Encrypt': 'Certificats TLS',
    'Proxy 502 error page': 'Page d\'erreur 502',
    'Health checks': 'Health Checks',
    'Logs': 'Logs',
    'Live traffic retention (Redis)': 'Trafic temps réel',
    'Auth': 'Authentification',
    'Database (PostgreSQL only)': 'Base de données',
    'LDAP': 'LDAP',
    'SMTP Email Notifications': 'Email SMTP',
    'SMTP Proxy Relay': 'Proxy SMTP',
    'Tunnels': 'Tunnels',
  };

  const variableLabelMap = {
    // Proxy & security
    ALLOWED_ORIGINS: 'Origines autorisées (CORS)',
    ALLOW_PRIVATE_BACKENDS: 'Backends privés autorisés',
    ALLOW_PRIVATE_BACKEND: 'Backends privés autorisés',
    ALLOW_INSECURE_BACKENDS: 'Backends HTTP (non-TLS) autorisés',
    HTTP_PROXY_REQUEST_TIMEOUT_MS: 'Timeout requêtes proxy (ms)',
    PROXY_CHECK_TOKEN: 'Token de vérification proxy',
    PROXY_INJECT_CONSOLE_SCRIPT: 'Injecter script console',
    // Auth
    AUTH_MODE: 'Mode d\'authentification',
    // Database
    DB_TYPE: 'Type de base de données',
    DB_HOST: 'Hôte',
    DB_PORT: 'Port',
    DB_NAME: 'Nom de la base',
    DB_USER: 'Utilisateur',
    DB_PASSWORD: 'Mot de passe',
    // LDAP
    LDAP_URL: 'URL du serveur LDAP',
    LDAP_BASE_DN: 'Base DN',
    LDAP_BIND_DN: 'Bind DN (compte de service)',
    LDAP_BIND_PASSWORD: 'Mot de passe Bind',
    LDAP_ADMIN_GROUP: 'Groupe administrateurs',
    LDAP_USER_GROUP: 'Groupe utilisateurs',
    LDAP_REQUIRE_GROUP: 'Requérir appartenance au groupe',
    // Health checks
    HEALTHCHECK_INTERVAL_SECONDS: 'Intervalle entre checks (secondes)',
    HEALTHCHECK_FAILURE_THRESHOLD: 'Checks consécutifs en échec → DOWN',
    HEALTHCHECK_SUCCESS_THRESHOLD: 'Checks consécutifs réussis → UP',
    HEALTHCHECK_TIMEOUT_MS: 'Timeout par check (ms)',
    HEALTHCHECK_CONCURRENCY: 'Checks simultanés',
    HEALTHCHECK_CLEANUP_EVERY: 'Nettoyage historique toutes les N vérifs',
    // Logs
    LOG_LEVEL: 'Niveau de log',
    LOG_RETENTION_DAYS: 'Rétention des logs (jours)',
    LOG_CLEANUP_INTERVAL_HOURS: 'Intervalle nettoyage logs (heures)',
    // Live traffic
    LIVE_TRAFFIC_RETENTION_DAYS: 'Rétention trafic live (jours)',
    LIVE_TRAFFIC_CLEANUP_INTERVAL_MS: 'Intervalle nettoyage trafic (ms)',
    // SMTP
    SMTP_HOST: 'Serveur SMTP',
    SMTP_PORT: 'Port SMTP',
    SMTP_SECURE: 'Connexion TLS directe',
    SMTP_USER: 'Identifiant SMTP',
    SMTP_PASS: 'Mot de passe SMTP',
    SMTP_TLS_REJECT_UNAUTHORIZED: 'Rejeter les certificats TLS invalides',
    SMTP_FROM_NAME: 'Nom de l\'expéditeur',
    SMTP_FROM_EMAIL: 'Email expéditeur',
    // SMTP Proxy
    SMTP_PROXY_ENABLED: 'Proxy SMTP activé',
    SMTP_PROXY_BIND_ADDRESS: 'Adresse d\'écoute',
    SMTP_PROXY_BACKEND_HOST: 'Serveur mail backend',
    SMTP_PROXY_BACKEND_PORT: 'Port backend mail',
    SMTP_PROXY_PORT: 'Port SMTP (25)',
    SMTP_PROXY_SUBMISSION_PORT: 'Port soumission (587)',
    SMTP_PROXY_SMTPS_PORT: 'Port SMTPS (465)',
    SMTP_PROXY_IDLE_TIMEOUT_MS: 'Timeout inactivité (ms)',
    SMTP_PROXY_CONNECT_TIMEOUT_MS: 'Timeout connexion (ms)',
    SMTP_PROXY_LOGGING_ENABLED: 'Activer les logs proxy SMTP',
    // ACME
    ACME_EMAIL: 'Email contact Let\'s Encrypt',
    // Tunnels
    TUNNEL_PUBLIC_DOMAIN: 'Domaine public des tunnels',
    TUNNEL_PORT_RANGE_MIN: 'Port minimum',
    TUNNEL_PORT_RANGE_MAX: 'Port maximum',
    TUNNEL_ENROLLMENT_CODE_TTL_MINUTES: 'Durée du code d\'enrôlement (min)',
    // 502 page
    BAD_GATEWAY_HTML_TITLE: 'Titre de l\'onglet navigateur',
    BAD_GATEWAY_BADGE: 'Texte du badge',
    BAD_GATEWAY_TITLE: 'Titre principal',
    BAD_GATEWAY_SUBTITLE: 'Sous-titre',
    BAD_GATEWAY_MESSAGE: 'Message principal',
    BAD_GATEWAY_DOMAIN_LABEL: 'Label "Domaine"',
    BAD_GATEWAY_PROXY_LABEL: 'Label "Proxy"',
    BAD_GATEWAY_PROXY_VALUE: 'Valeur "Proxy"',
    BAD_GATEWAY_CAUSE_LABEL: 'Label "Cause"',
    BAD_GATEWAY_CAUSE_VALUE: 'Valeur "Cause"',
    BAD_GATEWAY_STATUS_LABEL: 'Label "Statut"',
    BAD_GATEWAY_STATUS_VALUE: 'Valeur "Statut"',
    BAD_GATEWAY_RETRY_BUTTON: 'Bouton Réessayer',
    BAD_GATEWAY_BACK_BUTTON: 'Bouton Retour',
    BAD_GATEWAY_FOOTER_TEXT: 'Texte pied de page',
  };

  // Check if a section has errors
  const getSectionErrors = (section) => {
    return configErrors.filter(error => {
      return section.variables.some(variable =>
        error.toLowerCase().includes(variable.key.toLowerCase()) ||
        error.toLowerCase().includes((variable.label || '').toLowerCase())
      );
    });
  };

  const filteredSections = useMemo(() => {
    return configSections.map(section => ({
      ...section,
      variables: section.variables.filter(variable => {
        const key = variable.key;
        if (INFRA_HIDDEN.has(key)) return false;
        if (key.startsWith('VITE_')) return false;
        if (key.startsWith('FRONTEND_')) return false;
        if (key.includes('WEBHOOK')) return false;
        return true;
      })
    })).filter(section => section.variables.length > 0);
  }, [configSections]);

  // Keyboard navigation for tabs
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!configSubmitting && filteredSections.length > 0) {
          handleUpdateConfig(e);
        }
      }

      // Tab navigation (only when not focused on input)
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
        // Arrow keys to navigate tabs
        const currentIndex = parseInt(activeTab);
        if (e.key === 'ArrowLeft' && currentIndex > 0) {
          e.preventDefault();
          setActiveTab((currentIndex - 1).toString());
        } else if (e.key === 'ArrowRight' && currentIndex < filteredSections.length - 1) {
          e.preventDefault();
          setActiveTab((currentIndex + 1).toString());
        }
        // Number keys (1-9) to jump to specific tab
        else if (e.key >= '1' && e.key <= '9') {
          const tabIndex = parseInt(e.key) - 1;
          if (tabIndex < filteredSections.length) {
            e.preventDefault();
            setActiveTab(tabIndex.toString());
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, filteredSections.length, configSubmitting]);

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <Skeleton className="h-96 bg-admin-border" />
      </div>
    );
  }

  const fieldConfig = {
    // Proxy
    ALLOW_PRIVATE_BACKENDS:           { type: 'select', options: ['false', 'true'] },
    ALLOW_PRIVATE_BACKEND:            { type: 'select', options: ['false', 'true'] },
    ALLOW_INSECURE_BACKENDS:          { type: 'select', options: ['false', 'true'] },
    PROXY_INJECT_CONSOLE_SCRIPT:      { type: 'select', options: ['false', 'true'] },
    // Auth
    AUTH_MODE:                        { type: 'select', options: ['local', 'ldap'] },
    // LDAP
    LDAP_REQUIRE_GROUP:               { type: 'select', options: ['false', 'true'] },
    // Health checks
    HEALTHCHECK_SKIP_TCP:             { type: 'select', options: ['true', 'false'] },
    HEALTHCHECK_SKIP_UDP:             { type: 'select', options: ['false', 'true'] },
    // Logs
    LOG_LEVEL:                        { type: 'select', options: ['warn', 'info', 'debug', 'error'] },
    // SMTP
    SMTP_SECURE:                      { type: 'select', options: ['false', 'true'] },
    SMTP_TLS_REJECT_UNAUTHORIZED:     { type: 'select', options: ['true', 'false'] },
    // SMTP Proxy
    SMTP_PROXY_ENABLED:               { type: 'select', options: ['false', 'true'] },
    SMTP_PROXY_LOGGING_ENABLED:       { type: 'select', options: ['true', 'false'] },
  };

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">System Configuration</h1>
          <p className="text-admin-text-muted">Essential runtime settings only</p>
        </div>
        <div className="flex items-center gap-2">
          <AdminButton variant="secondary" onClick={handleExportConfig} title="Télécharger la config actuelle (importable dans le setup wizard)">
            <Download className="w-4 h-4 mr-2" />
            Exporter config
          </AdminButton>
          <AdminButton variant="secondary" onClick={fetchConfig}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reload
          </AdminButton>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Config Errors */}
      {configErrors.length > 0 && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <div>
            <AdminAlertTitle>Configuration errors:</AdminAlertTitle>
            <AdminAlertDescription>
              <ul className="list-disc list-inside space-y-1 mt-2">
                {configErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </AdminAlertDescription>
          </div>
        </AdminAlert>
      )}

      {/* Branding */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle className="flex items-center gap-2">
            <Type className="w-5 h-5" />
            Branding
          </AdminCardTitle>
          <p className="text-xs text-admin-text-muted mt-1">Customize the application name displayed everywhere (login page, sidebar, page titles).</p>
        </AdminCardHeader>
        <AdminCardContent className="pt-4">
          <div className="flex items-end gap-3 max-w-md">
            <div className="flex-1 space-y-2">
              <Label className="text-admin-text">Application name</Label>
              <Input
                value={brandingName}
                onChange={e => setBrandingName(e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                placeholder="NebulaProxy"
                maxLength={64}
              />
            </div>
            <AdminButton onClick={handleSaveBranding} disabled={brandingSaving || !brandingName.trim()}>
              <Save className="w-4 h-4 mr-2" />
              {brandingSaving ? 'Saving…' : 'Save'}
            </AdminButton>
          </div>
        </AdminCardContent>
      </AdminCard>

      {/* Configuration Form */}
      <form onSubmit={handleUpdateConfig}>
        {filteredSections.length > 0 && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center justify-between mb-4">
              <TabsList className="bg-admin-surface2 border border-admin-border">
                {filteredSections.map((section, index) => {
                  const sectionErrors = getSectionErrors(section);
                  const hasErrors = sectionErrors.length > 0;

                  return (
                    <TabsTrigger
                      key={section.name}
                      value={index.toString()}
                      className="data-[state=active]:bg-black data-[state=active]:text-admin-text data-[state=active]:border data-[state=active]:border-admin-border text-admin-text-muted relative"
                    >
                      {sectionLabelMap[section.name] || section.name}
                      <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-admin-bg">
                        {section.variables.length}
                      </span>
                      {hasErrors && (
                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-admin-danger animate-pulse" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {/* Keyboard Hint */}
              <div className="flex items-center gap-3 text-xs text-admin-text-muted">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-admin-surface2 border border-admin-border rounded font-mono">←</kbd>
                  <kbd className="px-1.5 py-0.5 bg-admin-surface2 border border-admin-border rounded font-mono">→</kbd>
                  Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-admin-surface2 border border-admin-border rounded font-mono">Ctrl+S</kbd>
                  Save
                </span>
                <span>Section {parseInt(activeTab) + 1} of {filteredSections.length}</span>
              </div>
            </div>

            {filteredSections.map((section, sectionIndex) => {
              const sectionErrors = getSectionErrors(section);

              return (
                <TabsContent key={section.name} value={sectionIndex.toString()} className="mt-6">
                  <AdminCard>
                    <AdminCardHeader>
                      <div>
                        <AdminCardTitle className="flex items-center gap-2">
                          <Settings className="w-5 h-5" />
                          {sectionLabelMap[section.name] || section.name}
                        </AdminCardTitle>
                        <p className="text-xs text-admin-text-muted mt-1">
                          {section.variables.length} configuration variable{section.variables.length !== 1 ? 's' : ''}
                          {sectionErrors.length > 0 && (
                            <span className="text-admin-danger ml-2">
                              • {sectionErrors.length} error{sectionErrors.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </p>
                      </div>
                    </AdminCardHeader>
                    <AdminCardContent className="pt-6">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {section.variables.map((variable) => {
                          const key = variable.key;
                          const value = configForm[key] ?? '';
                          const isSecret = /PASSWORD|SECRET|TOKEN/.test(key);
                          const config = fieldConfig[key];

                          return (
                            <div key={key} className="space-y-2">
                              <Label className="text-admin-text">
                                {variableLabelMap[key] || variable.label || key}
                                {variable.required && <span className="text-admin-danger ml-1">*</span>}
                              </Label>
                              {config?.type === 'select' ? (
                                <Combobox
                                  value={value}
                                  onValueChange={(val) => handleConfigChange(key, val)}
                                  options={(config.options || []).map((opt) => ({ value: opt, label: opt }))}
                                  placeholder="Select value"
                                  searchPlaceholder="Search value..."
                                  emptyText="No option found."
                                  triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                                />
                              ) : (
                                <Input
                                  type={isSecret ? 'password' : 'text'}
                                  value={value}
                                  onChange={(e) => handleConfigChange(key, e.target.value)}
                                  className="bg-admin-bg border-admin-border text-admin-text"
                                  placeholder={variable.placeholder}
                                  required={variable.required}
                                />
                              )}
                              {variable.description && (
                                <p className="text-xs text-admin-text-muted">{variable.description}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </AdminCardContent>
                  </AdminCard>
                </TabsContent>
              );
            })}
          </Tabs>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between bg-admin-surface border border-admin-border rounded-lg p-4 mt-6">
          <div className="flex items-center gap-3">
            <AdminButton type="submit" disabled={configSubmitting}>
              <Save className="w-4 h-4 mr-2" />
              {configSubmitting ? 'Saving...' : 'Save Configuration'}
            </AdminButton>
            <AdminButton type="button" variant="secondary" onClick={handleValidateConfig}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Validate
            </AdminButton>
          </div>

          {/* Quick navigation */}
          {filteredSections.length > 1 && (
            <div className="flex items-center gap-2">
              <AdminButton
                type="button"
                variant="secondary"
                onClick={() => setActiveTab(Math.max(0, parseInt(activeTab) - 1).toString())}
                disabled={parseInt(activeTab) === 0}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Previous
              </AdminButton>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={() => setActiveTab(Math.min(filteredSections.length - 1, parseInt(activeTab) + 1).toString())}
                disabled={parseInt(activeTab) === filteredSections.length - 1}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </AdminButton>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
