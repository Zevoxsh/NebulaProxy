import { useState, useEffect } from 'react';
import { Mail, Save, TestTube, AlertCircle } from 'lucide-react';
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

export default function AdminSmtp() {
  const [config, setConfig] = useState({
    email: {
      enabled: false,
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_password: '',
      from_email: '',
      to_emails: ''
    },
    alerts: {}
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

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
          email: {
            ...prev.email,
            ...(response.data.config.email || {})
          }
        }));
      }
    } catch {
      setError('Failed to load SMTP configuration');
    } finally {
      setLoading(false);
    }
  };

  const updateEmailConfig = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      email: {
        ...prev.email,
        [key]: value
      }
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      await adminAPI.updateNotificationConfig({
        ...config
      });
      toast({
        title: 'SMTP Saved',
        description: 'SMTP configuration saved successfully'
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to save SMTP configuration';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    try {
      setTesting(true);
      setError('');
      await adminAPI.testNotification('email');
      toast({
        title: 'Test Sent',
        description: 'Test email sent successfully'
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to send test email';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setTesting(false);
    }
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

  return (
    <div data-admin-theme className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-admin-text mb-2">SMTP Setup</h1>
          <p className="text-admin-text-muted">Configure SMTP used for platform email notifications</p>
        </div>
        <AdminButton onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save SMTP'}
        </AdminButton>
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-admin-primary" />
              <div>
                <AdminCardTitle>Email Transport</AdminCardTitle>
                <p className="text-xs text-admin-text-muted mt-0.5">
                  SMTP server and sender configuration
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="smtp-enabled"
                checked={Boolean(config.email.enabled)}
                onCheckedChange={(checked) => updateEmailConfig('enabled', checked)}
                className="border-admin-border data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
              />
              <Label htmlFor="smtp-enabled" className="text-admin-text cursor-pointer">
                Enabled
              </Label>
            </div>
          </div>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-admin-text">SMTP Host</Label>
              <Input
                type="text"
                value={config.email.smtp_host || ''}
                onChange={(e) => updateEmailConfig('smtp_host', e.target.value)}
                placeholder="smtp.gmail.com"
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.email.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">SMTP Port</Label>
              <Input
                type="number"
                value={config.email.smtp_port ?? 587}
                onChange={(e) => updateEmailConfig('smtp_port', parseInt(e.target.value, 10) || 0)}
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.email.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">SMTP Username</Label>
              <Input
                type="text"
                value={config.email.smtp_user || ''}
                onChange={(e) => updateEmailConfig('smtp_user', e.target.value)}
                placeholder="user@example.com"
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.email.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">SMTP Password</Label>
              <Input
                type="password"
                value={config.email.smtp_password || ''}
                onChange={(e) => updateEmailConfig('smtp_password', e.target.value)}
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.email.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">From Email</Label>
              <Input
                type="email"
                value={config.email.from_email || ''}
                onChange={(e) => updateEmailConfig('from_email', e.target.value)}
                placeholder="alerts@example.com"
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.email.enabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-admin-text">To Emails (comma-separated)</Label>
              <Input
                type="text"
                value={config.email.to_emails || ''}
                onChange={(e) => updateEmailConfig('to_emails', e.target.value)}
                placeholder="admin@example.com, ops@example.com"
                className="bg-admin-bg border-admin-border text-admin-text"
                disabled={!config.email.enabled}
              />
            </div>
          </div>
          <Separator className="my-6 bg-admin-border" />
          <AdminButton
            variant="secondary"
            onClick={handleTestEmail}
            disabled={!config.email.enabled || testing}
          >
            <TestTube className="w-4 h-4 mr-2" />
            {testing ? 'Sending Test...' : 'Send Test Email'}
          </AdminButton>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
