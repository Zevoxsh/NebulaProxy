import { useEffect, useState } from 'react';
import { Shield, Save, RefreshCw, Bell, Mail } from 'lucide-react';
import { settingsAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Switch } from '@/components/ui/switch';

export default function Settings() {
  const user = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState(true);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [notificationSettings, setNotificationSettings] = useState({
    notificationsEnabled: false,
    emailEnabled: false
  });

  const fetchNotificationSettings = async () => {
    try {
      const response = await settingsAPI.getNotificationSettings();
      const settings = response.data.settings || {};
      setNotificationSettings({
        notificationsEnabled: Boolean(settings.notificationsEnabled),
        emailEnabled: Boolean(settings.emailEnabled)
      });
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setTestResult(null);
    fetchNotificationSettings();
  }, []);

  const handleSaveNotificationSettings = async () => {
    try {
      setTestResult(null);
      await settingsAPI.updateNotificationSettings(notificationSettings);
    } catch (error) {
      console.error('Error saving notification settings:', error);
      setTestResult({ success: false, message: error.response?.data?.error || 'Failed to save settings' });
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const response = await settingsAPI.testEmail();
      setTestResult({ success: true, message: response.data.message });
    } catch (error) {
      setTestResult({ success: false, message: error.response?.data?.error || 'Failed to send test email' });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in">
            <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Settings</h1>
            <p className="text-xs text-white/50 font-light tracking-wide">Notifications only</p>
          </div>
        </div>
      </div>

      <div className="page-body">

        <div className="space-y-4">
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="mb-5">
              <h2 className="text-base font-light text-white tracking-tight mb-1">Notifications</h2>
              <p className="text-xs text-white/50 font-light tracking-wide">Receive real-time alerts when your domains go down or come back online</p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-lg">
                <div>
                  <h3 className="text-xs font-normal text-white mb-0.5">Enable Notifications</h3>
                  <p className="text-xs text-white/60 font-light">Get notified on status changes for your personal domains</p>
                </div>
                <Switch
                  checked={notificationSettings.notificationsEnabled}
                  onCheckedChange={(checked) => setNotificationSettings({ ...notificationSettings, notificationsEnabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-lg">
                <div>
                  <h3 className="text-xs font-normal text-white mb-0.5">Enable Email Notifications</h3>
                  <p className="text-xs text-white/60 font-light">
                    Sent to {user?.email ? user.email : 'your profile email'}
                  </p>
                </div>
                <Switch
                  checked={notificationSettings.emailEnabled}
                  onCheckedChange={(checked) => setNotificationSettings({ ...notificationSettings, emailEnabled: checked })}
                />
              </div>
              {!user?.email && notificationSettings.emailEnabled && (
                <div className="text-xs text-[#FCA5A5]">
                  No email set in profile. Emails will not be sent.
                </div>
              )}


              {testResult && (
                <div className={`${testResult.success ? 'bg-[#10B981]/10 border-[#10B981]/20' : 'bg-[#EF4444]/10 border-[#EF4444]/20'} backdrop-blur-lg border rounded-lg p-4 animate-fade-in`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg ${testResult.success ? 'bg-[#10B981]/10 border-[#10B981]/30' : 'bg-[#EF4444]/10 border-[#EF4444]/30'} border flex items-center justify-center flex-shrink-0`}>
                      {testResult.success ? (
                        <Bell className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                      ) : (
                        <X className="w-4 h-4 text-[#F87171]" strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-xs font-medium ${testResult.success ? 'text-[#34D399]' : 'text-[#F87171]'} mb-1`}>
                        {testResult.success ? 'Test Successful' : 'Test Failed'}
                      </p>
                      <p className="text-xs text-white/70 font-light leading-relaxed">{testResult.message}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-3">
                <button
                  onClick={handleTestEmail}
                  disabled={!user?.email || testingEmail}
                  className="btn-secondary flex-1 flex items-center justify-center gap-2"
                >
                  {testingEmail ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                      Sending Test...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" strokeWidth={1.5} />
                      Test Email
                    </>
                  )}
                </button>
                <button
                  onClick={handleSaveNotificationSettings}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" strokeWidth={1.5} />
                  Save Settings
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#9D4EDD]/10 backdrop-blur-lg border border-[#9D4EDD]/20 rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center flex-shrink-0">
                  <Bell className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-[#C77DFF] mb-1">Real-time Monitoring</p>
                  <p className="text-xs text-white/70 font-light leading-relaxed">
                    Get instant notifications when your domains change status. Includes domain name, protocol, response time, and error details.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-[#22D3EE]" strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-[#22D3EE] mb-1">Personal Domains Only</p>
                  <p className="text-xs text-white/70 font-light leading-relaxed">
                    Notifications here are for personal domains only. Team domain alerts are configured in the Teams page.
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
