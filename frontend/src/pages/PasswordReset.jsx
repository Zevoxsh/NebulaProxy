import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { authAPI } from '../api/client';
import { useBrandingStore } from '../store/brandingStore';

export default function PasswordReset() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appName = useBrandingStore((s) => s.appName);
  const token = (searchParams.get('token') || '').trim();
  const [identifier, setIdentifier] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleRequest = async () => {
    try {
      if (!identifier.trim()) {
        setError('Username or email is required.');
        return;
      }
      setLoading(true);
      setError('');
      setMessage('');
      const response = await authAPI.requestPasswordReset(identifier.trim());
      setMessage(response.data?.message || 'If the account exists and is eligible, a reset link has been sent.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to request password reset.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    try {
      if (!token) {
        setError('Reset link is missing or invalid.');
        return;
      }
      if (!newPassword || newPassword.length < 8) {
        setError('New password must be at least 8 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      setLoading(true);
      setError('');
      setMessage('');
      const response = await authAPI.confirmPasswordReset({
        token,
        newPassword
      });
      setMessage(response.data?.message || 'Password reset successful. You can now sign in.');
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white">
      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="flex items-center justify-center p-6 md:p-10">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70">
                <img src="/nebula.svg" alt={appName} className="h-3.5 w-3.5" />
                {appName}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Reset Password</h1>
              <p className="text-sm text-white/60">
                {token ? 'Choose a new password for your account.' : 'Request a reset link by email.'}
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {message && (
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-white/80">
                {message}
              </div>
            )}

            {!token ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-white/80">Username or Email</label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-futuristic"
                    placeholder="username or email"
                    disabled={loading}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => navigate('/login')} className="btn-secondary flex-1" disabled={loading}>
                    Back
                  </button>
                  <button type="button" onClick={handleRequest} className="btn-primary flex-1" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Send reset link'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-white/80">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-futuristic"
                    placeholder="Minimum 8 characters"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-white/80">Confirm password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-futuristic"
                    placeholder="Repeat new password"
                    disabled={loading}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => navigate('/login')} className="btn-secondary flex-1" disabled={loading}>
                    Sign in
                  </button>
                  <button type="button" onClick={handleConfirm} className="btn-primary flex-1" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Reset password'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="relative hidden lg:block border-l border-white/10 bg-[#0f1014] overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,0.09),transparent_42%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.05),transparent_35%),linear-gradient(160deg,#0f1014_0%,#11131a_55%,#0b0c11_100%)]" />
        </div>
      </div>
    </div>
  );
}
