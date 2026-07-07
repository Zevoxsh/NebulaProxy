import { useEffect, useState } from 'react';
import { Save, Loader, Check, AlertCircle } from 'lucide-react';
import { userAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { getAvatarUrl } from '../utils/gravatar';
import AccountNav from '../components/features/AccountNav';

export default function Profile() {
  const { user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ displayName: '', email: '', avatarUrl: '' });

  useEffect(() => {
    (async () => {
      try {
        const res = await userAPI.getMe();
        const profile = res.data.user || {};
        setForm({
          displayName: profile.displayName || '',
          email: profile.email || '',
          avatarUrl: profile.avatarUrl || ''
        });
      } catch {
        setError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await userAPI.updateProfile(form);
      updateUser(res.data.user);
      setSuccess('Profile updated.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <Loader className="w-5 h-5 text-white/40 animate-spin" />
      </div>
    );
  }

  const initials = (form.displayName || user?.username || '?').trim().charAt(0).toUpperCase();
  const avatarSrc = getAvatarUrl(form.avatarUrl, form.email, 200, user?.avatarUpdatedAt);

  return (
    <div className="pb-12 animate-fade-in">
      {/* Hero */}
      <div className="relative mb-16">
        <div className="h-32 rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.06] relative">
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
          <div className="w-24 h-24 rounded-full ring-4 ring-admin-bg bg-zinc-800 border border-white/[0.08] overflow-hidden flex items-center justify-center">
            {avatarSrc
              ? <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
              : <span className="text-2xl font-semibold text-white">{initials}</span>
            }
          </div>
        </div>
      </div>

      {/* Identity */}
      <div className="text-center mt-4">
        <h1 className="text-2xl font-semibold text-white">{form.displayName || user?.username}</h1>
        <p className="text-sm text-white/40 mt-1">
          @{user?.username}
          {user?.role && <> · <span className="capitalize">{user.role}</span></>}
        </p>

        <div className="flex items-center justify-center mt-4">
          <AccountNav current="profile" />
        </div>
      </div>

      {(error || success) && (
        <div className={`mt-8 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${
          error
            ? 'bg-red-500/10 border-red-500/25 text-red-300'
            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
        }`}>
          {error ? <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} /> : <Check className="w-4 h-4 shrink-0" strokeWidth={1.5} />}
          {error || success}
        </div>
      )}

      <div className="h-px bg-white/10 my-8" />

      {/* Form */}
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] sm:items-center gap-1.5 sm:gap-4">
          <label className="text-sm text-white/50">Nom affiché</label>
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="input-futuristic text-sm"
            placeholder="Your name"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] sm:items-center gap-1.5 sm:gap-4">
          <label className="text-sm text-white/50">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="input-futuristic text-sm"
            placeholder="you@example.com"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] sm:items-center gap-1.5 sm:gap-4">
          <label className="text-sm text-white/50">Avatar URL</label>
          <input
            type="url"
            value={form.avatarUrl}
            onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
            className="input-futuristic text-sm"
            placeholder="Leave empty to use Gravatar"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2">
            {saving
              ? <><Loader className="w-4 h-4 animate-spin" strokeWidth={1.5} /> Saving…</>
              : <><Save className="w-4 h-4" strokeWidth={1.5} /> Save changes</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
