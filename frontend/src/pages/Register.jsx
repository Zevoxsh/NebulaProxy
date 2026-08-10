import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { authAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useBrandingStore } from '../store/brandingStore';

export default function Register() {
  const navigate = useNavigate();
  const setUser = useAuthStore((state) => state.setUser);
  const appName = useBrandingStore((s) => s.appName);

  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState('enterprise');
  const [registrationAllowed, setRegistrationAllowed] = useState(true);

  useEffect(() => {
    let isMounted = true;
    authAPI.getMode()
      .then((response) => {
        const mode = response.data?.authType || response.data?.mode || 'enterprise';
        const regEnabled = response.data?.registrationEnabled !== false;
        if (isMounted) {
          setAuthMode(mode);
          setRegistrationAllowed(regEnabled);
          if (mode !== 'local' || !regEnabled) {
            navigate('/login', { replace: true });
          }
        }
      })
      .catch(() => {
        if (isMounted) {
          navigate('/login', { replace: true });
        }
      });
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = {
        username: formData.username,
        displayName: formData.displayName || formData.username,
        email: formData.email || undefined,
        password: formData.password
      };
      const response = await authAPI.register(payload);
      const { user } = response.data;
      setUser(user);
      navigate('/dashboard');
    } catch (err) {
      setError(
        err.response?.data?.message ||
        'Registration failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  if (authMode !== 'local') {
    return null;
  }

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
              <h1 className="text-2xl font-semibold tracking-tight">Create a local account</h1>
              <p className="text-sm text-white/60">Fill in your details to register.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="username" className="text-sm text-white/80">Username</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="username"
                  disabled={loading}
                  className="input-futuristic"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="displayName" className="text-sm text-white/80">Display Name</label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  value={formData.displayName}
                  onChange={handleChange}
                  placeholder="Public display name"
                  disabled={loading}
                  className="input-futuristic"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm text-white/80">Email (optional)</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  disabled={loading}
                  className="input-futuristic"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm text-white/80">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Minimum 8 characters"
                  disabled={loading}
                  className="input-futuristic"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full">
                <span className="flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {loading ? 'Creating account...' : 'Register'}
                </span>
              </button>
            </form>

            <div className="text-center text-xs text-white/50 space-y-2">
              <p>Already have an account?</p>
              <button type="button" onClick={() => navigate('/login')} className="underline hover:text-white">
                Back to sign in
              </button>
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

              <h2 className="text-4xl font-semibold leading-none tracking-tight mb-5">NEBULA</h2>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  Local Auth
                </div>
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  Public Register
                </div>
                <div className="rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/75">
                  TLS Ready
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
