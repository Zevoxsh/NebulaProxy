import { BrowserRouter, Routes, Route, Navigate, useLocation, matchPath } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuthStore } from './store/authStore';
import { authAPI } from './api/client';
import Login from './pages/Login';
import Register from './pages/Register';
import PasswordReset from './pages/PasswordReset';
import Dashboard from './pages/Dashboard';
import Domains from './pages/Domains';
import DomainDetail from './pages/DomainDetail';
import Redirections from './pages/Redirections';
import Teams from './pages/Teams';
import TeamDetail from './pages/TeamDetail';
import SSLCertificates from './pages/SSLCertificates';
import CertificateDetail from './pages/CertificateDetail';
import AccountSettings from './pages/AccountSettings';
import Analytics from './pages/Analytics';
import RealtimeTraffic from './pages/RealtimeTraffic';
import CurrentTraffic from './pages/CurrentTraffic';
import Layout from './components/layout/Layout';
import { AdminLayout } from './components/layout/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminDomains from './pages/admin/AdminDomains';
import AdminTeams from './pages/admin/AdminTeams';
import AdminRedirections from './pages/admin/AdminRedirections';
import AdminStats from './pages/admin/AdminStats';
import AdminConfig from './pages/admin/AdminConfig';
import AdminServices from './pages/admin/AdminServices';
import AdminMonitoring from './pages/admin/AdminMonitoring';
import AdminSmtp from './pages/admin/AdminSmtp';
import AdminSmtpProxy from './pages/admin/AdminSmtpProxy';
import AdminUpdates from './pages/admin/AdminUpdates';
import UrlBlockingRules from './pages/admin/UrlBlockingRules';
import AdminAudit from './pages/admin/AdminAudit';
import AdminBackups from './pages/admin/AdminBackups';
import AdminDdos from './pages/admin/AdminDdos';
import AdminTraffic from './pages/admin/AdminTraffic';
import AdminPinReset from './pages/admin/AdminPinReset';
import StatusPage from './pages/StatusPage';
import { Toaster } from './components/ui/toaster';
import { useBrandingStore } from './store/brandingStore';

