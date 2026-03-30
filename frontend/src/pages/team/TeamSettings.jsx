import { useState, useEffect } from 'react';
import { Trash2, Upload, Image as ImageIcon, RefreshCw, Bell, Settings as SettingsIcon } from 'lucide-react';
import { teamAPI } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { Switch } from '@/components/ui/switch';

export default function TeamSettings({ team, refreshTeam, setError, setSuccess, navigate }) {
  const { user } = useAuthStore();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [teamNotifications, setTeamNotifications] = useState({ notificationsEnabled: false, emailEnabled: false });
  const [teamNotificationSaving, setTeamNotificationSaving] = useState(false);

  const canManageSettings = team.user_permissions?.can_manage_settings
    ?? (team.user_role === 'owner' || Boolean(team.members?.find(m => String(m.user_id) === String(user?.id))?.can_manage_settings));

  useEffect(() => {
    if (canManageSettings) {
      fetchNotificationSettings();
    }
  }, [team.id, canManageSettings]);

  const fetchNotificationSettings = async () => {
    try {
      const response = await teamAPI.getNotificationSettings(team.id);
      const settings = response.data.settings || {};
      setTeamNotifications({
        notificationsEnabled: Boolean(settings.notificationsEnabled),
        emailEnabled: Boolean(settings.emailEnabled)
      });
    } catch (err) {
      setTeamNotifications({ notificationsEnabled: false, emailEnabled: false });
    }
  };

  const handleUploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('File too large. Maximum size is 5MB');
      return;
    }

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed');
      return;
    }

    try {
      setUploadingLogo(true);
      setError('');

      const formData = new FormData();
      formData.append('file', file);

      await teamAPI.uploadLogo(team.id, formData);
      setSuccess('Logo uploaded successfully');
      await refreshTeam();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleDeleteLogo = async () => {
    if (!confirm('Delete team logo?')) return;

    try {
      setUploadingLogo(true);
      setError('');

      await teamAPI.deleteLogo(team.id);
      setSuccess('Logo deleted successfully');
      await refreshTeam();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveTeamNotifications = async () => {
    try {
      setTeamNotificationSaving(true);
      setError('');
      setSuccess('');
      const response = await teamAPI.updateNotificationSettings(team.id, {
        ...teamNotifications
      });
      const settings = response.data.settings || {};
      setTeamNotifications({
        notificationsEnabled: Boolean(settings.notificationsEnabled),
        emailEnabled: Boolean(settings.emailEnabled)
      });
      setSuccess('Team notifications updated successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update team notifications');
    } finally {
      setTeamNotificationSaving(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!confirm('Delete this team? All team domains will become personal domains.')) return;

    try {
      await teamAPI.delete(team.id);
      setSuccess('Team deleted successfully');
      navigate('/teams');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete team');
    }
  };

  if (!canManageSettings) {
    return (
      <div className="animate-fade-in">
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 text-center">
          <p className="text-white/40">You don't have permission to manage team settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* Team Logo */}
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-normal text-white">Team Logo</h3>
            <p className="text-[10px] text-white/40">Max 5MB (JPEG, PNG, GIF, WebP)</p>
          </div>
          <ImageIcon className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
        </div>

        <div className="space-y-2.5">
          {team.logo_url && (
            <div className="flex items-center justify-between p-2.5 bg-[#1A1B28]/40 border border-white/[0.08] rounded-lg">
              <div className="flex items-center gap-2.5">
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/[0.05] flex items-center justify-center">
                  <img
                    src={`${team.logo_url}${team.logo_updated_at ? `?t=${new Date(team.logo_updated_at).getTime()}` : ''}`}
                    alt="Team logo"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <p className="text-xs font-normal text-white">Current Logo</p>
                  <p className="text-[10px] text-white/40">Click delete to remove</p>
                </div>
              </div>
              <button
                onClick={handleDeleteLogo}
                disabled={uploadingLogo}
                className="p-1.5 text-white/60 hover:text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all duration-300"
                title="Delete logo"
              >
                <Trash2 className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}

          <label className={`flex items-center justify-center gap-2 p-3 bg-[#1A1B28]/40 border border-white/[0.08] rounded-lg hover:bg-[#1A1B28]/60 hover:border-[#9D4EDD]/30 transition-all duration-300 cursor-pointer ${uploadingLogo ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleUploadLogo}
              disabled={uploadingLogo}
              className="hidden"
            />
            {uploadingLogo ? (
              <>
                <RefreshCw className="w-4 h-4 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
                <span className="text-xs text-white/70">Uploading...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                <span className="text-xs text-white/70">{team.logo_url ? 'Replace Logo' : 'Upload Logo'}</span>
              </>
            )}
          </label>
        </div>
      </div>

      {/* Team Notifications */}
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-normal text-white">Team Notifications</h3>
            <p className="text-[10px] text-white/40">Team domains only</p>
          </div>
          <Bell className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-[#1A1B28]/40 border border-white/[0.08] rounded-lg">
            <div>
              <h4 className="text-xs font-normal text-white">Enable alerts</h4>
              <p className="text-[10px] text-white/40">Up/down status</p>
            </div>
            <Switch
              checked={teamNotifications.notificationsEnabled}
              onCheckedChange={(checked) => setTeamNotifications({ ...teamNotifications, notificationsEnabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-[#1A1B28]/40 border border-white/[0.08] rounded-lg">
            <div>
              <h4 className="text-xs font-normal text-white">Enable email alerts</h4>
              <p className="text-[10px] text-white/40">Sent to team members with email set</p>
            </div>
            <Switch
              checked={teamNotifications.emailEnabled}
              onCheckedChange={(checked) => setTeamNotifications({ ...teamNotifications, emailEnabled: checked })}
            />
          </div>

          <div className="flex">
            <button
              onClick={handleSaveTeamNotifications}
              disabled={teamNotificationSaving}
              className="btn-primary w-full flex items-center justify-center gap-1.5 text-xs py-2"
            >
              {teamNotificationSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                  Saving...
                </>
              ) : (
                <>
                  <SettingsIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Save Settings
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      {team.user_role === 'owner' && (
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4">
          <div className="mb-3">
            <h3 className="text-sm font-normal text-white">Danger Zone</h3>
            <p className="text-[10px] text-white/40">Irreversible actions</p>
          </div>

          <button
            onClick={handleDeleteTeam}
            className="w-full btn-secondary text-[#F87171] hover:bg-[#EF4444]/10 border-[#EF4444]/20 hover:border-[#EF4444]/30 flex items-center justify-center gap-2 text-xs px-4 py-2"
          >
            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
            Delete Team
          </button>
        </div>
      )}
    </div>
  );
}
