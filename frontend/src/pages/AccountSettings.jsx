import { useEffect, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  User, Camera, Save, Mail, Key, Plus, Trash2,
  Copy, Check, AlertCircle, Activity, Loader, Shield,
  RefreshCw, X as XIcon, Lock, Smartphone, AtSign, ChevronRight,
  Eye, EyeOff
} from 'lucide-react';
import { userAPI, apiKeysAPI, authAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { getAvatarUrl } from '../utils/gravatar';
import { startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';

export default function AccountSettings() {
  const { user, updateUser } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  const getTabFromPath = () => {
    const path = location.pathname;
    if (path.includes('/security')) return 'security';
    if (path.includes('/api-keys')) return 'api-keys';
    return 'profile';
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath());

  useEffect(() => {
    if (location.pathname === '/account') navigate('/account/profile', { replace: true });
    setActiveTab(getTabFromPath());
  }, [location.pathname, navigate]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [profileForm, setProfileForm] = useState({ displayName: '', email: '', avatarUrl: '' });

  const [apiKeys, setApiKeys] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newApiKey, setNewApiKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [usageStats, setUsageStats] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [keyFormData, setKeyFormData] = useState({
    name: '', description: '', scopes: [], expiresInDays: 365, rateLimitRpm: 60, rateLimitRph: 3600
  });

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
  const focusPasskey = new URLSearchParams(location.search).get('focus') === 'passkey';

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

  const initials = useMemo(() => {
    const source = profileForm.displayName || user?.displayName || user?.username || '';
    return source.trim().charAt(0).toUpperCase() || 'U';
  }, [profileForm.displayName, user?.displayName, user?.username]);

  const availableScopes = {
    'domains:*': 'Full access to domains',
    'domains:read': 'Read domains',
    'domains:write': 'Create & update domains',
    'domains:delete': 'Delete domains',
    'teams:*': 'Full access to teams',
    'teams:read': 'Read teams',
    'teams:write': 'Create & update teams',
    'teams:delete': 'Delete teams',
    'ssl:*': 'Full access to SSL certificates',
    'ssl:read': 'Read SSL certificates',
    'ssl:write': 'Create & update SSL certificates',
    'backends:*': 'Full access to backends',
    'backends:read': 'Read backends',
    'monitoring:read': 'Read monitoring data',
    ...(user?.role === 'admin' ? { 'users:*': 'Full access to users (admin)', 'users:read': 'Read users (admin)' } : {})
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [profileRes, keysRes, twoFactorRes, passkeyPromptRes, passkeysRes] = await Promise.all([
        userAPI.getMe(), apiKeysAPI.list(),
        authAPI.get2faStatus(), userAPI.getPasskeyPromptStatus(), userAPI.listPasskeys()
      ]);
      const profile = profileRes.data.user || {};
      setProfileForm({ displayName: profile.displayName || '', email: profile.email || '', avatarUrl: profile.avatarUrl || '' });
      setApiKeys(keysRes.data.apiKeys || []);
      const nextTwoFactor = twoFactorRes.data?.twoFactor || { enabled: false, method: null, methods: [], hasEmail: Boolean(profile.email), email2faReady: false };
      setTwoFactor(nextTwoFactor);
      if (nextTwoFactor.methods?.includes('totp')) setDisableMethod('totp');
      else if (nextTwoFactor.methods?.includes('email')) setDisableMethod('email');
      setPasskeyStatus({ hasPasskey: Boolean(passkeyPromptRes.data?.hasPasskey), passkeyCount: Number(passkeyPromptRes.data?.passkeyCount || 0) });
      setPasskeys(passkeysRes.data?.passkeys || []);
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSave = async () => {
    try {
      setSaving(true); setError(''); setSuccess('');
      const response = await userAPI.updateProfile(profileForm);
      updateUser(response.data.user);
      setSuccess('Profile saved successfully.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.response?.data?.message || 'Failed to save profile'); }
    finally { setSaving(false); }
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

  const fetchApiKeys = async () => {
    try { const r = await apiKeysAPI.list(); setApiKeys(r.data.apiKeys || []); } catch { /* ignore */ }
  };

  const fetchUsageStats = async (keyId) => {
    try { setLoadingUsage(true); const r = await apiKeysAPI.getUsage(keyId); setUsageStats(r.data); } catch { /* ignore */ }
    finally { setLoadingUsage(false); }
  };

  const handleCreateKey = async () => {
    try {
      if (!keyFormData.name || keyFormData.scopes.length === 0) { alert('Name and at least one scope are required.'); return; }
      const response = await apiKeysAPI.create(keyFormData);
      setNewApiKey(response.data); setShowCreateModal(false); fetchApiKeys();
      setKeyFormData({ name: '', description: '', scopes: [], expiresInDays: 365, rateLimitRpm: 60, rateLimitRph: 3600 });
    } catch (err) { alert(err.response?.data?.message || 'Failed to create API key'); }
  };

  const handleDeleteKey = async (keyId) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    try { await apiKeysAPI.delete(keyId); fetchApiKeys(); if (selectedKey === keyId) { setSelectedKey(null); setUsageStats(null); } }
    catch { alert('Failed to delete API key'); }
  };

  const handleCopy = (text) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const toggleScope = (scope) => setKeyFormData(prev => ({ ...prev, scopes: prev.scopes.includes(scope) ? prev.scopes.filter(s => s !== scope) : [...prev.scopes, scope] }));
  const formatDate = (d) => d ? new Date(d).toLocaleString() : 'Never';
  const isExpired = (d) => d ? new Date(d) < new Date() : false;

  const SectionCard = ({ children, className = '' }) => (
    <div className={`bg-[#111113] border border-[#27272a] rounded-xl overflow-hidden ${className}`}>
      {children}
    </div>
  );

  const SectionHeader = ({ icon: Icon, title, description, action }) => (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[#27272a]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-white/60" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{title}</p>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );

  const StatusDot = ({ active }) => (
    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
  );

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

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User, path: '/account/profile' },
    { id: 'security', label: 'Security', icon: Shield, path: '/account/security' },
    { id: 'api-keys', label: 'API Keys', icon: Key, path: '/account/api-keys' },
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <h1 className="text-2xl font-semibold text-white tracking-tight">Account</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage your profile and account security</p>
        </div>
      </div>

      <div className="page-body">

        {/* Global messages */}
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

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5">

          {/* Sidebar nav */}
          <nav className="bg-[#111113] border border-[#27272a] rounded-xl p-2 h-fit">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => navigate(tab.path)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all mb-0.5 last:mb-0 ${
                    active
                      ? 'bg-white text-zinc-900 font-medium'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Main content */}
          <div className="min-w-0 space-y-4">

            {/* ═══════════════════════════ PROFILE ═══════════════════════════ */}
            {activeTab === 'profile' && (
              <div className="space-y-4 animate-fade-in">

                {/* Avatar */}
                <SectionCard>
                  <SectionHeader icon={Camera} title="Profile photo" description="Shown next to your name across the panel" />
                  <div className="p-5 flex items-center gap-5">
                    <div className="w-16 h-16 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden shrink-0">
                      {getAvatarUrl(profileForm.avatarUrl, profileForm.email, 160, user?.avatarUpdatedAt)
                        ? <img src={getAvatarUrl(profileForm.avatarUrl, profileForm.email, 160, user?.avatarUpdatedAt)} alt="Avatar" className="w-full h-full object-cover" />
                        : <span className="text-xl font-semibold text-white">{initials}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Avatar URL</label>
                      <input
                        type="url"
                        value={profileForm.avatarUrl}
                        onChange={(e) => setProfileForm({ ...profileForm, avatarUrl: e.target.value })}
                        className="input-futuristic text-sm"
                        placeholder="https://example.com/photo.jpg"
                      />
                      <p className="text-xs text-zinc-600 mt-1.5">Leave empty to use your Gravatar (linked to your email).</p>
                    </div>
                  </div>
                </SectionCard>

                {/* Info */}
                <SectionCard>
                  <SectionHeader icon={User} title="Account information" description="Your name and email address" />
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Display name</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" strokeWidth={1.5} />
                          <input
                            type="text"
                            value={profileForm.displayName}
                            onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                            className="input-futuristic pl-9 text-sm"
                            placeholder="Your name"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email address</label>
                        <div className="relative">
                          <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" strokeWidth={1.5} />
                          <input
                            type="email"
                            value={profileForm.email}
                            onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                            className="input-futuristic pl-9 text-sm"
                            placeholder="you@example.com"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-zinc-600">Signed in as <span className="text-zinc-400">{user?.username}</span></p>
                      <button onClick={handleProfileSave} disabled={saving} className="btn-primary text-sm px-4">
                        {saving ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save changes</>}
                      </button>
                    </div>
                  </div>
                </SectionCard>

              </div>
            )}

            {/* ═══════════════════════════ SECURITY ═══════════════════════════ */}
            {activeTab === 'security' && (
              <div className="space-y-4 animate-fade-in">

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
                        Add an email address in the <strong className="text-amber-300">Profile</strong> tab before setting up two-step verification.
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
                                  <p className="text-xs text-zinc-500 mt-1">Open the app, tap <span className="text-zinc-400">+</span> or <span className="text-zinc-400">"Add account"</span>, then point your phone's camera at the code.</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 font-semibold flex items-center justify-center shrink-0 mt-0.5">3</span>
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-white">Enter the 6-digit code</p>
                                  <p className="text-xs text-zinc-500 mt-1 mb-3">Type the code shown in the app to confirm it's working.</p>
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
                              We sent a code to <strong className="text-white">{profileForm.email}</strong>.<br />
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
            )}

            {/* ═══════════════════════════ API KEYS ═══════════════════════════ */}
            {activeTab === 'api-keys' && (
              <div className="space-y-4 animate-fade-in">

                {/* New key reveal modal */}
                {newApiKey && (
                  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-lg w-full animate-scale-in">
                      <div className="flex items-center gap-3 mb-5">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                          <Check className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">API key created</p>
                          <p className="text-xs text-zinc-500">Copy it now — it won't be shown again.</p>
                        </div>
                      </div>
                      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-zinc-500">Your API key</span>
                          <button onClick={() => handleCopy(newApiKey.apiKey)} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors">
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <code className="text-sm text-white font-mono break-all">{newApiKey.apiKey}</code>
                      </div>
                      <div className="flex items-start gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-4">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300/80">Save this key somewhere safe. It cannot be recovered after this screen.</p>
                      </div>
                      <button onClick={() => setNewApiKey(null)} className="btn-primary w-full text-sm">I've saved my key</button>
                    </div>
                  </div>
                )}

                {/* Create modal */}
                {showCreateModal && (
                  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
                      <div className="flex items-center justify-between mb-5">
                        <p className="text-base font-semibold text-white">Create API key</p>
                        <button onClick={() => setShowCreateModal(false)} className="text-zinc-500 hover:text-white transition-colors">
                          <XIcon className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name <span className="text-red-400">*</span></label>
                          <input type="text" value={keyFormData.name} onChange={(e) => setKeyFormData({ ...keyFormData, name: e.target.value })} placeholder="e.g. Production API" className="input-futuristic text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
                          <textarea value={keyFormData.description} onChange={(e) => setKeyFormData({ ...keyFormData, description: e.target.value })} placeholder="What is this key used for?" className="input-futuristic text-sm" rows={2} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">Permissions <span className="text-red-400">*</span></label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {Object.entries(availableScopes).map(([scope, description]) => (
                              <label key={scope} className="flex items-start gap-2.5 p-3 rounded-lg border border-[#27272a] hover:border-zinc-600 cursor-pointer transition-colors bg-white/[0.02]">
                                <input type="checkbox" checked={keyFormData.scopes.includes(scope)} onChange={() => toggleScope(scope)} className="mt-0.5 w-4 h-4 accent-white" />
                                <div>
                                  <p className="text-xs text-white font-mono">{scope}</p>
                                  <p className="text-xs text-zinc-500">{description}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Expires in (days)</label>
                            <input type="number" value={keyFormData.expiresInDays} onChange={(e) => setKeyFormData({ ...keyFormData, expiresInDays: parseInt(e.target.value) })} min="1" max="365" className="input-futuristic text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Limit / minute</label>
                            <input type="number" value={keyFormData.rateLimitRpm} onChange={(e) => setKeyFormData({ ...keyFormData, rateLimitRpm: parseInt(e.target.value) })} min="1" className="input-futuristic text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Limit / hour</label>
                            <input type="number" value={keyFormData.rateLimitRph} onChange={(e) => setKeyFormData({ ...keyFormData, rateLimitRph: parseInt(e.target.value) })} min="1" className="input-futuristic text-sm" />
                          </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button onClick={handleCreateKey} disabled={!keyFormData.name || keyFormData.scopes.length === 0} className="btn-primary flex-1 text-sm">Create key</button>
                          <button onClick={() => setShowCreateModal(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Usage stats modal */}
                {selectedKey && (
                  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#111113] border border-[#27272a] rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
                      <div className="flex items-center justify-between mb-5">
                        <p className="text-base font-semibold text-white">Usage statistics</p>
                        <button onClick={() => { setSelectedKey(null); setUsageStats(null); }} className="text-zinc-500 hover:text-white transition-colors">
                          <XIcon className="w-5 h-5" />
                        </button>
                      </div>
                      {loadingUsage ? (
                        <div className="flex items-center justify-center py-12 gap-3 text-zinc-500 text-sm">
                          <Loader className="w-4 h-4 animate-spin" /> Loading…
                        </div>
                      ) : usageStats && (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                            {[
                              { label: 'Total requests', value: usageStats.stats.total_requests, color: 'text-white' },
                              { label: 'Successful', value: usageStats.stats.success_count, color: 'text-emerald-400' },
                              { label: 'Client errors', value: usageStats.stats.client_error_count, color: 'text-amber-400' },
                              { label: 'Server errors', value: usageStats.stats.server_error_count, color: 'text-red-400' },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                                <p className="text-xs text-zinc-500 mb-1">{label}</p>
                                <p className={`text-2xl font-semibold ${color}`}>{value}</p>
                              </div>
                            ))}
                          </div>
                          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                            <p className="text-xs font-medium text-zinc-400 px-4 py-3 border-b border-zinc-800">Recent requests</p>
                            <div className="max-h-56 overflow-y-auto">
                              {usageStats.recent_usage.map((req, i) => (
                                <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 last:border-0">
                                  <div>
                                    <span className="text-xs font-mono text-zinc-400 mr-2">{req.method}</span>
                                    <span className="text-xs text-zinc-500">{req.path}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-zinc-600">{formatDate(req.created_at)}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${req.status_code < 300 ? 'bg-emerald-500/10 text-emerald-400' : req.status_code < 500 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                                      {req.status_code}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <SectionCard>
                  <SectionHeader
                    icon={Key}
                    title="API keys"
                    description="Programmatic access to the NebulaProxy API"
                    action={
                      <button onClick={() => setShowCreateModal(true)} className="btn-primary text-xs px-3 py-2 shrink-0">
                        <Plus className="w-3.5 h-3.5" /> New key
                      </button>
                    }
                  />
                  {apiKeys.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-center">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-3">
                        <Key className="w-5 h-5 text-zinc-600" strokeWidth={1.5} />
                      </div>
                      <p className="text-sm font-medium text-zinc-300 mb-1">No API keys</p>
                      <p className="text-xs text-zinc-600 mb-4">Create a key to access the API programmatically.</p>
                      <button onClick={() => setShowCreateModal(true)} className="btn-primary text-sm px-4">
                        <Plus className="w-3.5 h-3.5" /> Create key
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {apiKeys.map((k) => (
                        <div key={k.id} className="bg-white/[0.02] border border-[#27272a] rounded-xl p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-white">{k.name}</p>
                                {isExpired(k.expiresAt) && <span className="badge-error">Expired</span>}
                                {!k.isActive && <span className="badge-warning">Inactive</span>}
                              </div>
                              {k.description && <p className="text-xs text-zinc-500 mt-0.5">{k.description}</p>}
                            </div>
                            <button onClick={() => handleDeleteKey(k.id)} className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-500/10">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="space-y-1.5 text-xs mb-3">
                            <div className="flex justify-between"><span className="text-zinc-500">Prefix</span><code className="text-zinc-400 font-mono">{k.keyPrefix}…</code></div>
                            <div className="flex justify-between"><span className="text-zinc-500">Last used</span><span className="text-zinc-400">{formatDate(k.lastUsedAt)}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-500">Expires</span><span className={isExpired(k.expiresAt) ? 'text-red-400' : 'text-zinc-400'}>{k.expiresAt ? formatDate(k.expiresAt) : 'Never'}</span></div>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-3">
                            {k.scopes.map((s) => <span key={s} className="badge-info font-mono">{s}</span>)}
                          </div>
                          <button onClick={() => { setSelectedKey(k.id); fetchUsageStats(k.id); }} className="btn-secondary w-full text-xs flex items-center justify-center gap-1.5">
                            <Activity className="w-3.5 h-3.5" /> View usage
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