const ROUTE_METADATA = [
  { patterns: ['/status'], title: 'Status', description: 'Service availability status.' },
  { patterns: ['/login'], title: 'Sign In', description: 'Sign in to the control panel.' },
  { patterns: ['/register'], title: 'Create Account', description: 'Create a local account.' },
  { patterns: ['/reset-password'], title: 'Reset Password', description: 'Request a reset link and set a new password.' },
  { patterns: ['/dashboard'], title: 'Dashboard', description: 'System overview and key metrics.' },
  { patterns: ['/analytics'], title: 'Analytics', description: 'Métriques de trafic et performances.' },
  { patterns: ['/live-traffic'], title: 'Live Traffic', description: 'Trafic en temps réel par domaine.' },
  { patterns: ['/current-traffic'], title: 'Requêtes actuelles', description: 'Flux en direct des 60 dernières secondes.' },
  { patterns: ['/domains'], title: 'Domains', description: 'Manage your domains and routing.' },
  { patterns: ['/domains/groups/:groupId'], title: 'Domain Group', description: 'Manage domains in a specific group.' },
  { patterns: ['/domains/:id'], title: 'Domain Details', description: 'View and manage a domain configuration.' },
  { patterns: ['/domains/:id/logs'], title: 'Domain Logs', description: 'Inspect domain traffic and logs.' },
  { patterns: ['/domains/:id/load-balancing'], title: 'Load Balancing', description: 'Configure load balancing for a domain.' },
  { patterns: ['/domains/:id/advanced'], title: 'Domain Advanced', description: 'Maintenance, GeoIP, rate limiting and more.' },
  { patterns: ['/redirections'], title: 'Redirections', description: 'Manage short links and HTTP redirections.' },
  { patterns: ['/teams'], title: 'Teams', description: 'Manage teams, members, and ownership.' },
  { patterns: ['/teams/:teamId/*'], title: 'Team Details', description: 'Manage team domains, members, and settings.' },
  { patterns: ['/url-blocking'], title: 'URL Blocking', description: 'Manage URL blocking rules for your domains.' },
  { patterns: ['/ssl-certificates'], title: 'SSL Certificates', description: 'Manage SSL certificates and renewals.' },
  { patterns: ['/certificates/:domainId'], title: 'Certificate Details', description: 'View SSL certificate details for a domain.' },
  { patterns: ['/account', '/account/profile'], title: 'Account Profile', description: 'Manage your profile and account info.' },
  { patterns: ['/account/security'], title: 'Account Security', description: 'Manage security settings, 2FA, and passkeys.' },
  { patterns: ['/account/notifications'], title: 'Account Notifications', description: 'Manage personal notification settings.' },
  { patterns: ['/account/api-keys'], title: 'API Keys', description: 'Manage API keys and access scopes.' },
  { patterns: ['/admin/dashboard', '/admin'], title: 'Admin Dashboard', description: 'Administrative overview and core system metrics.' },
  { patterns: ['/admin/users'], title: 'Admin Users', description: 'Manage users, roles, quotas, and access.' },
  { patterns: ['/admin/domains'], title: 'Admin Domains', description: 'Monitor and manage all domains.' },
  { patterns: ['/admin/teams'], title: 'Admin Teams', description: 'Manage all teams and team quotas.' },
  { patterns: ['/admin/redirections'], title: 'Admin Redirections', description: 'Manage all redirections across the platform.' },
  { patterns: ['/admin/stats'], title: 'Admin Analytics', description: 'View platform analytics and usage stats.' },
  { patterns: ['/admin/config'], title: 'Admin Configuration', description: 'Configure global system settings.' },
  { patterns: ['/admin/services'], title: 'Admin Services', description: 'Manage backend and infrastructure services.' },
  { patterns: ['/admin/monitoring'], title: 'Admin Monitoring', description: 'View service health and monitoring signals.' },
  { patterns: ['/admin/smtp'], title: 'Admin SMTP Setup', description: 'Configure SMTP transport for email notifications.' },
  { patterns: ['/admin/smtp-proxy'], title: 'Admin SMTP Proxy', description: 'Configure and monitor SMTP proxy settings.' },
  { patterns: ['/admin/backups'], title: 'Admin Backups', description: 'Create, export, and reimport database backups.' },
  { patterns: ['/admin/ddos'], title: 'Admin DDoS Protection', description: 'Manage IP bans and threat intelligence blocklists.' },
  { patterns: ['/admin/traffic'], title: 'Admin Live Traffic', description: 'Monitor live connections across all domains.' },
  { patterns: ['/domains/:id/traffic'], title: 'Domain Live Traffic', description: 'Monitor live connections for this domain.' },
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
  }, [location.pathname, location.search]);

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
  useEffect(() => { fetchBranding(); }, []);

  // Check authentication on mount (skip for login/register pages to avoid infinite loop)
  useEffect(() => {
    const verifyAuth = async () => {
      // Skip auth verification on public pages to prevent redirect loop
      const publicPaths = ['/login', '/register', '/reset-password', '/admin/pin-reset', '/status'];
      const currentPath = window.location.pathname;

      if (publicPaths.includes(currentPath)) {
        setAuthChecked(true);
        return;
      }

      try {
        const response = await authAPI.verify();
        if (response.data?.user) {
          setUser(response.data.user);
        }
      } catch (error) {
        // Not authenticated or error, clear auth state
        logout();
      } finally {
        setAuthChecked(true);
      }
    };

    verifyAuth();
  }, [setUser, logout]);

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0B0C0F] via-[#12131A] to-[#0B0C0F]">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <RouteMetadata />
      <Toaster />
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
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/live-traffic" element={<RealtimeTraffic />} />
          <Route path="/current-traffic" element={<CurrentTraffic />} />
          <Route path="/domains" element={<Domains />} />
          <Route path="/domains/groups/:groupId" element={<Domains />} />
          <Route path="/domains/:id" element={<DomainDetail />} />
          <Route path="/domains/:id/logs" element={<DomainDetail />} />
          <Route path="/domains/:id/load-balancing" element={<DomainDetail />} />
          <Route path="/domains/:id/advanced" element={<DomainDetail />} />
          <Route path="/domains/:id/traffic" element={<DomainDetail />} />
          <Route path="/redirections" element={<Redirections />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:teamId/*" element={<TeamDetail />} />
          <Route path="/url-blocking" element={<UrlBlockingRules clientMode />} />
          <Route path="/ssl-certificates" element={<SSLCertificates />} />
          <Route path="/certificates/:domainId" element={<CertificateDetail />} />
          <Route path="/account" element={<AccountSettings />} />
          <Route path="/account/profile" element={<AccountSettings />} />
          <Route path="/account/security" element={<AccountSettings />} />
          <Route path="/account/notifications" element={<AccountSettings />} />
          <Route path="/account/api-keys" element={<AccountSettings />} />
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
          <Route path="/admin/stats" element={<AdminStats />} />
          <Route path="/admin/config" element={<AdminConfig />} />
          <Route path="/admin/services" element={<AdminServices />} />
          <Route path="/admin/monitoring" element={<AdminMonitoring />} />
          <Route path="/admin/smtp" element={<AdminSmtp />} />
          <Route path="/admin/smtp-proxy" element={<AdminSmtpProxy />} />
          <Route path="/admin/backups" element={<AdminBackups />} />
          <Route path="/admin/updates" element={<AdminUpdates />} />
          <Route path="/admin/url-blocking" element={<UrlBlockingRules />} />
          <Route path="/admin/ddos" element={<AdminDdos />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="/admin/traffic" element={<AdminTraffic />} />
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
    </BrowserRouter>
  );
}

export default App;
