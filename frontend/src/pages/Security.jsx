import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Mail, Key, Loader, AlertCircle, Check, Lock, Smartphone, Eye, EyeOff, Plus } from 'lucide-react';
import { userAPI, authAPI } from '../api/client';
import { startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import AccountNav from '../components/features/AccountNav';
import { SectionCard, SectionHeader, StatusDot } from '../components/ui/section-card';

export default function Security() {
  const location = useLocation();
  const focusPasskey = new URLSearchParams(location.search).get('focus') === 'passkey';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [email, setEmail] = useState('');

  const [twoFactor, setTwoFactor] = useState({ enabled: false, method: null, methods: [], hasEmail: false, email2faReady: false });
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailSetupStarted, setEmailSetupStarted] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableCodeSent, setDisableCodeSent] = useState(false);
  const [disableMethod, setDisableMethod] = useState('totp');
  const [showDisable, setShowDisable] = useState(false);

  const [passkeyStatus, setPasskeyStatus] = useState({ hasPasskey: false, passkeyCount: 0 });
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (totpSetup?.otpauthUrl) {
      QRCode.toDataURL(totpSetup.otpauthUrl, { width: 180, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
        .then(setQrDataUrl).catch(() => setQrDataUrl(''));
    } else {
      setQrDataUrl('');
    }
  }, [totpSetup?.otpauthUrl]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [profileRes, twoFactorRes, passkeyPromptRes, passkeysRes] = await Promise.all([
        userAPI.getMe(), authAPI.get2faStatus(), userAPI.getPasskeyPromptStatus(), userAPI.listPasskeys()
      ]);
      const profile = profileRes.data.user || {};
      setEmail(profile.email || '');
      const nextTwoFactor = twoFactorRes.data?.twoFactor || { enabled: false, method: null, methods: [], hasEmail: Boolean(profile.email), email2faReady: false };
      setTwoFactor(nextTwoFactor);
      if (nextTwoFactor.methods?.includes('totp')) setDisableMethod('totp');
      else if (nextTwoFactor.methods?.includes('email')) setDisableMethod('email');
      setPasskeyStatus({ hasPasskey: Boolean(passkeyPromptRes.data?.hasPasskey), passkeyCount: Number(passkeyPromptRes.data?.passkeyCount || 0) });
      setPasskeys(passkeysRes.data?.passkeys || []);
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const refreshTwoFactorStatus = async () => {
    const response = await authAPI.get2faStatus();
    const nextTwoFactor = response.data?.twoFactor || { enabled: false, method: null, methods: [], hasEmail: false, email2faReady: false };
    setTwoFactor(nextTwoFactor);
    if (nextTwoFactor.methods?.includes('totp')) setDisableMethod('totp');
    else if (nextTwoFactor.methods?.includes('email')) setDisableMethod('email');
  };

  const handleInitTotp = async () => {
    try {
      setTwoFactorLoading(true); setError(''); setSuccess('');
      const response = await authAPI.initTotp2fa();
      setTotpSetup(response.data?.setup || null);
      setTotpCode('');
    } catch (err) { setError(err.response?.data?.message || 'Could not start setup'); }
    finally { setTwoFactorLoading(false); }
  };

  const handleEnableTotp = async () => {
    try {
      if (!totpSetup?.secret || !totpCode) { setError('Enter the 6-digit code from your app.'); return; }
      setTwoFactorLoading(true); setError(''); setSuccess('');
      await authAPI.enableTotp2fa({ secret: totpSetup.secret, code: totpCode });
      setTotpSetup(null); setTotpCode(''); setEmailSetupStarted(false); setEmailCode(''); setDisableCode(''); setDisableCodeSent(false);
      await refreshTwoFactorStatus();
      setSuccess('Authentication app is now active.');
    } catch (err) { setError(err.response?.data?.message || 'Incorrect code — try again.'); }
    finally { setTwoFactorLoading(false); }
  };

  const handleInitEmail2fa = async () => {
    try {
      setTwoFactorLoading(true); setError(''); setSuccess('');
      await authAPI.initEmail2fa();
      setEmailSetupStarted(true); setEmailCode('');
    } catch (err) { setError(err.response?.data?.message || 'Could not send email'); }
    finally { setTwoFactorLoading(false); }
  };

  const handleVerifyEmail2fa = async () => {
    try {
      if (!emailCode) { setError('Enter the code from your email.'); return; }
      setTwoFactorLoading(true); setError(''); setSuccess('');
      await authAPI.verifyEmail2fa({ code: emailCode });
      setEmailSetupStarted(false); setEmailCode(''); setTotpSetup(null); setTotpCode(''); setDisableCode(''); setDisableCodeSent(false);
      await refreshTwoFactorStatus();
      setSuccess('Email verification is now active.');
    } catch (err) { setError(err.response?.data?.message || 'Incorrect code — try again.'); }
    finally { setTwoFactorLoading(false); }
  };

  const handleSendDisableEmailCode = async () => {
    try {
      setTwoFactorLoading(true); setError(''); setSuccess('');
      const response = await authAPI.initDisableEmail2fa();
      setDisableMethod('email'); setDisableCodeSent(true);
      setSuccess(response.data?.message || 'Code sent to your email.');
    } catch (err) { setError(err.response?.data?.message || 'Could not send code'); }
    finally { setTwoFactorLoading(false); }
  };

  const handleDisable2fa = async () => {
    try {
      if (!disableCode) { setError('Enter the verification code.'); return; }
      setTwoFactorLoading(true); setError(''); setSuccess('');
      await authAPI.disable2fa({ method: disableMethod, code: disableCode });
      setDisableCode(''); setDisableCodeSent(false); setTotpSetup(null); setTotpCode('');
      setEmailSetupStarted(false); setEmailCode(''); setShowDisable(false);
      await refreshTwoFactorStatus();
      setSuccess('Two-step verification has been disabled.');
    } catch (err) { setError(err.response?.data?.message || 'Incorrect code — try again.'); }
    finally { setTwoFactorLoading(false); }
  };

  const refreshPasskeys = async () => {
    const [statusRes, passkeysRes] = await Promise.all([userAPI.getPasskeyPromptStatus(), userAPI.listPasskeys()]);
    setPasskeyStatus({ hasPasskey: Boolean(statusRes.data?.hasPasskey), passkeyCount: Number(statusRes.data?.passkeyCount || 0) });
    setPasskeys(passkeysRes.data?.passkeys || []);
  };

  const handleCreatePasskey = async () => {
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential) {
        setError('Passkeys require HTTPS. Make sure you are on a secure connection.'); return;
      }
      setPasskeyBusy(true); setError(''); setSuccess('');
      const optionsRes = await userAPI.getPasskeyRegistrationOptions();
      const attestationResponse = await startRegistration({ optionsJSON: optionsRes.data.options });
      await userAPI.verifyPasskeyRegistration({ name: passkeyName.trim() || undefined, response: attestationResponse });
      await userAPI.respondPasskeyPrompt('setup_now');
      setPasskeyName('');
      await refreshPasskeys();
      setSuccess('Passkey added successfully.');
    } catch (err) { setError(err.response?.data?.message || err.message || 'Failed to add passkey.'); }
    finally { setPasskeyBusy(false); }
  };

  const handleDeletePasskey = async (id) => {
    try {
      setPasskeyBusy(true); setError(''); setSuccess('');
      await userAPI.deletePasskey(id);
      await refreshPasskeys();
      setSuccess('Passkey removed.');
    } catch (err) { setError(err.response?.data?.message || 'Failed to remove passkey.'); }
    finally { setPasskeyBusy(false); }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <div className="flex items-center gap-3 text-zinc-500 text-sm">
          <Loader className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <h1 className="text-2xl font-semibold text-white tracking-tight">Security</h1>
          <p className="text-sm text-zinc-500 mt-1">Two-step verification and passkeys</p>
          <div className="mt-4">
            <AccountNav current="security" />
          </div>
        </div>
      </div>

      <div className="page-body">
        {success && (
          <div className="mb-5 flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-4 py-3">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-300">{success}</p>
          </div>
        )}
        {error && (
          <div className="mb-5 flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          {/* Two-step verification */}
          <SectionCard>
            <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4 text-white/60" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">Two-step verification</p>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md border ${
                      twoFactor.enabled
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                    }`}>
                      <StatusDot active={twoFactor.enabled} />
                      {twoFactor.enabled ? 'Active' : 'Not configured'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Adds a second check at login. Even with your password, no one can get in without this.
                  </p>
                </div>
              </div>
              {twoFactor.methods?.length > 0 && (
                <button
                  onClick={() => { setShowDisable(!showDisable); setDisableCode(''); setDisableCodeSent(false); }}
                  className="btn-secondary text-xs px-3 py-2 shrink-0"
                >
                  {showDisable ? 'Cancel' : 'Disable'}
                </button>
              )}
            </div>

            {!twoFactor.hasEmail && (
              <div className="mx-5 mt-5 flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-lg px-4 py-3">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-300/80">
                  Add an email address in your <strong className="text-amber-300">Profile</strong> before setting up two-step verification.
                </p>
              </div>
            )}

            <div className="p-5 space-y-3">

              {/* Method: App */}
              <div className={`rounded-xl border p-4 ${totpSetup?.secret ? 'border-white/15 bg-white/[0.02]' : twoFactor.methods?.includes('totp') ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-[#27272a]'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                      <Smartphone className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Authentication app</p>
                      <p className="text-xs text-zinc-500">Get a code from an app on your phone — works without internet.</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {twoFactor.methods?.includes('totp') ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                        <StatusDot active /> Active
                      </span>
                    ) : (
                      <button
                        onClick={handleInitTotp}
                        disabled={twoFactorLoading || !twoFactor.hasEmail}
                        className="btn-primary text-xs px-3 py-2"
                      >
                        {twoFactorLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Set up'}
                      </button>
                    )}
                  </div>
                </div>

                {/* TOTP setup steps */}
                {totpSetup?.secret && (
                  <div className="mt-5 pt-5 border-t border-white/[0.06]">
                    <div className="flex flex-col sm:flex-row gap-6">

                      {/* QR code */}
                      <div className="shrink-0 flex flex-col items-center gap-2">
                        {qrDataUrl
                          ? <img src={qrDataUrl} alt="QR code" className="w-[168px] h-[168px] rounded-lg border-4 border-white block" />
                          : <div className="w-[168px] h-[168px] rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center"><Loader className="w-5 h-5 animate-spin text-zinc-600" /></div>
                        }
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {showSecret ? 'Hide key' : 'Show key manually'}
                        </button>
                        {showSecret && (
                          <div className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-zinc-600 mb-1">Secret key</p>
                            <code className="text-xs text-white font-mono tracking-wider break-all">{totpSetup.secret}</code>
                          </div>
                        )}
                      </div>

                      {/* Steps */}
                      <div className="flex-1 space-y-4">
                        <div className="flex gap-3">
                          <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 font-semibold flex items-center justify-center shrink-0 mt-0.5">1</span>
                          <div>
                            <p className="text-sm font-medium text-white">Download a free app</p>
                            <p className="text-xs text-zinc-500 mt-1">
                              Install one of these on your phone:<br />
                              <span className="text-zinc-400">Google Authenticator, Microsoft Authenticator, or Authy.</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 font-semibold flex items-center justify-center shrink-0 mt-0.5">2</span>
                          <div>
                            <p className="text-sm font-medium text-white">Scan the QR code</p>
                            <p className="text-xs text-zinc-500 mt-1">Open the app, tap <span className="text-zinc-400">+</span> or <span className="text-zinc-400">&quot;Add account&quot;</span>, then point your phone&apos;s camera at the code.</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 font-semibold flex items-center justify-center shrink-0 mt-0.5">3</span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">Enter the 6-digit code</p>
                            <p className="text-xs text-zinc-500 mt-1 mb-3">Type the code shown in the app to confirm it&apos;s working.</p>
                            <div className="flex flex-wrap gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={totpCode}
                                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                                className="input-futuristic text-lg tracking-[0.5em] font-mono text-center w-44"
                                placeholder="000000"
                                autoComplete="one-time-code"
                              />
                              <button
                                onClick={handleEnableTotp}
                                disabled={twoFactorLoading || totpCode.length !== 6}
                                className="btn-primary text-sm px-4"
                              >
                                {twoFactorLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Confirm'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {twoFactor.methods?.includes('totp') && !totpSetup && (
                  <div className="mt-3 pt-3 border-t border-white/[0.04]">
                    <button onClick={handleInitTotp} disabled={twoFactorLoading} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                      Reconfigure app
                    </button>
                  </div>
                )}
              </div>

              {/* Method: Email */}
              {twoFactor.email2faReady && (
                <div className={`rounded-xl border p-4 ${emailSetupStarted ? 'border-white/15 bg-white/[0.02]' : twoFactor.methods?.includes('email') ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-[#27272a]'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Email code</p>
                        <p className="text-xs text-zinc-500">Receive a one-time code by email each time you log in.</p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {twoFactor.methods?.includes('email') ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                          <StatusDot active /> Active
                        </span>
                      ) : (
                        <button onClick={handleInitEmail2fa} disabled={twoFactorLoading || !twoFactor.hasEmail} className="btn-secondary text-xs px-3 py-2">
                          {twoFactorLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Set up'}
                        </button>
                      )}
                    </div>
                  </div>

                  {emailSetupStarted && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
                      <p className="text-sm text-zinc-300">
                        We sent a code to <strong className="text-white">{email}</strong>.<br />
                        <span className="text-xs text-zinc-500">Check your inbox and spam folder, then enter the code below.</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={emailCode}
                          onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
                          className="input-futuristic text-lg tracking-[0.5em] font-mono text-center w-44"
                          placeholder="000000"
                          autoComplete="one-time-code"
                        />
                        <button onClick={handleVerifyEmail2fa} disabled={twoFactorLoading || emailCode.length < 4} className="btn-primary text-sm px-4">
                          {twoFactorLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Disable section */}
              {showDisable && twoFactor.methods?.length > 0 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-4">
                  <div>
                    <p className="text-sm font-medium text-red-400">Disable two-step verification</p>
                    <p className="text-xs text-zinc-500 mt-1">Confirm your identity to turn off the extra protection.</p>
                  </div>
                  {twoFactor.methods.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {twoFactor.methods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => { setDisableMethod(method); setDisableCode(''); setDisableCodeSent(false); }}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${disableMethod === method ? 'bg-white text-zinc-900 border-white font-medium' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}
                        >
                          {method === 'totp' ? 'Use app code' : 'Use email code'}
                        </button>
                      ))}
                    </div>
                  )}
                  {disableMethod === 'email' && !disableCodeSent && (
                    <button onClick={handleSendDisableEmailCode} disabled={twoFactorLoading} className="btn-secondary text-xs px-3 py-2">
                      {twoFactorLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Send code to my email'}
                    </button>
                  )}
                  {disableCodeSent && <p className="text-xs text-zinc-500">Code sent — check your inbox.</p>}
                  {(disableMethod === 'totp' || disableCodeSent) && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                        className="input-futuristic text-lg tracking-[0.5em] font-mono text-center w-44"
                        placeholder={disableMethod === 'totp' ? 'App code' : 'Email code'}
                        autoComplete="one-time-code"
                      />
                      <button
                        onClick={handleDisable2fa}
                        disabled={twoFactorLoading || disableCode.length < 4}
                        className="text-sm px-4 py-2 rounded-lg bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-colors font-medium"
                      >
                        {twoFactorLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Disable'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Passkeys */}
          <SectionCard className={focusPasskey ? 'ring-1 ring-white/30' : ''}>
            <SectionHeader
              icon={Key}
              title="Passkeys"
              description="Sign in with your fingerprint, face, or device PIN — no password needed."
              action={
                passkeyStatus.hasPasskey
                  ? <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 shrink-0">
                      <StatusDot active /> {passkeyStatus.passkeyCount} configured
                    </span>
                  : null
              }
            />
            <div className="p-5 space-y-4">
              {passkeys.length > 0 && (
                <div className="space-y-2">
                  {passkeys.map((passkey) => (
                    <div key={passkey.id} className="flex items-center gap-3 rounded-lg border border-[#27272a] bg-white/[0.02] px-4 py-3">
                      <Key className="w-4 h-4 text-zinc-500 shrink-0" strokeWidth={1.5} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{passkey.name || 'My device'}</p>
                        <p className="text-xs text-zinc-600">Added {new Date(passkey.createdAt).toLocaleDateString()}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePasskey(passkey.id)}
                        disabled={passkeyBusy}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors px-2 py-1 rounded-md hover:bg-red-500/10"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!passkeyStatus.hasPasskey && (
                <p className="text-sm text-zinc-500">No passkey yet. Add one to sign in faster without a password.</p>
              )}
              <div className="flex flex-wrap gap-3 items-center">
                <input
                  type="text"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  className="input-futuristic text-sm max-w-[220px]"
                  placeholder="Device name (optional)"
                />
                <button type="button" onClick={handleCreatePasskey} disabled={passkeyBusy} className="btn-primary text-sm px-4">
                  {passkeyBusy
                    ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Adding…</>
                    : <><Plus className="w-3.5 h-3.5" /> {passkeyStatus.hasPasskey ? 'Add device' : 'Add passkey'}</>
                  }
                </button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
