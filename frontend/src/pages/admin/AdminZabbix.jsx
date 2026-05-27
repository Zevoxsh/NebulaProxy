import { useState, useEffect } from 'react';
import { Activity, Save, TestTube, AlertCircle, CheckCircle2, Download, Copy, Globe } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminAlert,
  AdminAlertDescription
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

const DEFAULT_ZABBIX = {
  enabled: false,
  server_host: '',
  server_port: 10051,
  host_name: 'NebulaProxy',
  send_domain_alerts: true,
  send_ssl_alerts: true,
  send_resource_alerts: true,
  send_lifecycle_events: true
};

export default function AdminZabbix() {
  const [config, setConfig] = useState({ zabbix: { ...DEFAULT_ZABBIX }, alerts: {}, email: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const lldUrl = `${window.location.origin}/api/zabbix/lld/domains`;
  const templateUrl = `${window.location.origin}/api/zabbix/template`;

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getNotificationConfig();
      if (response.data.config) {
        setConfig((prev) => ({
          ...prev,
          ...response.data.config,
          zabbix: {
            ...DEFAULT_ZABBIX,
            ...(response.data.config.zabbix || {})
          }
        }));
      }
    } catch {
      setError('Failed to load Zabbix configuration');
    } finally {
      setLoading(false);
    }
  };

  const updateZabbix = (key, value) => {
    setTestResult(null);
    setConfig((prev) => ({
      ...prev,
      zabbix: { ...prev.zabbix, [key]: value }
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      await adminAPI.updateNotificationConfig(config);
      toast({ title: 'Saved', description: 'Zabbix configuration saved successfully' });
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save Zabbix configuration';
      setError(msg);
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError('');
      await adminAPI.updateNotificationConfig(config);
      const res = await adminAPI.testZabbixConnection();
      setTestResult({ success: true, message: res.data?.message || 'Connection successful' });
      toast({ title: 'Success', description: 'Zabbix connection test passed' });
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Connection failed';
      setTestResult({ success: false, message: msg });
      toast({ variant: 'destructive', title: 'Connection Failed', description: msg });
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: 'Copied', description: 'URL copied to clipboard' });
    });
  };

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

  const z = config.zabbix;

  return (
    <div data-admin-theme className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">Zabbix Integration</h1>
          <p className="text-admin-text-muted">
            Push metrics and alerts to a Zabbix server via the Zabbix Sender protocol
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
          {testResult.success
            ? <CheckCircle2 className="h-4 w-4" />
            : <AlertCircle className="h-4 w-4" />}
          <AdminAlertDescription>{testResult.message}</AdminAlertDescription>
        </AdminAlert>
      )}

      {/* Template download */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-admin-primary" />
            <div>
              <AdminCardTitle>Zabbix Template</AdminCardTitle>
              <p className="text-xs text-admin-text-muted mt-0.5">
                Import this template into your Zabbix server to get items, triggers and graphs pre-configured
              </p>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-4">
          <div className="flex items-center gap-3">
            <a href={templateUrl} download="nebula_proxy_template.yaml">
              <AdminButton variant="secondary">
                <Download className="w-4 h-4 mr-2" />
                Download nebula_proxy_template.yaml
              </AdminButton>
            </a>
            <span className="text-xs text-admin-text-muted">Compatible with Zabbix 6.0+</span>
          </div>
          <p className="text-xs text-admin-text-muted">
            After import: go to <strong className="text-admin-text">Configuration → Hosts</strong>, link the
            template to your host, then set the <code className="bg-admin-border px-1 rounded">{'{$NEBULA_URL}'}</code> macro
            to this server's URL so Zabbix can auto-discover domains.
          </p>
        </AdminCardContent>
      </AdminCard>

      {/* LLD discovery URL */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-admin-primary" />
            <div>
              <AdminCardTitle>Domain Discovery (LLD)</AdminCardTitle>
              <p className="text-xs text-admin-text-muted mt-0.5">
                Zabbix polls this URL hourly to discover active domains automatically
              </p>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-admin-bg border border-admin-border rounded px-3 py-2 font-mono text-admin-text break-all">
              {lldUrl}
            </code>
            <AdminButton variant="secondary" size="sm" onClick={() => copyToClipboard(lldUrl)}>
              <Copy className="w-3.5 h-3.5" />
            </AdminButton>
          </div>
          <p className="text-xs text-admin-text-muted">
            Set this as the <strong className="text-admin-text">{'{$NEBULA_URL}'}</strong> macro value
            in Zabbix (without the path). The discovery rule in the template uses it automatically.
          </p>
        </AdminCardContent>
      </AdminCard>

      {/* Zabbix Sender connection */}
      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-admin-primary" />
              <div>
                <AdminCardTitle>Zabbix Sender (Active Push)</AdminCardTitle>
                <p className="text-xs text-admin-text-muted mt-0.5">
                  NebulaProxy pushes events to your Zabbix server via TCP port 10051
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="zabbix-enabled"
                checked={Boolean(z.enabled)}
                onCheckedChange={(checked) => updateZabbix('enabled', checked)}
                className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
              />
              <Label htmlFor="zabbix-enabled" className="text-admin-text cursor-pointer">
                Enabled
              </Label>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-2">
              <Label className="text-admin-text">Server Host</Label>
              <Input
                type="text"
                value={z.server_host || ''}
                onChange={(e) => updateZabbix('server_host', e.target.value)}
                placeholder="192.168.1.100 or zabbix.example.com"
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!z.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">Port</Label>
              <Input
                type="number"
                value={z.server_port ?? 10051}
                onChange={(e) => updateZabbix('server_port', parseInt(e.target.value, 10) || 10051)}
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!z.enabled}
              />
            </div>
            <div className="md:col-span-3 space-y-2">
              <Label className="text-admin-text">Host Name (in Zabbix)</Label>
              <Input
                type="text"
                value={z.host_name || ''}
                onChange={(e) => updateZabbix('host_name', e.target.value)}
                placeholder="NebulaProxy"
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!z.enabled}
              />
              <p className="text-xs text-admin-text-muted">
                Must match the host name configured in your Zabbix server for trapper items.
              </p>
            </div>
          </div>

          <Separator className="my-6 bg-admin-border" />

          <AdminButton
            variant="secondary"
            onClick={handleTest}
            disabled={!z.enabled || !z.server_host || testing}
          >
            <TestTube className="w-4 h-4 mr-2" />
            {testing ? 'Testing...' : 'Test Connection'}
          </AdminButton>
        </AdminCardContent>
      </AdminCard>

      {/* Event categories */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Events to Forward</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-5">
          <EventToggle
            id="domain-alerts"
            checked={Boolean(z.send_domain_alerts)}
            onCheckedChange={(v) => updateZabbix('send_domain_alerts', v)}
            disabled={!z.enabled}
            label="Domain Alerts"
            description="Domain up/down status changes and response times"
            keys={['nebula.domain.status[<hostname>]', 'nebula.domain.response_time[<hostname>]']}
          />
          <Separator className="bg-admin-border" />
          <EventToggle
            id="ssl-alerts"
            checked={Boolean(z.send_ssl_alerts)}
            onCheckedChange={(v) => updateZabbix('send_ssl_alerts', v)}
            disabled={!z.enabled}
            label="SSL Certificate Alerts"
            description="Days remaining before SSL certificate expiry"
            keys={['nebula.ssl.expires_in[<hostname>]']}
          />
          <Separator className="bg-admin-border" />
          <EventToggle
            id="resource-alerts"
            checked={Boolean(z.send_resource_alerts)}
            onCheckedChange={(v) => updateZabbix('send_resource_alerts', v)}
            disabled={!z.enabled}
            label="System Resource Alerts"
            description="CPU, memory, and disk usage when thresholds are breached"
            keys={['nebula.system.cpu', 'nebula.system.memory', 'nebula.system.disk']}
          />
          <Separator className="bg-admin-border" />
          <EventToggle
            id="lifecycle-events"
            checked={Boolean(z.send_lifecycle_events)}
            onCheckedChange={(v) => updateZabbix('send_lifecycle_events', v)}
            disabled={!z.enabled}
            label="Proxy Lifecycle Events"
            description="Proxy start/stop and maintenance mode transitions"
            keys={['nebula.proxy.status']}
          />
        </AdminCardContent>
      </AdminCard>

      {/* Setup guide */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Setup Guide</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-4 space-y-4 text-sm text-admin-text-muted">
          <ol className="list-decimal list-inside space-y-3">
            <li>
              <strong className="text-admin-text">Download & import</strong> the YAML template above into
              your Zabbix server via <em>Configuration → Templates → Import</em>.
            </li>
            <li>
              <strong className="text-admin-text">Create a host</strong> in Zabbix named{' '}
              <code className="text-admin-text bg-admin-border px-1 rounded">NebulaProxy</code> (or
              whatever you set in <em>Host Name</em> above). Link the imported template to it.
            </li>
            <li>
              <strong className="text-admin-text">Set the macro</strong>{' '}
              <code className="text-admin-text bg-admin-border px-1 rounded">{'{$NEBULA_URL}'}</code> on
              the host to <code className="text-admin-text bg-admin-border px-1 rounded">{window.location.origin}</code>{' '}
              so Zabbix can call the LLD endpoint and discover domains automatically.
            </li>
            <li>
              <strong className="text-admin-text">Enable the Sender</strong> on this page, enter your
              Zabbix server host/port, and click <em>Test Connection</em>.
            </li>
            <li>
              Domain items are <strong className="text-admin-text">Zabbix trapper</strong> type — they
              only receive data when NebulaProxy pushes an event (health change, SSL alert, etc.),
              not on a fixed schedule.
            </li>
          </ol>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}

function EventToggle({ id, checked, onCheckedChange, disabled, label, description, keys }) {
  return (
    <div className="flex items-start gap-4">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5 border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
      />
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-admin-text cursor-pointer font-medium">
          {label}
        </Label>
        <p className="text-xs text-admin-text-muted mt-0.5">{description}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {keys.map((k) => (
            <code
              key={k}
              className="text-xs bg-admin-border text-admin-text px-1.5 py-0.5 rounded font-mono"
            >
              {k}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}
