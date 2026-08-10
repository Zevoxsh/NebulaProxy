import { useState } from 'react';
import { User, Mail, Save, AlertCircle } from 'lucide-react';
import { userAPI } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useBrandingStore } from '../../store/brandingStore';

export default function CompleteProfileModal() {
  const { user, updateUser } = useAuthStore();
  const appName = useBrandingStore((s) => s.appName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    displayName: user?.displayName || '',
    email: user?.email || ''
  });

  const isComplete = form.displayName.trim() && form.email.trim();

  const handleSave = async () => {
    if (!isComplete) {
      setError('Please fill in both display name and email');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const response = await userAPI.updateProfile({
        displayName: form.displayName,
        email: form.email,
        avatarUrl: user?.avatarUrl || ''
      });
      updateUser(response.data.user);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1a1b2e] border border-white/10 rounded-xl p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 rounded-lg">
            <AlertCircle className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">Complete Your Profile</h3>
            <p className="text-xs text-white/50">Required before continuing</p>
          </div>
        </div>

        {/* Info Message */}
        <div className="bg-[#9D4EDD]/10 border border-[#9D4EDD]/20 rounded-lg p-3 mb-5">
          <p className="text-xs text-white/70 leading-relaxed">
            Please provide your display name and email address to continue using {appName}. These are required for notifications and account management.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg p-3 mb-4">
            <p className="text-xs text-[#F87171]">{error}</p>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">
              Display Name *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="input-futuristic pl-10 text-xs"
                placeholder="Your name"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">
              Email Address *
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input-futuristic pl-10 text-xs"
                placeholder="you@company.com"
                disabled={saving}
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={!isComplete || saving}
          className="btn-primary w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5"
        >
          <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          {saving ? 'Saving...' : 'Save and Continue'}
        </button>

        {/* Footer Note */}
        <p className="text-xs text-white/30 text-center mt-4">
          You cannot use the application until your profile is complete
        </p>
      </div>
    </div>
  );
}
