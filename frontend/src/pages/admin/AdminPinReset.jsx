import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2, Shield } from 'lucide-react';
import { authAPI } from '../../api/client';

export default function AdminPinReset() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleRequest = async () => {
    try {
      setLoading(true);
      setError('');
      setInfo('');
      const response = await authAPI.requestAdminPinReset();
      setInfo(response.data?.message || 'Reset link sent by email.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to request admin PIN reset.');
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
      if (!/^\d{4}$/.test(pin)) {
        setError('PIN must be exactly 4 digits.');
        return;
      }
      if (pin !== confirmPin) {
        setError('PIN values do not match.');
        return;
      }

      setLoading(true);
      setError('');
      setInfo('');
      const response = await authAPI.confirmAdminPinReset(token, pin);
      setInfo(response.data?.message || 'Admin PIN reset successful.');
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to confirm admin PIN reset.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-admin-theme className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-admin-text mb-2">Reset Admin PIN</h1>
        <p className="text-admin-text-muted">
          {token
            ? 'Choose a new 4-digit admin PIN.'
            : 'Request a reset link sent to your admin email.'}
        </p>
      </div>

      <div className="rounded-xl border border-admin-border bg-admin-surface p-6 space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="rounded-md border border-admin-border bg-admin-bg p-3 text-xs text-admin-text">
            {info}
          </div>
        )}

        {!token ? (
          <>
            <div className="flex items-center gap-2 text-admin-text-muted text-sm">
              <Shield className="w-4 h-4" />
              Secure email link required
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate('/login')} className="btn-secondary flex-1" disabled={loading}>
                Back
              </button>
              <button type="button" onClick={handleRequest} className="btn-primary flex-1" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Send reset link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm text-admin-text">New 4-digit PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="input-futuristic"
                placeholder="1234"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-admin-text">Confirm PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="input-futuristic"
                placeholder="1234"
                disabled={loading}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate('/login')} className="btn-secondary flex-1" disabled={loading}>
                Sign in
              </button>
              <button type="button" onClick={handleConfirm} className="btn-primary flex-1" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Confirm reset'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
