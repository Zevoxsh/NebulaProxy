import { BrowserRouter, Routes, Route, Navigate, useLocation, matchPath } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useAuthStore } from './store/authStore';
import { authAPI } from './api/client';
import Layout from './components/layout/Layout';
import { AdminLayout } from './components/layout/AdminLayout';
import { Toaster } from './components/ui/toaster';
import { useBrandingStore } from './store/brandingStore';
import { ModalProvider } from './context/ModalContext';
import BackendUnreachableOverlay from './components/BackendUnreachableOverlay';

// Route-level code splitting — each page becomes its own chunk, fetched only
// when actually navigated to. Previously all ~40 pages (including every
// admin-only page) were eagerly imported here, so visiting a single client
// page like /domains/:id/logs pulled in every admin page's module graph too.
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const PasswordReset = lazy(() => import('./pages/PasswordReset'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Domains = lazy(() => import('./pages/Domains'));
const DomainDetail = lazy(() => import('./pages/DomainDetail'));
const Tunnels = lazy(() => import('./pages/Tunnels'));
const TunnelCreate = lazy(() => import('./pages/TunnelCreate'));
const TunnelDetail = lazy(() => import('./pages/TunnelDetail'));
const OutgoingProxy = lazy(() => import('./pages/OutgoingProxy'));
const Redirections = lazy(() => import('./pages/Redirections'));
const Teams = lazy(() => import('./pages/Teams'));
const TeamDetail = lazy(() => import('./pages/TeamDetail'));
const SSLCertificates = lazy(() => import('./pages/SSLCertificates'));
const CertificateDetail = lazy(() => import('./pages/CertificateDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Security = lazy(() => import('./pages/Security'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Traffic = lazy(() => import('./pages/Traffic'));
const TrafficMap = lazy(() => import('./pages/TrafficMap'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminDomains = lazy(() => import('./pages/admin/AdminDomains'));
const AdminTeams = lazy(() => import('./pages/admin/AdminTeams'));
const AdminRedirections = lazy(() => import('./pages/admin/AdminRedirections'));
const AdminStats = lazy(() => import('./pages/admin/AdminStats'));
const AdminConfig = lazy(() => import('./pages/admin/AdminConfig'));
const AdminConfigHealth = lazy(() => import('./pages/admin/AdminConfigHealth'));
const AdminConfigLogs = lazy(() => import('./pages/admin/AdminConfigLogs'));
const AdminConfigProxy = lazy(() => import('./pages/admin/AdminConfigProxy'));
const AdminConfigTunnels = lazy(() => import('./pages/admin/AdminConfigTunnels'));
const AdminConfigDatabase = lazy(() => import('./pages/admin/AdminConfigDatabase'));
const AdminConfigTls = lazy(() => import('./pages/admin/AdminConfigTls'));
const AdminTunnelsList = lazy(() => import('./pages/admin/AdminTunnelsList'));
const AdminTunnelCreate = lazy(() => import('./pages/admin/AdminTunnelCreate'));
const AdminTunnelDetail = lazy(() => import('./pages/admin/AdminTunnelDetail'));
const AdminOutgoingProxySettings = lazy(() => import('./pages/admin/AdminOutgoingProxySettings'));
const AdminServices = lazy(() => import('./pages/admin/AdminServices'));
const AdminMonitoring = lazy(() => import('./pages/admin/AdminMonitoring'));
const AdminSmtp = lazy(() => import('./pages/admin/AdminSmtp'));
const AdminSmtpProxy = lazy(() => import('./pages/admin/AdminSmtpProxy'));
const AdminUpdates = lazy(() => import('./pages/admin/AdminUpdates'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const UrlBlockingRules = lazy(() => import('./pages/UrlBlockingRules'));
const AdminUrlBlockingRules = lazy(() => import('./pages/admin/UrlBlockingRules'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminBackups = lazy(() => import('./pages/admin/AdminBackups'));
const AdminTraffic = lazy(() => import('./pages/admin/AdminTraffic'));
const AdminPinReset = lazy(() => import('./pages/admin/AdminPinReset'));
const AdminLdap = lazy(() => import('./pages/admin/AdminLdap'));
const StatusPage = lazy(() => import('./pages/StatusPage'));

const ROUTE_METADATA = [
  { patterns: ['/status'], title: 'Status', description: 'Service availability status.' },
  { patterns: ['/login'], title: 'Sign In', description: 'Sign in to the control panel.' },
  { patterns: ['/register'], title: 'Create Account', description: 'Create a local account.' },
  { patterns: ['/reset-password'], title: 'Reset Password', description: 'Request a reset link and set a new password.' },
  { patterns: ['/dashboard'], title: 'Dashboard', description: 'System overview and key metrics.' },
  { patterns: ['/traffic'], title: 'Traffic', description: 'Trafic en temps réel par domaine.' },
  { patterns: ['/traffic/connections'], title: 'Connexions actives', description: 'Flux en direct des 60 dernières secondes.' },
  { patterns: ['/traffic/reports'], title: 'Rapports', description: 'Métriques de trafic et performances.' },
  { patterns: ['/map'], title: 'Carte du trafic', description: 'Origine géographique du trafic en direct.' },
  { patterns: ['/activity'], title: 'Activity Log', description: 'All requests and health events across your domains.' },
  { patterns: ['/domains'], title: 'Domains', description: 'Manage your domains and routing.' },
  { patterns: ['/domains/groups/:groupId'], title: 'Domain Group', description: 'Manage domains in a specific group.' },
  { patterns: ['/domains/:id'], title: 'Domain Details', description: 'View and manage a domain configuration.' },
  { patterns: ['/domains/:id/logs'], title: 'Domain Logs', description: 'Inspect domain traffic and logs.' },
  { patterns: ['/domains/:id/load-balancing'], title: 'Load Balancing', description: 'Configure load balancing for a domain.' },
  { patterns: ['/domains/:id/advanced'], title: 'Domain Advanced', description: 'Rate limiting and PROXY Protocol.' },
  { patterns: ['/domains/:id/maintenance'], title: 'Domain Maintenance', description: 'Maintenance mode for this domain.' },
  { patterns: ['/domains/:id/challenge'], title: 'Domain Challenge', description: 'Visitor challenge and puzzle type selection.' },
  { patterns: ['/redirections'], title: 'Redirections', description: 'Manage short links and HTTP redirections.' },
  { patterns: ['/teams'], title: 'Teams', description: 'Manage teams, members, and ownership.' },
  { patterns: ['/teams/:teamId/*'], title: 'Team Details', description: 'Manage team domains, members, and settings.' },
  { patterns: ['/url-blocking'], title: 'URL Blocking', description: 'Manage URL blocking rules for your domains.' },
  { patterns: ['/ssl-certificates'], title: 'SSL Certificates', description: 'Manage SSL certificates and renewals.' },
  { patterns: ['/certificates/:domainId'], title: 'Certificate Details', description: 'View SSL certificate details for a domain.' },
  { patterns: ['/account', '/account/profile'], title: 'Account Profile', description: 'Manage your profile and account info.' },
  { patterns: ['/account/security'], title: 'Account Security', description: 'Manage security settings, 2FA, and passkeys.' },
  { patterns: ['/account/api-keys'], title: 'API Keys', description: 'Manage API keys and access scopes.' },
  { patterns: ['/admin/dashboard', '/admin'], title: 'Admin Dashboard', description: 'Administrative overview and core system metrics.' },
  { patterns: ['/admin/users'], title: 'Admin Users', description: 'Manage users, roles, quotas, and access.' },
  { patterns: ['/admin/domains'], title: 'Admin Domains', description: 'Monitor and manage all domains.' },
  { patterns: ['/admin/teams'], title: 'Admin Teams', description: 'Manage all teams and team quotas.' },
  { patterns: ['/admin/redirections'], title: 'Admin Redirections', description: 'Manage all redirections across the platform.' },
  { patterns: ['/tunnels', '/tunnels/new', '/tunnels/:id', '/tunnels/:id/ports', '/tunnels/:id/access', '/tunnels/:id/install'], title: 'Tunnels', description: 'Create tunnels, enroll agents, and manage port bindings.' },
  { patterns: ['/admin/tunnels', '/admin/tunnels/new', '/admin/tunnels/:id', '/admin/tunnels/:id/ports', '/admin/tunnels/:id/access', '/admin/tunnels/:id/install'], title: 'Admin Tunnels', description: 'Manage tunnel agents, bindings, and quick connect codes.' },
  { patterns: ['/outgoing-proxy'], title: 'Proxy sortant', description: 'Create SOCKS5 credentials to route your own tools\' traffic through this server.' },
  { patterns: ['/admin/outgoing-proxy'], title: 'Admin Proxy sortant', description: 'Configure the outgoing SOCKS5 proxy and manage all users\' credentials.' },
  { patterns: ['/admin/stats'], title: 'Admin Analytics', description: 'View platform analytics and usage stats.' },
  { patterns: ['/admin/config'], title: 'Admin Configuration', description: 'Configure global system settings.' },
  { patterns: ['/admin/services'], title: 'Admin Services', description: 'Manage backend and infrastructure services.' },
  { patterns: ['/admin/monitoring'], title: 'Admin Monitoring', description: 'View service health and monitoring signals.' },
  { patterns: ['/admin/smtp'], title: 'Admin SMTP Setup', description: 'Configure SMTP transport for email notifications.' },
  { patterns: ['/admin/smtp-proxy'], title: 'Admin SMTP Proxy', description: 'Configure and monitor SMTP proxy settings.' },
  { patterns: ['/admin/backups'], title: 'Admin Backups', description: 'Create, export, and reimport database backups.' },
  { patterns: ['/admin/traffic'], title: 'Admin Live Traffic', description: 'Monitor live connections across all domains.' },
  { patterns: ['/domains/:id/traffic'], title: 'Domain Live Traffic', description: 'Monitor live connections for this domain.' },
  { patterns: ['/domains/:id/players'], title: 'Domain Players', description: 'Minecraft players seen on this domain, with IP history.' },
  { patterns: ['/domains/:id/connections'], title: 'Domain Connections', description: 'Currently open tcp/udp/minecraft sessions for this domain.' },
  { patterns: ['/admin/updates'], title: 'Admin Updates', description: 'Manage system updates and release status.' },
  { patterns: ['/admin/url-blocking'], title: 'Admin URL Blocking', description: 'Manage URL blocking rules across all domains.' },
  { patterns: ['/admin/audit'], title: 'Admin Audit Trail', description: 'Inspect administrative audit logs and events.' },
  { patterns: ['/admin/pin-reset'], title: 'Admin PIN Reset', description: 'Reset admin PIN using a secure email link.' },
];

function upsertMetaTag(attribute, key, content) {
  const selector = `meta[${attribute}="${key}"]`;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertCanonical(href) {
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', href);
}

function resolveRouteMetadata(pathname) {
  for (const routeMeta of ROUTE_METADATA) {
    for (const pattern of routeMeta.patterns) {
      if (matchPath({ path: pattern, end: true }, pathname)) {
        return routeMeta;
      }
    }
  }
  return {
    title: 'Control Panel',
    description: 'Proxy management interface.'
  };
}

function RouteMetadata() {
  const location = useLocation();
  const appName = useBrandingStore((s) => s.appName);

  useEffect(() => {
    const routeMeta = resolveRouteMetadata(location.pathname);
    const title = `${routeMeta.title} | ${appName}`;
    const description = routeMeta.description;
    const absoluteUrl = `${window.location.origin}${location.pathname}${location.search || ''}`;

    document.title = title;
    upsertMetaTag('name', 'description', description);
    upsertMetaTag('name', 'robots', 'noindex, nofollow');
    upsertMetaTag('property', 'og:title', title);
    upsertMetaTag('property', 'og:description', description);
    upsertMetaTag('property', 'og:type', 'website');
    upsertMetaTag('property', 'og:url', absoluteUrl);
    upsertMetaTag('name', 'twitter:card', 'summary');
    upsertMetaTag('name', 'twitter:title', title);
    upsertMetaTag('name', 'twitter:description', description);
    upsertMetaTag('name', 'theme-color', '#09090b');
    upsertCanonical(absoluteUrl);
  }, [location.pathname, location.search, appName]);

  return null;
}

function ProtectedRoute({ children, adminOnly = false }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const fetchBranding = useBrandingStore((s) => s.fetchBranding);
  const [authChecked, setAuthChecked] = useState(false);

  // Fetch branding (app name) on first load — public endpoint, no auth needed
  useEffect(() => { fetchBranding(); }, [fetchBranding]);

  // Check authentication on mount (skip for login/register pages to avoid infinite loop)
  useEffect(() => {
    let cancelled = false;

    // Skip auth verification on public pages to prevent redirect loop
    const publicPaths = ['/login', '/register', '/reset-password', '/admin/pin-reset', '/status'];
    const currentPath = window.location.pathname;

    if (publicPaths.includes(currentPath)) {
      setAuthChecked(true);
      return undefined;
    }

    const attempt = async () => {
      try {
        const response = await authAPI.verify();
        if (cancelled) return;
        if (response.data?.user) {
          setUser(response.data.user);
        }
        setAuthChecked(true);
      } catch (error) {
        if (cancelled) return;

        if (error.response) {
          // The server actually answered (401, etc.) — genuinely not authenticated.
          logout();
          setAuthChecked(true);
        } else {
          // No response at all — backend unreachable (e.g. mid-restart on an
          // F5). This used to fall into the same catch-all as a real 401 and
          // log the user out just for refreshing at the wrong moment. The
          // BackendUnreachableOverlay (driven by the same failed request via
          // the axios interceptor) is already covering the screen — just
          // retry quietly until the backend answers instead of bouncing to
          // /login.
          setTimeout(attempt, 2000);
        }
      }
    };

    attempt();
    return () => { cancelled = true; };
  }, [setUser, logout]);

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <>
        <BackendUnreachableOverlay />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0B0C0F] via-[#12131A] to-[#0B0C0F]">
          <div className="text-slate-400">Loading...</div>
        </div>
      </>
    );
  }

  return (
    <BrowserRouter>
      <ModalProvider>
      <BackendUnreachableOverlay />
      <RouteMetadata />
      <Toaster />
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0B0C0F] via-[#12131A] to-[#0B0C0F]">
          <div className="text-slate-400">Loading...</div>
        </div>
      }>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />}
        />
        <Route path="/reset-password" element={<PasswordReset />} />
        <Route path="/admin/pin-reset" element={<AdminPinReset />} />
        <Route path="/status" element={<StatusPage />} />
        {/* Client Routes - with regular Layout */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/traffic" element={<Traffic />} />
          <Route path="/traffic/connections" element={<Traffic />} />
          <Route path="/traffic/reports" element={<Traffic />} />
          <Route path="/map" element={<TrafficMap />} />
          <Route path="/activity" element={<ActivityLog />} />
          {/* Old scattered traffic/analytics pages regrouped under /traffic — kept as redirects so bookmarks/links don't break */}
          <Route path="/analytics" element={<Navigate to="/traffic/reports" replace />} />
          <Route path="/live-traffic" element={<Navigate to="/traffic" replace />} />
          <Route path="/current-traffic" element={<Navigate to="/traffic/connections" replace />} />
          <Route path="/domains" element={<Domains />} />
          <Route path="/domains/groups/:groupId" element={<Domains />} />
          <Route path="/domains/:id" element={<DomainDetail />} />
          <Route path="/domains/:id/logs" element={<DomainDetail />} />
          <Route path="/domains/:id/load-balancing" element={<DomainDetail />} />
          <Route path="/domains/:id/advanced" element={<DomainDetail />} />
          <Route path="/domains/:id/maintenance" element={<DomainDetail />} />
          <Route path="/domains/:id/challenge" element={<DomainDetail />} />
          <Route path="/domains/:id/traffic" element={<DomainDetail />} />
          <Route path="/domains/:id/players" element={<DomainDetail />} />
          <Route path="/domains/:id/connections" element={<DomainDetail />} />
          <Route path="/tunnels" element={<Tunnels />} />
          <Route path="/tunnels/new" element={<TunnelCreate />} />
          <Route path="/tunnels/:id" element={<TunnelDetail />} />
          <Route path="/tunnels/:id/ports" element={<TunnelDetail />} />
          <Route path="/tunnels/:id/access" element={<TunnelDetail />} />
          <Route path="/tunnels/:id/install" element={<TunnelDetail />} />
          <Route path="/outgoing-proxy" element={<OutgoingProxy />} />
          <Route path="/redirections" element={<Redirections />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:teamId/*" element={<TeamDetail />} />
          <Route path="/url-blocking" element={<UrlBlockingRules />} />
          <Route path="/ssl-certificates" element={<SSLCertificates />} />
          <Route path="/certificates/:domainId" element={<CertificateDetail />} />
          <Route path="/account" element={<Navigate to="/account/profile" replace />} />
          <Route path="/account/profile" element={<Profile />} />
          <Route path="/account/security" element={<Security />} />
          <Route path="/account/api-keys" element={<ApiKeys />} />
          <Route path="/account/notifications" element={<Notifications />} />
        </Route>

        {/* Admin Routes - with AdminLayout */}
        <Route
          element={
            <ProtectedRoute adminOnly={true}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/domains" element={<AdminDomains />} />
          <Route path="/admin/teams" element={<AdminTeams />} />
          <Route path="/admin/redirections" element={<AdminRedirections />} />
          <Route path="/admin/tunnels" element={<AdminTunnelsList />} />
          <Route path="/admin/tunnels/new" element={<AdminTunnelCreate />} />
          <Route path="/admin/tunnels/:id" element={<AdminTunnelDetail />} />
          <Route path="/admin/tunnels/:id/ports" element={<AdminTunnelDetail />} />
          <Route path="/admin/tunnels/:id/access" element={<AdminTunnelDetail />} />
          <Route path="/admin/tunnels/:id/install" element={<AdminTunnelDetail />} />
          <Route path="/admin/outgoing-proxy" element={<AdminOutgoingProxySettings />} />
          <Route path="/admin/stats" element={<AdminStats />} />
          <Route path="/admin/config" element={<AdminConfig />} />
          <Route path="/admin/config/health" element={<AdminConfigHealth />} />
          <Route path="/admin/config/logs" element={<AdminConfigLogs />} />
          <Route path="/admin/config/proxy" element={<AdminConfigProxy />} />
          <Route path="/admin/config/tunnels" element={<AdminConfigTunnels />} />
          <Route path="/admin/config/database" element={<AdminConfigDatabase />} />
          <Route path="/admin/config/tls" element={<AdminConfigTls />} />
          <Route path="/admin/services" element={<AdminServices />} />
          <Route path="/admin/monitoring" element={<AdminMonitoring />} />
          <Route path="/admin/smtp" element={<AdminSmtp />} />
          <Route path="/admin/smtp-proxy" element={<AdminSmtpProxy />} />
          <Route path="/admin/backups" element={<AdminBackups />} />
          <Route path="/admin/updates" element={<AdminUpdates />} />
          <Route path="/admin/url-blocking" element={<AdminUrlBlockingRules />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="/admin/traffic" element={<AdminTraffic />} />
          <Route path="/admin/ldap" element={<AdminLdap />} />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>
        <Route
          path="/"
          element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />}
        />
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
      </Routes>
      </Suspense>
      </ModalProvider>
    </BrowserRouter>
  );
}

export default App;
