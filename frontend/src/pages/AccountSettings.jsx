import { useEffect, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  User, Camera, Save, Mail, BadgeCheck, Bell, Key, Plus, Trash2,
  Copy, Check, AlertCircle, Activity, Loader, Globe, Shield,
  Link as LinkIcon, Users, RefreshCw, X as XIcon
} from 'lucide-react';
import { userAPI, apiKeysAPI, authAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { getAvatarUrl } from '../utils/gravatar';
import axios from 'axios';
import { startRegistration } from '@simplewebauthn/browser';

export default function AccountSettings() {
  const { user, updateUser } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from URL
  const getTabFromPath = () => {
    const path = location.pathname;
    if (path.includes('/security')) return 'security';
    if (path.includes('/notifications')) return 'notifications';
    if (path.includes('/api-keys')) return 'api-keys';
    return 'profile';
  };

  const [activeTab, setActiveTab] = useState(getTabFromPath());

  // Update active tab when URL changes and redirect /account to /account/profile
  useEffect(() => {
    if (location.pathname === '/account') {
      navigate('/account/profile', { replace: true });
    }
    setActiveTab(getTabFromPath());
  }, [location.pathname, navigate]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Profile state
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    email: '',
    avatarUrl: ''
  });

  // Notifications state
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [notifMessage, setNotifMessage] = useState(null);

  // API Keys state
  const [apiKeys, setApiKeys] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newApiKey, setNewApiKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [usageStats, setUsageStats] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [keyFormData, setKeyFormData] = useState({
    name: '',
    description: '',
    scopes: [],
    expiresInDays: 365,
    rateLimitRpm: 60,
    rateLimitRph: 3600
  });
  const [twoFactor, setTwoFactor] = useState({
    enabled: false,
    method: null,
    methods: [],
    hasEmail: false,
    email2faReady: false
  });
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailSetupStarted, setEmailSetupStarted] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableCodeSent, setDisableCodeSent] = useState(false);
  const [disableMethod, setDisableMethod] = useState('totp');
  const [passkeyStatus, setPasskeyStatus] = useState({
    hasPasskey: false,
    passkeyCount: 0
  });
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const focusPasskey = new URLSearchParams(location.search).get('focus') === 'passkey';


  const initials = useMemo(() => {
    const source = profileForm.displayName || user?.displayName || user?.username || '';
    return source.trim().charAt(0).toUpperCase() || 'U';
  }, [profileForm.displayName, user?.displayName, user?.username]);

  const availableScopes = {
    'domains:*': 'Full access to domain management',
    'domains:read': 'Read domain information',
    'domains:write': 'Create and update domains',
    'domains:delete': 'Delete domains',
    'teams:*': 'Full access to team management',
    'teams:read': 'Read team information',
    'teams:write': 'Create and update teams',
    'teams:delete': 'Delete teams',
    'ssl:*': 'Full access to SSL certificate management',
    'ssl:read': 'Read SSL certificate information',
    'ssl:write': 'Create and update SSL certificates',
    'backends:*': 'Full access to backend/load balancer management',
    'backends:read': 'Read backend information',
    'monitoring:read': 'Read monitoring and health check data',
    ...(user?.role === 'admin' ? {
      'users:*': 'Full access to user management (admin only)',
      'users:read': 'Read user information (admin only)',
    } : {})
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [profileRes, notifRes, keysRes, twoFactorRes, passkeyPromptRes, passkeysRes] = await Promise.all([
        userAPI.getMe(),
        axios.get('/api/notification-preferences'),
        apiKeysAPI.list(),
        authAPI.get2faStatus(),
        userAPI.getPasskeyPromptStatus(),
        userAPI.listPasskeys()
      ]);

      // Profile
      const profile = profileRes.data.user || {};
      setProfileForm({
        displayName: profile.displayName || '',
        email: profile.email || '',
        avatarUrl: profile.avatarUrl || ''
      });

      // Notifications
      setNotifPrefs(notifRes.data.preferences);

      // API Keys
      setApiKeys(keysRes.data.apiKeys || []);

      // Two-factor auth
      const nextTwoFactor = twoFactorRes.data?.twoFactor || {
        enabled: false,
        method: null,
        methods: [],
        hasEmail: Boolean(profile.email),
        email2faReady: false
      };
      setTwoFactor(nextTwoFactor);
      if (nextTwoFactor.methods?.includes('totp')) {
        setDisableMethod('totp');
      } else if (nextTwoFactor.methods?.includes('email')) {
        setDisableMethod('email');
      }

      setPasskeyStatus({
        hasPasskey: Boolean(passkeyPromptRes.data?.hasPasskey),
        passkeyCount: Number(passkeyPromptRes.data?.passkeyCount || 0)
      });
      setPasskeys(passkeysRes.data?.passkeys || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  // Profile handlers
  const handleProfileSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const response = await userAPI.updateProfile(profileForm);
      updateUser(response.data.user);
      setSuccess('Profile updated successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const refreshTwoFactorStatus = async () => {
    const response = await authAPI.get2faStatus();
    const nextTwoFactor = response.data?.twoFactor || {
      enabled: false,
      method: null,
      methods: [],
      hasEmail: false,
      email2faReady: false
    };
    setTwoFactor(nextTwoFactor);
    if (nextTwoFactor.methods?.includes('totp')) {
      setDisableMethod('totp');
    } else if (nextTwoFactor.methods?.includes('email')) {
      setDisableMethod('email');
    }
  };

  const handleInitTotp = async () => {
    try {
      setTwoFactorLoading(true);
      setError('');
      setSuccess('');
      const response = await authAPI.initTotp2fa();
      setTotpSetup(response.data?.setup || null);
      setTotpCode('');
      setSuccess('TOTP setup initialized. Add the secret in your authenticator app, then confirm with a code.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to initialize TOTP setup');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleEnableTotp = async () => {
    try {
      if (!totpSetup?.secret || !totpCode) {
        setError('Enter the code from your authenticator app.');
        return;
      }
      setTwoFactorLoading(true);
      setError('');
      setSuccess('');
      await authAPI.enableTotp2fa({ secret: totpSetup.secret, code: totpCode });
      setTotpSetup(null);
      setTotpCode('');
      setEmailSetupStarted(false);
      setEmailCode('');
      setDisableCode('');
      setDisableCodeSent(false);
      await refreshTwoFactorStatus();
      setSuccess('Two-factor authentication (TOTP) is now enabled.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to enable TOTP');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleInitEmail2fa = async () => {
    try {
      setTwoFactorLoading(true);
      setError('');
      setSuccess('');
      const response = await authAPI.initEmail2fa();
      setEmailSetupStarted(true);
      setEmailCode('');
      setSuccess(response.data?.message || 'Verification code sent to your email.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to start email 2FA setup');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleVerifyEmail2fa = async () => {
    try {
      if (!emailCode) {
        setError('Enter the email verification code.');
        return;
      }
      setTwoFactorLoading(true);
      setError('');
      setSuccess('');
      await authAPI.verifyEmail2fa({ code: emailCode });
      setEmailSetupStarted(false);
      setEmailCode('');
      setTotpSetup(null);
      setTotpCode('');
      setDisableCode('');
      setDisableCodeSent(false);
      await refreshTwoFactorStatus();
      setSuccess('Two-factor authentication (email) is now enabled.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to verify email code');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleSendDisableEmailCode = async () => {
    try {
      setTwoFactorLoading(true);
      setError('');
      setSuccess('');
      const response = await authAPI.initDisableEmail2fa();
      setDisableMethod('email');
      setDisableCodeSent(true);
      setSuccess(response.data?.message || 'Disable code sent to your email.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to send disable code');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleDisable2fa = async () => {
    try {
      if (!disableCode) {
        setError('Enter a verification code.');
        return;
      }
      if (!disableMethod) {
        setError('Select a method to disable.');
        return;
      }
      setTwoFactorLoading(true);
      setError('');
      setSuccess('');
      await authAPI.disable2fa({ method: disableMethod, code: disableCode });
      setDisableCode('');
      setDisableCodeSent(false);
      setTotpSetup(null);
      setTotpCode('');
      setEmailSetupStarted(false);
      setEmailCode('');
      await refreshTwoFactorStatus();
      setSuccess('Two-factor authentication disabled.');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to disable two-factor authentication');
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const refreshPasskeys = async () => {
    const [statusRes, passkeysRes] = await Promise.all([
      userAPI.getPasskeyPromptStatus(),
      userAPI.listPasskeys()
    ]);
    setPasskeyStatus({
      hasPasskey: Boolean(statusRes.data?.hasPasskey),
      passkeyCount: Number(statusRes.data?.passkeyCount || 0)
    });
    setPasskeys(passkeysRes.data?.passkeys || []);
  };

  const handleCreatePasskey = async () => {
    try {
      if (!window.isSecureContext) {
        setError('Passkeys require a secure context. Use HTTPS with a real domain (not plain HTTP/IP).');
        return;
      }

      if (!window.PublicKeyCredential) {
        setError('Passkeys API unavailable in this context. Check browser security settings and HTTPS.');
        return;
      }

      if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        const uvAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!uvAvailable) {
          setError('No compatible platform authenticator is available on this device/browser profile.');
          return;
        }
      }

      if (typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function') {
        // Call once to surface environment issues early; no hard failure needed.
        await window.PublicKeyCredential.isConditionalMediationAvailable().catch(() => undefined);
      }

      if (!navigator.credentials?.create) {
        setError('WebAuthn credential API is not available in this environment.');
        return;
      }

      setPasskeyBusy(true);
      setError('');
      setSuccess('');

      const optionsRes = await userAPI.getPasskeyRegistrationOptions();
      const attestationResponse = await startRegistration({ optionsJSON: optionsRes.data.options });
      await userAPI.verifyPasskeyRegistration({
        name: passkeyName.trim() || undefined,
        response: attestationResponse
      });
      await userAPI.respondPasskeyPrompt('setup_now');
      setPasskeyName('');
      await refreshPasskeys();
      setSuccess('Passkey created successfully.');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create passkey.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleDeletePasskey = async (id) => {
    try {
      setPasskeyBusy(true);
      setError('');
      setSuccess('');
      await userAPI.deletePasskey(id);
      await refreshPasskeys();
      setSuccess('Passkey deleted.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete passkey.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  // Notifications handlers
  const handleNotifSave = async () => {
    try {
      setSaving(true);
      await axios.put('/api/notification-preferences', {
        ...notifPrefs,
        webhook_enabled: false,
        webhook_url: '',
        webhook_secret: ''
      });
      setNotifMessage({ type: 'success', text: 'Notification settings saved' });
      setTimeout(() => setNotifMessage(null), 3000);
    } catch (error) {
      setNotifMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const updateNotifPref = (key, value) => {
    setNotifPrefs({ ...notifPrefs, [key]: value });
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

  // API Keys handlers
  const fetchApiKeys = async () => {
    try {
      const response = await apiKeysAPI.list();
      setApiKeys(response.data.apiKeys || []);
    } catch (error) {
      console.error('Error fetching API keys:', error);
    }
  };

  const fetchUsageStats = async (keyId) => {
    try {
      setLoadingUsage(true);
      const response = await apiKeysAPI.getUsage(keyId);
      setUsageStats(response.data);
    } catch (error) {
      console.error('Error fetching usage stats:', error);
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleCreateKey = async () => {
    try {
      if (!keyFormData.name || keyFormData.scopes.length === 0) {
        alert('Name and at least one scope are required');
        return;
      }

      const response = await apiKeysAPI.create(keyFormData);
      setNewApiKey(response.data);
      setShowCreateModal(false);
      fetchApiKeys();
      setKeyFormData({
        name: '',
        description: '',
        scopes: [],
        expiresInDays: 365,
        rateLimitRpm: 60,
        rateLimitRph: 3600
      });
    } catch (error) {
      console.error('Error creating API key:', error);
      alert(error.response?.data?.message || 'Failed to create API key');
    }
  };

  const handleDeleteKey = async (keyId) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      await apiKeysAPI.delete(keyId);
      fetchApiKeys();
      if (selectedKey === keyId) {
        setSelectedKey(null);
        setUsageStats(null);
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
      alert('Failed to delete API key');
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope) => {
    setKeyFormData(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes, scope]
    }));
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const isExpired = (dateString) => {
    if (!dateString) return false;
    return new Date(dateString) < new Date();
  };


  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading settings...</div>
      </div>
    );
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User, path: '/account/profile' },
    { id: 'security', label: 'Security', icon: Shield, path: '/account/security' },
    { id: 'notifications', label: 'Notifications', icon: Bell, path: '/account/notifications' },
    { id: 'api-keys', label: 'API Keys', icon: Key, path: '/account/api-keys' }
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in">
            <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Account Settings</h1>
            <p className="text-xs text-white/50 font-light tracking-wide">Manage your profile, notifications, and preferences</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
          <aside className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-2 h-fit">
            <div className="px-2 py-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Configuration</div>
            <div className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => navigate(tab.path)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs rounded-lg transition-all ${
                      activeTab === tab.id
                        ? 'bg-white text-black'
                        : 'text-white/70 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.5} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </aside>

          <div>

        {/* Messages */}
        {success && (
          <div className="mb-4 bg-[#10B981]/10 backdrop-blur-xl border border-[#10B981]/20 rounded-xl p-3 animate-fade-in">
            <p className="text-xs text-[#34D399]">{success}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-[#EF4444]/10 backdrop-blur-xl border border-[#EF4444]/20 rounded-xl p-3 animate-fade-in">
            <p className="text-xs text-[#F87171]">{error}</p>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                    <Camera className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Profile Photo</p>
                    <p className="text-xs text-white/50">Use a custom URL or Gravatar</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center overflow-hidden shadow-glow-sm">
                    {getAvatarUrl(profileForm.avatarUrl, profileForm.email, 160, user?.avatarUpdatedAt) ? (
                      <img src={getAvatarUrl(profileForm.avatarUrl, profileForm.email, 160, user?.avatarUpdatedAt)} alt="Avatar preview" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl font-light text-white">{initials}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Avatar URL</label>
                    <input
                      type="url"
                      value={profileForm.avatarUrl}
                      onChange={(e) => setProfileForm({ ...profileForm, avatarUrl: e.target.value })}
                      className="input-futuristic text-xs"
                      placeholder="https://example.com/avatar.png"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#22D3EE]/10 border border-[#22D3EE]/30 flex items-center justify-center">
                    <BadgeCheck className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Account Details</p>
                    <p className="text-xs text-white/50">Keep your info up to date</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Display Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
                      <input
                        type="text"
                        value={profileForm.displayName}
                        onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
                        className="input-futuristic pl-10 text-xs"
                        placeholder="Your name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                        className="input-futuristic pl-10 text-xs"
                        placeholder="you@company.com"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <div className="text-xs text-white/50">
                    Signed in as <span className="text-white/70">{user?.username}</span>
                  </div>
                  <button
                    onClick={handleProfileSave}
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
        )}

        {activeTab === 'security' && (
          <div className="space-y-4 animate-fade-in">
            <div className={`bg-[#161722]/50 backdrop-blur-2xl border rounded-xl p-4 shadow-lg ${focusPasskey ? 'border-white/40' : 'border-white/[0.08]'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/20 flex items-center justify-center">
                    <Key className="w-5 h-5 text-white" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Passkeys</p>
                    <p className="text-xs text-white/50">
                      {passkeyStatus.hasPasskey
                        ? `${passkeyStatus.passkeyCount} passkey configured`
                        : 'No passkey configured yet'}
                    </p>
                  </div>
                </div>
              </div>
              {!passkeyStatus.hasPasskey ? (
                <div className="text-xs text-white/70 space-y-3">
                  <p>
                    Passkeys are the recommended sign-in method. Add one to avoid password phishing and speed up login.
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      value={passkeyName}
                      onChange={(e) => setPasskeyName(e.target.value)}
                      className="input-futuristic text-xs max-w-[260px]"
                      placeholder="Passkey name (optional)"
                    />
                    <button
                      type="button"
                      onClick={handleCreatePasskey}
                      disabled={passkeyBusy}
                      className="btn-primary text-xs px-3 py-2"
                    >
                      {passkeyBusy ? 'Creating...' : 'Set up passkey'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-[#34D399]">Your account has passkeys configured.</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      value={passkeyName}
                      onChange={(e) => setPasskeyName(e.target.value)}
                      className="input-futuristic text-xs max-w-[260px]"
                      placeholder="New passkey name (optional)"
                    />
                    <button
                      type="button"
                      onClick={handleCreatePasskey}
                      disabled={passkeyBusy}
                      className="btn-secondary text-xs px-3 py-2"
                    >
                      {passkeyBusy ? 'Adding...' : 'Add another passkey'}
                    </button>
                  </div>
                </div>
              )}
              {passkeys.length > 0 && (
                <div className="mt-3 space-y-2">
                  {passkeys.map((passkey) => (
                    <div key={passkey.id} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                      <div>
                        <p className="text-xs text-white">{passkey.name || 'Passkey'}</p>
                        <p className="text-[11px] text-white/50">
                          Added {new Date(passkey.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePasskey(passkey.id)}
                        disabled={passkeyBusy}
                        className="p-2 rounded-md text-[#F87171] hover:bg-[#EF4444]/10"
                        title="Delete passkey"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-[#34D399]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Two-Factor Authentication</p>
                    <p className="text-xs text-white/50">
                      Enabled methods: {twoFactor.methods?.length ? twoFactor.methods.join(', ') : 'none'}
                    </p>
                  </div>
                </div>
              </div>

              {!twoFactor.hasEmail && (
                <div className="mb-3 text-xs text-[#FBBF24] bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg p-2.5">
                  Add an email address first. 2FA setup is blocked without email.
                </div>
              )}

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleInitTotp}
                    disabled={twoFactorLoading || !twoFactor.hasEmail}
                    className="btn-secondary text-xs px-3 py-2"
                  >
                    {twoFactor.methods?.includes('totp') ? 'Reconfigure TOTP' : 'Enable TOTP'}
                  </button>
                  <button
                    onClick={handleInitEmail2fa}
                    disabled={twoFactorLoading || !twoFactor.hasEmail || !twoFactor.email2faReady}
                    className="btn-secondary text-xs px-3 py-2"
                  >
                    {twoFactor.methods?.includes('email') ? 'Re-verify Email 2FA' : 'Enable Email 2FA'}
                  </button>
                </div>

                {!twoFactor.email2faReady && (
                  <div className="text-xs text-white/60">
                    Email 2FA is unavailable until an admin configures and successfully tests SMTP.
                  </div>
                )}

                {totpSetup?.secret && (
                  <div className="space-y-2 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                    <p className="text-xs text-white/70">
                      TOTP Secret: <span className="font-mono text-white">{totpSetup.secret}</span>
                    </p>
                    <a
                      href={totpSetup.otpauthUrl}
                      className="text-xs text-[#60A5FA] hover:text-[#93C5FD] break-all"
                    >
                      {totpSetup.otpauthUrl}
                    </a>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <input
                        type="text"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        className="input-futuristic text-xs max-w-[220px]"
                        placeholder="Enter 6-digit code"
                      />
                      <button
                        onClick={handleEnableTotp}
                        disabled={twoFactorLoading}
                        className="btn-primary text-xs px-3 py-2"
                      >
                        Confirm TOTP
                      </button>
                    </div>
                  </div>
                )}

                {emailSetupStarted && (
                  <div className="space-y-2 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                    <p className="text-xs text-white/70">Enter the verification code received by email.</p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value)}
                        className="input-futuristic text-xs max-w-[220px]"
                        placeholder="Email code"
                      />
                      <button
                        onClick={handleVerifyEmail2fa}
                        disabled={twoFactorLoading}
                        className="btn-primary text-xs px-3 py-2"
                      >
                        Confirm Email 2FA
                      </button>
                    </div>
                  </div>
                )}

                {twoFactor.methods?.length > 0 && (
                  <div className="space-y-2 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                      <span>Disable method:</span>
                      {twoFactor.methods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setDisableMethod(method)}
                          className={`px-2 py-1 rounded border ${
                            disableMethod === method ? 'bg-white text-black border-white' : 'border-white/20 text-white/70'
                          }`}
                        >
                          {method.toUpperCase()}
                        </button>
                      ))}
                      {disableMethod === 'email' && (
                        <button
                          onClick={handleSendDisableEmailCode}
                          disabled={twoFactorLoading}
                          className="btn-secondary text-xs px-2 py-1"
                        >
                          Send email code
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value)}
                        className="input-futuristic text-xs max-w-[220px]"
                        placeholder={disableMethod === 'totp' ? 'Authenticator code' : 'Email disable code'}
                      />
                      <button
                        onClick={handleDisable2fa}
                        disabled={twoFactorLoading}
                        className="btn-secondary text-xs px-3 py-2"
                      >
                        Disable selected method
                      </button>
                    </div>
                    {disableCodeSent && disableMethod === 'email' && (
                      <p className="text-xs text-white/60">Disable code sent. Check your email.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && notifPrefs && (
          <div className="space-y-4 animate-fade-in">
            {notifMessage && (
              <div className={`backdrop-blur-xl border rounded-xl p-3 ${
                notifMessage.type === 'success'
                  ? 'bg-[#10B981]/10 border-[#10B981]/20'
                  : 'bg-[#EF4444]/10 border-[#EF4444]/20'
              }`}>
                <p className={`text-xs ${notifMessage.type === 'success' ? 'text-[#34D399]' : 'text-[#F87171]'}`}>
                  {notifMessage.text}
                </p>
              </div>
            )}

            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">Notification Preferences</p>
                    <p className="text-xs text-white/50">Save your global notification choices</p>
                  </div>
                </div>
                <button onClick={handleNotifSave} disabled={saving} className="btn-primary text-xs flex items-center gap-2">
                  {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>

            {/* Domain Notifications */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
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
                    {renderToggle(notifPrefs[setting.key], (v) => updateNotifPref(setting.key, v))}
                  </div>
                ))}
              </div>
            </div>

            {/* SSL Notifications */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
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
                    {renderToggle(notifPrefs[setting.key], (v) => updateNotifPref(setting.key, v))}
                  </div>
                ))}
              </div>
            </div>

            {/* Quotas & Security */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
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
                      {renderToggle(notifPrefs[setting.key], (v) => updateNotifPref(setting.key, v))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
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
                      {renderToggle(notifPrefs[setting.key], (v) => updateNotifPref(setting.key, v))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* API Keys Tab */}
        {activeTab === 'api-keys' && (
          <div className="space-y-4 animate-fade-in">
            {/* New API Key Display Modal */}
            {newApiKey && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-[#1a1b2e] border border-white/10 rounded-xl p-6 max-w-2xl w-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-green-500/10 rounded-lg">
                      <Check className="text-green-400" size={24} />
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">API Key Created</h3>
                      <p className="text-sm text-white/50">Save this key - it will not be shown again</p>
                    </div>
                  </div>

                  <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/50 font-mono">API Key</span>
                      <button
                        onClick={() => handleCopy(newApiKey.apiKey)}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <code className="text-sm text-white font-mono break-all">{newApiKey.apiKey}</code>
                  </div>

                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4 flex gap-3">
                    <AlertCircle className="text-yellow-400 flex-shrink-0" size={18} />
                    <p className="text-xs text-yellow-200">
                      This is the only time you will see this key. Make sure to save it in a secure location.
                    </p>
                  </div>

                  <button
                    onClick={() => setNewApiKey(null)}
                    className="btn-primary w-full text-xs py-2.5"
                  >
                    I've saved this key
                  </button>
                </div>
              </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-[#1a1b2e] border border-white/10 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-medium text-white">Create New API Key</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-white/50 hover:text-white">
                      <XIcon size={20} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-white/70 mb-2">Name *</label>
                      <input
                        type="text"
                        value={keyFormData.name}
                        onChange={(e) => setKeyFormData({ ...keyFormData, name: e.target.value })}
                        placeholder="Production API"
                        className="input-futuristic text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-white/70 mb-2">Description</label>
                      <textarea
                        value={keyFormData.description}
                        onChange={(e) => setKeyFormData({ ...keyFormData, description: e.target.value })}
                        placeholder="Used for automated deployments"
                        className="input-futuristic text-xs"
                        rows={3}
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-white/70 mb-3">Scopes *</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {Object.entries(availableScopes).map(([scope, description]) => (
                          <label
                            key={scope}
                            className="flex items-start gap-2 p-3 bg-[#0d0e1a] border border-white/5 rounded-lg hover:border-white/10 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={keyFormData.scopes.includes(scope)}
                              onChange={() => toggleScope(scope)}
                              className="mt-1 w-4 h-4"
                            />
                            <div className="flex-1">
                              <div className="text-xs text-white font-mono">{scope}</div>
                              <div className="text-xs text-white/50">{description}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-white/70 mb-2">Expires in (days)</label>
                        <input
                          type="number"
                          value={keyFormData.expiresInDays}
                          onChange={(e) => setKeyFormData({ ...keyFormData, expiresInDays: parseInt(e.target.value) })}
                          min="1"
                          max="365"
                          className="input-futuristic text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-white/70 mb-2">Rate Limit (RPM)</label>
                        <input
                          type="number"
                          value={keyFormData.rateLimitRpm}
                          onChange={(e) => setKeyFormData({ ...keyFormData, rateLimitRpm: parseInt(e.target.value) })}
                          min="1"
                          max="10000"
                          className="input-futuristic text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-white/70 mb-2">Rate Limit (RPH)</label>
                        <input
                          type="number"
                          value={keyFormData.rateLimitRph}
                          onChange={(e) => setKeyFormData({ ...keyFormData, rateLimitRph: parseInt(e.target.value) })}
                          min="1"
                          max="100000"
                          className="input-futuristic text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={handleCreateKey}
                        disabled={!keyFormData.name || keyFormData.scopes.length === 0}
                        className="btn-primary flex-1 text-xs px-4 py-2.5"
                      >
                        Create Key
                      </button>
                      <button onClick={() => setShowCreateModal(false)} className="btn-secondary flex-1 text-xs px-4 py-2.5">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Usage Stats Modal */}
            {selectedKey && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-[#1a1b2e] border border-white/10 rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-medium text-white">Usage Statistics</h3>
                    <button
                      onClick={() => {
                        setSelectedKey(null);
                        setUsageStats(null);
                      }}
                      className="text-white/50 hover:text-white"
                    >
                      <XIcon size={20} />
                    </button>
                  </div>

                  {loadingUsage ? (
                    <div className="text-center py-8">
                      <RefreshCw className="animate-spin mx-auto mb-2 text-white/50" size={32} />
                      <p className="text-sm text-white/50">Loading statistics...</p>
                    </div>
                  ) : usageStats && (
                    <div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                          <div className="text-xs text-white/50 mb-1">Total Requests</div>
                          <div className="text-2xl font-light text-white">{usageStats.stats.total_requests}</div>
                        </div>
                        <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                          <div className="text-xs text-white/50 mb-1">Success</div>
                          <div className="text-2xl font-light text-green-400">{usageStats.stats.success_count}</div>
                        </div>
                        <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                          <div className="text-xs text-white/50 mb-1">Client Errors</div>
                          <div className="text-2xl font-light text-yellow-400">{usageStats.stats.client_error_count}</div>
                        </div>
                        <div className="bg-[#0d0e1a] border border-white/5 rounded-lg p-4">
                          <div className="text-xs text-white/50 mb-1">Server Errors</div>
                          <div className="text-2xl font-light text-red-400">{usageStats.stats.server_error_count}</div>
                        </div>
                      </div>

                      <div className="mb-6">
                        <h4 className="text-sm font-medium text-white mb-3">Recent Requests</h4>
                        <div className="bg-[#0d0e1a] border border-white/5 rounded-lg overflow-hidden">
                          <div className="max-h-64 overflow-y-auto">
                            {usageStats.recent_usage.map((req, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-3 border-b border-white/5 last:border-0"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-mono text-white/70">{req.method}</span>
                                    <span className="text-xs text-white/50">{req.path}</span>
                                  </div>
                                  <div className="text-xs text-white/30">{formatDate(req.created_at)}</div>
                                </div>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    req.status_code >= 200 && req.status_code < 300
                                      ? 'bg-green-500/10 text-green-400'
                                      : req.status_code >= 400 && req.status_code < 500
                                      ? 'bg-yellow-500/10 text-yellow-400'
                                      : 'bg-red-500/10 text-red-400'
                                  }`}
                                >
                                  {req.status_code}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Header with Add Button */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 flex items-center justify-center">
                    <Key className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-light text-white">API Keys</p>
                    <p className="text-xs text-white/50">Manage programmatic access</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn-primary flex items-center gap-2 text-xs px-4 py-2.5"
                >
                  <Plus size={16} />
                  Add Key
                </button>
              </div>
            </div>

            {/* API Keys List */}
            {apiKeys.length === 0 ? (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-8 text-center">
                <Key className="mx-auto mb-4 text-white/30" size={48} />
                <h3 className="text-lg font-medium text-white mb-2">No API Keys</h3>
                <p className="text-sm text-white/50 mb-4">Create your first API key to get started</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5"
                >
                  <Plus size={16} />
                  Create API Key
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-medium text-white">{key.name}</h3>
                          {isExpired(key.expiresAt) && (
                            <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                              Expired
                            </span>
                          )}
                          {!key.isActive && (
                            <span className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-400">
                              Inactive
                            </span>
                          )}
                        </div>
                        {key.description && (
                          <p className="text-xs text-white/50">{key.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteKey(key.id)}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/50">Prefix</span>
                        <code className="text-white/70 font-mono">{key.keyPrefix}...</code>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/50">Created</span>
                        <span className="text-white/70">{formatDate(key.createdAt)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/50">Last Used</span>
                        <span className="text-white/70">{formatDate(key.lastUsedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/50">Expires</span>
                        <span className={`${isExpired(key.expiresAt) ? 'text-red-400' : 'text-white/70'}`}>
                          {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        setSelectedKey(key.id);
                        fetchUsageStats(key.id);
                      }}
                      className="btn-secondary w-full text-xs flex items-center justify-center gap-2"
                    >
                      <Activity size={14} />
                      View Usage Stats
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

          </div>
        </div>
      </div>
    </div>
  );
}
