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
    'Proxy + security': 'Proxy Security',
    'ACME / Let\'s Encrypt': 'TLS Certificates'
  };

  const variableLabelMap = {
    ALLOWED_ORIGINS: 'Allowed Origins (CORS)',
    ALLOW_PRIVATE_BACKENDS: 'Allow Private Backends',
    ALLOW_PRIVATE_BACKEND: 'Allow Private Backends',
    ACME_EMAIL: 'ACME Contact Email'
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

  // Keep admin config minimal: hide advanced/internal keys and keys managed elsewhere.
  const filteredSections = useMemo(() => {
    const proxySecurityAllowed = new Set([
      'ALLOWED_ORIGINS',
      'ALLOW_PRIVATE_BACKENDS',
      'ALLOW_PRIVATE_BACKEND'
    ]);

    return configSections.map(section => ({
      ...section,
      variables: section.variables.filter(variable => {
        const key = variable.key;
        // Hide full auth mode + ldap surface in admin panel
        if (key === 'AUTH_MODE' || key.startsWith('LDAP_')) {
          return false;
        }
        // Hide values handled during setup or too low-level for day-to-day admin edits
        if (
          key.startsWith('JWT_') ||
          key === 'NODE_ENV' ||
          key === 'PORT' ||
          key === 'HOST' ||
          key === 'PROXY_ENABLED' ||
          key === 'FRONTEND_PORT' ||
          key === 'FRONTEND_DIST_PATH' ||
          key === 'CSRF_ENABLED' ||
          key === 'DNS_REBINDING_PROTECTION' ||
          key.startsWith('FRONTEND_') ||
          key.startsWith('VITE_')
        ) {
          return false;
        }
        // Notifications and SMTP relay are managed in dedicated admin pages
        if (key.startsWith('SMTP_') && !key.startsWith('SMTP_PROXY_')) {
          return false;
        }
        if (key.startsWith('SMTP_PROXY_')) {
          return false;
        }
        if (key.includes('WEBHOOK')) {
          return false;
        }
        // Keep proxy security focused on two essentials only
        if (
          key.startsWith('ALLOW_') ||
          key === 'ALLOWED_ORIGINS' ||
          key === 'ALLOWED_DOMAINS' ||
          key === 'PROXY_CHECK_TOKEN'
        ) {
          return proxySecurityAllowed.has(key);
        }
        // Hide health-check and logging tunables
        if (
          key.startsWith('HEALTHCHECK_') ||
          key.includes('_HEALTH_') ||
          key.startsWith('LOG_') ||
          key === 'AUTH_DEBUG'
        ) {
          return false;
        }
        // Keep only ACME email from ACME block
        if (key.startsWith('ACME_') && key !== 'ACME_EMAIL') {
          return false;
        }
        return true;
      })
    })).filter(section => section.variables.length > 0); // Remove empty sections
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
    ALLOW_PRIVATE_BACKENDS: { type: 'select', options: ['true', 'false'] },
    ALLOW_PRIVATE_BACKEND: { type: 'select', options: ['true', 'false'] }
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
