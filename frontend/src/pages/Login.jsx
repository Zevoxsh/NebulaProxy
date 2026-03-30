import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, KeyRound, Sparkles, Lock } from 'lucide-react';
import { authAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useBrandingStore } from '../store/brandingStore';
import { startAuthentication } from '@simplewebauthn/browser';

export default function Login() {
  const navigate = useNavigate();
  const setUser = useAuthStore((state) => state.setUser);
  const appName = useBrandingStore((s) => s.appName);

  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState('enterprise');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [twoFactorStep, setTwoFactorStep] = useState(false);
  const [pendingToken, setPendingToken] = useState('');
  const [twoFactorMethods, setTwoFactorMethods] = useState([]);
  const [selectedTwoFactorMethod, setSelectedTwoFactorMethod] = useState('');
  const [twoFactorEmail, setTwoFactorEmail] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [bootstrapChangeStep, setBootstrapChangeStep] = useState(false);
  const [bootstrapNewPassword, setBootstrapNewPassword] = useState('');
  const [bootstrapConfirmPassword, setBootstrapConfirmPassword] = useState('');

  useEffect(() => {
    let isMounted = true;
    authAPI.getMode()
      .then((response) => {
        if (isMounted) {
          const mode = response.data?.authType === 'local' ? 'local' : 'enterprise';
          setAuthMode(mode);
          setRegistrationEnabled(Boolean(response.data?.registrationEnabled));
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const tryAutoPasskey = async () => {
      if (!window.isSecureContext || !window.PublicKeyCredential) return;
      if (typeof window.PublicKeyCredential.isConditionalMediationAvailable !== 'function') return;
      try {
        const available = await window.PublicKeyCredential.isConditionalMediationAvailable();
        if (!available) return;
        await handlePasskeyLogin(true);
      } catch {
        // Silent fail for auto-passkey probe
      }
    };
    tryAutoPasskey();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (bootstrapChangeStep) {
        if (!bootstrapNewPassword || bootstrapNewPassword.length < 8) {
          setError('New password must be at least 8 characters.');
          return;
        }
        if (bootstrapNewPassword !== bootstrapConfirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        const response = await authAPI.changeBootstrapPassword(bootstrapNewPassword);
        const { user } = response.data;
        setUser(user);
        navigate('/dashboard');
        return;
      }

      if (twoFactorStep) {
        const response = await authAPI.verify2fa({
          pendingToken,
          method: selectedTwoFactorMethod,
          code: twoFactorCode
        });
        if (response.data?.mustChangePassword) {
          setBootstrapChangeStep(true);
          setTwoFactorStep(false);
          setBootstrapNewPassword('');
          setBootstrapConfirmPassword('');
          return;
        }
        const { user } = response.data;
        setUser(user);
        navigate('/dashboard');
        return;
      }

      const response = await authAPI.login(formData);
      if (response.data?.mustChangePassword) {
        setBootstrapChangeStep(true);
        setBootstrapNewPassword('');
        setBootstrapConfirmPassword('');
        return;
      }
      if (response.data?.requires2fa) {
        const methods = Array.isArray(response.data.methods) ? response.data.methods : [];
        const preferredMethod = response.data.defaultMethod || (methods.includes('totp') ? 'totp' : methods[0] || '');
        setTwoFactorStep(true);
        setPendingToken(response.data.pendingToken || '');
        setTwoFactorMethods(methods);
        setSelectedTwoFactorMethod(preferredMethod);
        setTwoFactorEmail(response.data.email || '');
        setTwoFactorCode('');
        setEmailCodeSent(false);
        if (preferredMethod === 'email' && response.data.pendingToken) {
          await authAPI.request2faChallenge({ pendingToken: response.data.pendingToken, method: 'email' });
          setEmailCodeSent(true);
        }
        return;
      }

      const { user } = response.data;
      setUser(user);
      navigate('/dashboard');
    } catch (err) {
      setError(
        err.response?.data?.message ||
        'Authentication failed. Please check your credentials.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const resetTwoFactorStep = () => {
    setTwoFactorStep(false);
    setPendingToken('');
    setTwoFactorMethods([]);
    setSelectedTwoFactorMethod('');
    setTwoFactorEmail('');
    setTwoFactorCode('');
    setEmailCodeSent(false);
    setError('');
  };

  const handleSelectMethod = async (method) => {
    if (method === selectedTwoFactorMethod) return;
    setSelectedTwoFactorMethod(method);
    setTwoFactorCode('');
    setError('');
    if (method === 'email' && pendingToken) {
      try {
        setLoading(true);
        await authAPI.request2faChallenge({ pendingToken, method: 'email' });
        setEmailCodeSent(true);
      } catch (err) {
        setError(err.response?.data?.message || 'Unable to send email code.');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSendEmailCode = async () => {
    try {
      setLoading(true);
      setError('');
      await authAPI.request2faChallenge({ pendingToken, method: 'email' });
      setEmailCodeSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send email code.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async (auto = false) => {
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential) {
        if (!auto) setError('Passkey login requires HTTPS and a supported browser/device.');
        return;
      }

      if (!auto) {
        setPasskeyLoading(true);
      }
      if (!auto) setError('');
      const optionsRes = await authAPI.getPasskeyOptions({
        username: auto ? undefined : (formData.username || undefined)
      });
      const assertion = await startAuthentication({
        optionsJSON: optionsRes.data.options,
        useBrowserAutofill: auto
      });
      const verifyRes = await authAPI.verifyPasskeyLogin({ response: assertion });
      const { user } = verifyRes.data;
      setUser(user);
      navigate('/dashboard');
    } catch (err) {
      if (auto) return;
      setError(err.response?.data?.message || err.message || 'Passkey sign-in failed.');
    } finally {
      if (!auto) {
        setPasskeyLoading(false);
      }
    }
  };

  const openResetFlow = () => {
    navigate('/reset-password');
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
              <h1 className="text-2xl font-semibold tracking-tight">
                {bootstrapChangeStep
                  ? 'Change default password'
                  : (twoFactorStep ? 'Verify your identity' : 'Sign in to your account')}
              </h1>
              <p className="text-sm text-white/60">
                {bootstrapChangeStep
                  ? 'You signed in with bootstrap credentials. Set a new admin password now.'
                  : twoFactorStep
                  ? 'Choose your 2FA method and enter the verification code.'
                  : authMode === 'local'
                    ? 'Local authentication is enabled.'
                    : 'LDAP/Enterprise authentication is enabled.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {!twoFactorStep && !bootstrapChangeStep ? (
                <>
                  <div className="space-y-2">
                    <label htmlFor="username" className="text-sm text-white/80">Username</label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      required
                      autoComplete="username webauthn"
                      value={formData.username}
                      onChange={handleChange}
                      placeholder="username"
                      disabled={loading}
                      className="input-futuristic"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="password" className="text-sm text-white/80">Password</label>
                      {authMode === 'local' && (
                        <button
                          type="button"
                          onClick={openResetFlow}
                          className="text-xs text-white/60 hover:text-white"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Your password"
                      disabled={loading}
                      className="input-futuristic"
                    />
                  </div>
                </>
              ) : twoFactorStep ? (
                <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start gap-2">
                    <Lock className="w-4 h-4 text-white/70 mt-0.5" />
                    <div className="text-xs text-white/70">
                      {selectedTwoFactorMethod === 'email'
                        ? `Enter the code sent to ${twoFactorEmail || 'your email address'}.`
                        : 'Enter the 6-digit code from your authenticator app.'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {twoFactorMethods.includes('totp') && (
                      <button
                        type="button"
                        onClick={() => handleSelectMethod('totp')}
                        className={`px-3 py-1.5 text-xs rounded-md border ${
                          selectedTwoFactorMethod === 'totp'
                            ? 'bg-white text-black border-white'
                            : 'border-white/20 text-white/70 hover:text-white'
                        }`}
                      >
                        TOTP
                      </button>
                    )}
                    {twoFactorMethods.includes('email') && (
                      <button
                        type="button"
                        onClick={() => handleSelectMethod('email')}
                        className={`px-3 py-1.5 text-xs rounded-md border ${
                          selectedTwoFactorMethod === 'email'
                            ? 'bg-white text-black border-white'
                            : 'border-white/20 text-white/70 hover:text-white'
                        }`}
                      >
                        Email
                      </button>
                    )}
                  </div>
                  {selectedTwoFactorMethod === 'email' && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/50">{emailCodeSent ? 'Code sent by email.' : 'No code sent yet.'}</span>
                      <button type="button" onClick={handleSendEmailCode} disabled={loading} className="text-white/70 hover:text-white">
                        {emailCodeSent ? 'Resend' : 'Send code'}
                      </button>
                    </div>
                  )}
                  <input
                    id="twoFactorCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={twoFactorCode}
                    onChange={(e) => {
                      setTwoFactorCode(e.target.value);
                      setError('');
                    }}
                    placeholder="123456"
                    disabled={loading}
                    className="input-futuristic"
                  />
                  <button type="button" onClick={resetTwoFactorStep} disabled={loading} className="text-xs text-white/60 hover:text-white">
                    Back to credentials
                  </button>
                </div>
              ) : (
                <div className="space-y-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-4">
                  <div className="text-xs text-amber-200">
                    Remote bootstrap access is allowed, but you must replace the default password before continuing.
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={bootstrapNewPassword}
                    onChange={(e) => {
                      setBootstrapNewPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="New admin password"
                    disabled={loading}
                    className="input-futuristic"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={bootstrapConfirmPassword}
                    onChange={(e) => {
                      setBootstrapConfirmPassword(e.target.value);
                      setError('');
                    }}
                    placeholder="Confirm new password"
                    disabled={loading}
                    className="input-futuristic"
                  />
                </div>
              )}

              {!twoFactorStep && !bootstrapChangeStep && (
                <button
                  type="button"
                  disabled={loading || passkeyLoading}
                  onClick={() => handlePasskeyLogin(false)}
                  className="btn-secondary w-full"
                >
                  <span className="flex items-center justify-center gap-2">
                    <KeyRound className="w-4 h-4" />
                    {passkeyLoading ? 'Checking passkey...' : 'Sign in with passkey'}
                  </span>
                </button>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                  <span className="flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {loading
                    ? (bootstrapChangeStep ? 'Updating password...' : (twoFactorStep ? 'Verifying...' : 'Authenticating...'))
                    : (bootstrapChangeStep ? 'Update password' : (twoFactorStep ? 'Verify code' : 'Sign in'))}
                </span>
              </button>
            </form>

            <div className="text-center text-xs text-white/50 space-y-2">
              {authMode === 'local' ? (
                <>
                  <p>Local account authentication</p>
                  {registrationEnabled && (
                    <button type="button" onClick={() => navigate('/register')} className="underline hover:text-white">
                      Create a local account
                    </button>
                  )}
                </>
              ) : (
                <p>Secured with Active Directory / Enterprise authentication</p>
              )}
            </div>
          </div>
        </div>

        <div className="relative hidden lg:block border-l border-white/10 bg-[#0f1014] overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,0.09),transparent_42%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.05),transparent_35%),linear-gradient(160deg,#0f1014_0%,#11131a_55%,#0b0c11_100%)]" />
          <div className="absolute top-20 -left-28 h-80 w-80 rounded-full border border-white/10" />
          <div className="absolute -bottom-24 right-8 h-72 w-72 rounded-full border border-white/10" />
          <div className="relative z-10 flex h-full items-center justify-center p-10">
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/30 p-8 backdrop-blur-sm">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/5">
                  <img src="/nebula.svg" alt={appName} className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold tracking-tight">{appName}</p>
                  <p className="text-xs text-white/60 uppercase tracking-[0.18em]">Control Panel</p>
                </div>
              </div>

              <h2 className="text-4xl font-semibold leading-none tracking-tight mb-5">
                NEBULA
              </h2>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  Passkey Ready
                </div>
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  2FA Enabled
                </div>
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  {authMode === 'local' ? 'Local Auth' : 'LDAP / Enterprise'}
                </div>
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  Admin Security
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
