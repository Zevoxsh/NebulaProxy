import { useEffect, useMemo, useState } from 'react';
import { Camera, Save, User, Mail, BadgeCheck } from 'lucide-react';
import { userAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { getAvatarUrl } from '../utils/gravatar';

export default function Profile() {
  const { user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    avatarUrl: ''
  });

  const initials = useMemo(() => {
    const source = form.displayName || user?.displayName || user?.username || '';
    return source.trim().charAt(0).toUpperCase() || 'U';
  }, [form.displayName, user?.displayName, user?.username]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const response = await userAPI.getMe();
      const profile = response.data.user || {};
      setForm({
        displayName: profile.displayName || '',
        email: profile.email || '',
        avatarUrl: profile.avatarUrl || ''
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const response = await userAPI.updateProfile({
        displayName: form.displayName,
        email: form.email,
        avatarUrl: form.avatarUrl
      });
      updateUser(response.data.user);
      setSuccess('Profile updated successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in">
            <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Profile</h1>
            <p className="text-xs text-white/50 font-light tracking-wide">Manage your personal information</p>
          </div>
        </div>
      </div>

      <div className="page-body">

        {success && (
          <div className="mb-4 bg-[#10B981]/10 backdrop-blur-xl border border-[#10B981]/20 rounded-xl p-3">
            <p className="text-xs text-[#34D399]">{success}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-[#EF4444]/10 backdrop-blur-xl border border-[#EF4444]/20 rounded-xl p-3">
            <p className="text-xs text-[#F87171]">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                <Camera className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-light text-white">Profile Photo</p>
                <p className="text-xs text-white/60 font-light">Use a custom URL or Gravatar from your email</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center overflow-hidden shadow-glow-sm">
                {getAvatarUrl(form.avatarUrl, form.email, 160, user?.avatarUpdatedAt) ? (
                  <img src={getAvatarUrl(form.avatarUrl, form.email, 160, user?.avatarUpdatedAt)} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-light text-white">{initials}</span>
                )}
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium uppercase tracking-wider text-white/60 mb-2">Avatar URL</label>
                <input
                  type="url"
                  value={form.avatarUrl}
                  onChange={(e) => handleChange('avatarUrl', e.target.value)}
                  className="input-futuristic text-xs"
                  placeholder="https://example.com/avatar.png"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#22D3EE]/10 border border-[#22D3EE]/30 flex items-center justify-center">
                <BadgeCheck className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-light text-white">Account Details</p>
                <p className="text-xs text-white/60 font-light">Keep your info up to date</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-white/60 mb-2">
                  Display Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => handleChange('displayName', e.target.value)}
                    className="input-futuristic pl-10 text-xs"
                    placeholder="Your name"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-white/60 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    className="input-futuristic pl-10 text-xs"
                    placeholder="you@company.com"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="text-xs text-white/60 font-light">
                Signed in as <span className="text-white/70">{user?.username}</span>
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2 text-xs px-4 py-2.5"
              >
                <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
