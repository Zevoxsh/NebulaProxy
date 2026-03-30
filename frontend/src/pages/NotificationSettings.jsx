import { useState, useEffect } from 'react';
import { Bell, Save, TestTube, Loader, Users, User, Globe, Shield, Key, Link as LinkIcon, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { Combobox } from '../components/ui/combobox';

export default function NotificationSettings() {
  const [activeTab, setActiveTab] = useState('personal');
  const [personalPrefs, setPersonalPrefs] = useState(null);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [prefsRes, teamsRes] = await Promise.all([
        axios.get('/api/notification-preferences'),
        axios.get('/api/teams')
      ]);

      setPersonalPrefs(prefsRes.data.preferences);
      const myTeams = teamsRes.data.teams.filter(t => t.role === 'owner');

      const teamsWithSettings = await Promise.all(
        myTeams.map(async (team) => {
          try {
            const settingsRes = await axios.get(`/api/teams/${team.id}/notifications`);
            return { ...team, notificationSettings: settingsRes.data.settings };
          } catch (error) {
            return { ...team, notificationSettings: null };
          }
        })
      );

      setTeams(teamsWithSettings);
      if (teamsWithSettings.length > 0) {
        setSelectedTeam(teamsWithSettings[0]);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setMessage({ type: 'error', text: 'Failed to load notification settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersonal = async () => {
    try {
      setSaving(true);
      await axios.put('/api/notification-preferences', personalPrefs);
      setMessage({ type: 'success', text: 'Personal notification settings saved' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTeam = async () => {
    if (!selectedTeam) return;
    try {
      setSaving(true);
      await axios.put(`/api/teams/${selectedTeam.id}/notifications`, selectedTeam.notificationSettings);
      setMessage({ type: 'success', text: `Team "${selectedTeam.name}" settings saved` });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save team settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestPersonal = async () => {
    try {
      setTesting(true);
      await axios.post('/api/notification-preferences/test');
      setMessage({ type: 'success', text: 'Test webhook sent!' });
      setTimeout(() => setMessage(null), 5000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to send test' });
    } finally {
      setTesting(false);
    }
  };

  const handleTestTeam = async () => {
    if (!selectedTeam) return;
    try {
      setTesting(true);
      await axios.post(`/api/teams/${selectedTeam.id}/notifications/test`);
      setMessage({ type: 'success', text: 'Test webhook sent!' });
      setTimeout(() => setMessage(null), 5000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to send test' });
    } finally {
      setTesting(false);
    }
  };

  const updatePersonalPref = (key, value) => {
    setPersonalPrefs({ ...personalPrefs, [key]: value });
  };

  const updateTeamPref = (key, value) => {
    setSelectedTeam({
      ...selectedTeam,
      notificationSettings: { ...selectedTeam.notificationSettings, [key]: value }
    });
  };

  const renderToggle = (value, onChange) => (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        value ? 'bg-[#9D4EDD]' : 'bg-white/10'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
        value ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );

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
            <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Notification Settings</h1>
            <p className="text-xs text-white/50 font-light tracking-wide">Configure webhook notifications for your domains and teams</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {message && (
          <div className={`mb-4 backdrop-blur-xl border rounded-xl p-3 ${
            message.type === 'success'
              ? 'bg-[#10B981]/10 border-[#10B981]/20'
              : 'bg-[#EF4444]/10 border-[#EF4444]/20'
          }`}>
            <p className={`text-xs ${message.type === 'success' ? 'text-[#34D399]' : 'text-[#F87171]'}`}>
              {message.text}
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab('personal')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-light rounded-xl transition-all ${
              activeTab === 'personal'
                ? 'bg-[#9D4EDD] text-white'
                : 'bg-[#161722]/50 text-white/60 hover:text-white hover:bg-[#161722]'
            }`}
          >
            <User className="w-4 h-4" strokeWidth={1.5} />
            Personal Webhooks
          </button>
          <button
            onClick={() => setActiveTab('teams')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-light rounded-xl transition-all ${
              activeTab === 'teams'
                ? 'bg-[#9D4EDD] text-white'
                : 'bg-[#161722]/50 text-white/60 hover:text-white hover:bg-[#161722]'
            }`}
          >
            <Users className="w-4 h-4" strokeWidth={1.5} />
            Team Webhooks
            {teams.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-white/20 rounded">
                {teams.length}
              </span>
            )}
          </button>
        </div>

        {/* Personal Tab */}
        {activeTab === 'personal' && personalPrefs && (
          <div className="space-y-4">
            {/* Webhook Config */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Webhook Configuration</p>
                    <p className="text-xs text-white/50">Configure your personal webhook endpoint</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleTestPersonal}
                    disabled={testing || !personalPrefs.webhook_enabled || !personalPrefs.webhook_url}
                    className="btn-secondary text-xs flex items-center gap-2"
                  >
                    {testing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
                    Test
                  </button>
                  <button onClick={handleSavePersonal} disabled={saving} className="btn-primary text-xs flex items-center gap-2">
                    {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-xs font-light text-white">Enable Webhooks</p>
                    <p className="text-xs text-white/40">Receive notifications via webhook</p>
                  </div>
                  {renderToggle(personalPrefs.webhook_enabled, (v) => updatePersonalPref('webhook_enabled', v))}
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Webhook URL</label>
                  <input
                    type="text"
                    value={personalPrefs.webhook_url || ''}
                    onChange={(e) => updatePersonalPref('webhook_url', e.target.value)}
                    className="input-futuristic text-xs"
                    placeholder="https://discord.com/api/webhooks/..."
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Webhook Secret (Optional)</label>
                  <input
                    type="password"
                    value={personalPrefs.webhook_secret || ''}
                    onChange={(e) => updatePersonalPref('webhook_secret', e.target.value)}
                    className="input-futuristic text-xs"
                    placeholder="Leave empty for Discord"
                  />
                </div>
              </div>
            </div>

            {/* Domain Notifications */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#22D3EE]/10 border border-[#22D3EE]/30 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-light text-white">Domain Notifications</p>
                  <p className="text-xs text-white/50">Get notified about your domains</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { key: 'domain_added_enabled', label: 'Domain Added' },
                  { key: 'domain_deleted_enabled', label: 'Domain Deleted' },
                  { key: 'domain_updated_enabled', label: 'Domain Updated' },
                  { key: 'domain_down_enabled', label: 'Domain Down' },
                  { key: 'domain_up_enabled', label: 'Domain Back Online' },
                  { key: 'backend_down_enabled', label: 'Backend Down' },
                  { key: 'backend_up_enabled', label: 'Backend Recovered' },
                  { key: 'high_response_time_enabled', label: 'High Response Time' }
                ].map((setting) => (
                  <div key={setting.key} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded-lg">
                    <p className="text-xs font-light text-white">{setting.label}</p>
                    {renderToggle(personalPrefs[setting.key], (v) => updatePersonalPref(setting.key, v))}
                  </div>
                ))}
              </div>
            </div>

            {/* SSL Notifications */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-[#10B981]" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-light text-white">SSL Certificates</p>
                  <p className="text-xs text-white/50">Certificate expiry and renewal alerts</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { key: 'ssl_expiring_enabled', label: 'Certificate Expiring' },
                  { key: 'ssl_renewed_enabled', label: 'Certificate Renewed' },
                  { key: 'ssl_failed_enabled', label: 'Certificate Failed' }
                ].map((setting) => (
                  <div key={setting.key} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded-lg">
                    <p className="text-xs font-light text-white">{setting.label}</p>
                    {renderToggle(personalPrefs[setting.key], (v) => updatePersonalPref(setting.key, v))}
                  </div>
                ))}
              </div>
            </div>

            {/* Quotas & Security */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-[#F59E0B]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Quotas</p>
                    <p className="text-xs text-white/50">Resource limits</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'quota_warning_enabled', label: 'Quota Warning' },
                    { key: 'quota_reached_enabled', label: 'Quota Reached' }
                  ].map((setting) => (
                    <div key={setting.key} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded-lg">
                      <p className="text-xs font-light text-white">{setting.label}</p>
                      {renderToggle(personalPrefs[setting.key], (v) => updatePersonalPref(setting.key, v))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-[#EF4444]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Security</p>
                    <p className="text-xs text-white/50">Account security</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'new_ip_login_enabled', label: 'New IP Login' },
                    { key: 'account_disabled_enabled', label: 'Account Disabled' }
                  ].map((setting) => (
                    <div key={setting.key} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded-lg">
                      <p className="text-xs font-light text-white">{setting.label}</p>
                      {renderToggle(personalPrefs[setting.key], (v) => updatePersonalPref(setting.key, v))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Teams Tab */}
        {activeTab === 'teams' && (
          <div className="space-y-4">
            {teams.length === 0 ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-6 text-center">
                <Users className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-sm text-white/60 font-light">No teams available</p>
                <p className="text-xs text-white/40 mt-1">Create a team to configure team notifications</p>
              </div>
            ) : (
              <>
                {/* Team Selector */}
                <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                        <Users className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="text-sm font-light text-white">Select Team</p>
                        <p className="text-xs text-white/50">Choose which team to configure</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleTestTeam}
                        disabled={testing || !selectedTeam?.notificationSettings?.notifications_enabled}
                        className="btn-secondary text-xs flex items-center gap-2"
                      >
                        {testing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
                        Test
                      </button>
                      <button onClick={handleSaveTeam} disabled={saving} className="btn-primary text-xs flex items-center gap-2">
                        {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                      </button>
                    </div>
                  </div>
                  <Combobox
                    value={selectedTeam?.id ? selectedTeam.id.toString() : ''}
                    onValueChange={(selectedValue) =>
                      setSelectedTeam(teams.find((t) => t.id === parseInt(selectedValue, 10)) || null)
                    }
                    options={teams.map((team) => ({
                      value: team.id.toString(),
                      label: `${team.name} (${team.member_count || 0} members)`,
                    }))}
                    placeholder="Select team..."
                    searchPlaceholder="Search team..."
                    emptyText="No team found."
                    triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                    contentClassName="max-h-72"
                  />
                </div>

                {selectedTeam && (
                  <>
                    {/* Team Webhook Config */}
                    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-[#22D3EE]/10 border border-[#22D3EE]/30 flex items-center justify-center">
                          <Bell className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                        </div>
                        <div>
                          <p className="text-sm font-light text-white">Team Webhook</p>
                          <p className="text-xs text-white/50">Configure Discord webhook for team events</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-xs font-light text-white">Enable Notifications</p>
                            <p className="text-xs text-white/40">Send team activity to webhook</p>
                          </div>
                          {renderToggle(
                            selectedTeam.notificationSettings?.notifications_enabled ?? false,
                            (v) => updateTeamPref('notifications_enabled', v)
                          )}
                        </div>
                        <div>
                          <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Discord Webhook URL</label>
                          <input
                            type="text"
                            value={selectedTeam.notificationSettings?.discord_webhook_url || ''}
                            onChange={(e) => updateTeamPref('discord_webhook_url', e.target.value)}
                            className="input-futuristic text-xs"
                            placeholder="https://discord.com/api/webhooks/..."
                          />
                        </div>
                      </div>
                    </div>

                    {/* Team Activity */}
                    <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center">
                          <Users className="w-5 h-5 text-[#10B981]" strokeWidth={1.5} />
                        </div>
                        <div>
                          <p className="text-sm font-light text-white">Team Activity</p>
                          <p className="text-xs text-white/50">Member and domain events</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          { key: 'notify_domain_added', label: 'Domain Added', defaultValue: true },
                          { key: 'notify_domain_removed', label: 'Domain Removed', defaultValue: true },
                          { key: 'notify_member_joined', label: 'Member Joined', defaultValue: true },
                          { key: 'notify_member_removed', label: 'Member Removed', defaultValue: true }
                        ].map((setting) => (
                          <div key={setting.key} className="flex items-center justify-between py-2 px-3 bg-white/[0.02] rounded-lg">
                            <p className="text-xs font-light text-white">{setting.label}</p>
                            {renderToggle(
                              selectedTeam.notificationSettings?.[setting.key] ?? setting.defaultValue,
                              (v) => updateTeamPref(setting.key, v)
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
