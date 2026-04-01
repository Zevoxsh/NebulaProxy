import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { adminAPI, authAPI, userAPI } from '../../api/client';
import { getAvatarUrl } from '../../utils/gravatar';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  Globe,
  Shield,
  Settings,
  Server,
  LogOut,
  Menu,
  ChevronRight,
  FileText,
  ShieldAlert,
  Mail,
  ArrowLeftRight,
  Sparkles,
  ChevronsLeft,
  ChevronsRight,
  User,
  Bell,
  Database,
  Radio
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AdminButton } from '@/components/admin';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBrandingStore } from '../../store/brandingStore';

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuthStore();
  const appName = useBrandingStore((s) => s.appName);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('admin-sidebar-collapsed');
    return saved === 'true';
  });
  const [systemStats, setSystemStats] = useState({
    cpu: 0,
    memory: 0,
    uptime: '0h 0m'
  });
  const [adminPinLoading, setAdminPinLoading] = useState(true);
  const [adminPinSetupRequired, setAdminPinSetupRequired] = useState(false);
  const [adminPinVerified, setAdminPinVerified] = useState(false);
  const [adminPinValue, setAdminPinValue] = useState('');
  const [adminPinNewValue, setAdminPinNewValue] = useState('');
  const [adminPinError, setAdminPinError] = useState('');
  const [adminPinInfo, setAdminPinInfo] = useState('');

  useEffect(() => {
    localStorage.setItem('admin-sidebar-collapsed', collapsed.toString());
  }, [collapsed]);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const response = await userAPI.getMe();
        if (response.data.user) {
          updateUser(response.data.user);
        }
      } catch {
        // Silent fallback
      }
    };

    loadUserProfile();
  }, [updateUser]);

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  useEffect(() => {
    const fetchAdminPinStatus = async () => {
      if (user?.role !== 'admin') {
        setAdminPinLoading(false);
        return;
      }
      try {
        const response = await authAPI.getAdminPinStatus();
        const state = response.data?.adminPin || {};
        setAdminPinSetupRequired(Boolean(state.setupRequired));
        setAdminPinVerified(Boolean(state.verified));
      } catch (error) {
        setAdminPinError(error.response?.data?.message || 'Unable to load admin security status.');
      } finally {
        setAdminPinLoading(false);
      }
    };

    fetchAdminPinStatus();
  }, [user?.role]);

  useEffect(() => {
    const fetchStats = async () => {
      if (!adminPinVerified) return;
      try {
        const response = await adminAPI.getSystemMetrics();
        const metrics = response.data.metrics;
        setSystemStats({
          cpu: metrics.cpu || 0,
          memory: metrics.memory?.percentage || 0,
          uptime: metrics.uptime || '0h 0m'
        });
      } catch {
        // Keep previous values
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [adminPinVerified]);

  const handleAdminPinSetup = async () => {
    try {
      if (!/^\d{4}$/.test(adminPinNewValue)) {
        setAdminPinError('PIN must be exactly 4 digits.');
        return;
      }
      setAdminPinError('');
      setAdminPinInfo('');
      await authAPI.setupAdminPin(adminPinNewValue);
      setAdminPinSetupRequired(false);
      setAdminPinVerified(true);
      setAdminPinNewValue('');
      setAdminPinInfo('Admin PIN configured.');
    } catch (error) {
      setAdminPinError(error.response?.data?.message || 'Failed to setup admin PIN.');
    }
  };

  const handleAdminPinVerify = async () => {
    try {
      if (!/^\d{4}$/.test(adminPinValue)) {
        setAdminPinError('PIN must be exactly 4 digits.');
        return;
      }
      setAdminPinError('');
      setAdminPinInfo('');
      await authAPI.verifyAdminPin(adminPinValue);
      setAdminPinVerified(true);
      setAdminPinValue('');
      setAdminPinInfo('Admin PIN verified.');
    } catch (error) {
      setAdminPinError(error.response?.data?.message || 'Invalid admin PIN.');
    }
  };

  const navigationSections = useMemo(() => [
    {
      title: 'Core',
      items: [
        { path: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' }
      ]
    },
    {
      title: 'Management',
      items: [
        { path: '/admin/users', icon: Users, label: 'Users' },
        { path: '/admin/domains', icon: Globe, label: 'Domains' },
        { path: '/admin/teams', icon: Shield, label: 'Teams' },
        { path: '/admin/redirections', icon: ArrowLeftRight, label: 'Redirections' },
        { path: '/admin/url-blocking', icon: ShieldAlert, label: 'URL Blocking' },
        { path: '/admin/ddos', icon: Shield, label: 'Challenge' },
        { path: '/admin/traffic', icon: Radio, label: 'Trafic live' }
      ]
    },
    {
      title: 'System',
      items: [
        { path: '/admin/config', icon: Settings, label: 'Configuration' },
        { path: '/admin/services', icon: Server, label: 'Services' },
        { path: '/admin/smtp', icon: Mail, label: 'SMTP Setup' },
        { path: '/admin/smtp-proxy', icon: Mail, label: 'SMTP Proxy' },
        { path: '/admin/backups', icon: Database, label: 'Backups' }
      ]
    },
    {
      title: 'Security',
      items: [
        { path: '/admin/ddos', icon: ShieldAlert, label: 'Challenge' },
        { path: '/admin/updates', icon: Sparkles, label: 'Updates' },
        { path: '/admin/audit', icon: FileText, label: 'Audit Trail' }
      ]
    }
  ], []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getBreadcrumbs = () => {
    const paths = location.pathname.split('/').filter(Boolean);
    const breadcrumbs = [];

    let currentPath = '';
    paths.forEach((path, index) => {
      currentPath += `/${path}`;
      breadcrumbs.push({
        label: path.charAt(0).toUpperCase() + path.slice(1).replace('-', ' '),
        path: currentPath,
        isLast: index === paths.length - 1
      });
    });

    return breadcrumbs;
  };

  const isActivePath = (path) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };
  const isAdminPinResetRoute = location.pathname === '/admin/pin-reset';

  const userAvatar = getAvatarUrl(user?.avatarUrl, user?.email, 72, user?.avatarUpdatedAt);

  const SidebarContent = ({ onNavigate }) => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-admin-border">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-admin-primary/10">
          <img src="/nebula.svg" alt={appName} className="w-5 h-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="text-admin-text font-semibold text-lg">{appName}</h1>
            <p className="text-admin-text-muted text-xs">Admin Control</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-6 px-3">
          {navigationSections.map((section) => (
            <div key={section.title}>
              {!collapsed && (
                <div className="px-3 mb-2">
                  <p className="text-admin-text-subtle text-xs font-semibold uppercase tracking-wider">
                    {section.title}
                  </p>
                </div>
              )}
              {collapsed && (
                <Separator className="bg-admin-border mb-3" />
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(item.path);

                  const linkContent = (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-all",
                        "hover:bg-admin-primary/10",
                        active && "bg-admin-primary/20 text-admin-primary",
                        !active && "text-admin-text hover:text-admin-primary",
                        collapsed && "justify-center"
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {!collapsed && (
                        <span className="font-medium text-sm">{item.label}</span>
                      )}
                      {active && !collapsed && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-admin-primary" />
                      )}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.path} delayDuration={0}>
                        <TooltipTrigger asChild>
                          {linkContent}
                        </TooltipTrigger>
                        <TooltipContent side="right" className="bg-admin-surface border-admin-border text-admin-text">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return linkContent;
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* System Stats Footer */}
      {!collapsed && (
        <>
          <Separator className="bg-admin-border" />
          <div className="p-4">
            <div className="bg-admin-bg-secondary rounded-lg p-3 border border-admin-border">
              <p className="text-admin-text-muted text-xs font-semibold mb-3">System Status</p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-admin-text-subtle">CPU</span>
                  <span className="text-admin-text font-semibold">{systemStats.cpu}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-admin-text-subtle">Memory</span>
                  <span className="text-admin-text font-semibold">{systemStats.memory}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-admin-text-subtle">Uptime</span>
                  <span className="text-admin-text font-semibold">{systemStats.uptime}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <div className="admin-layout w-screen max-w-[100vw] overflow-x-hidden" data-admin-theme>
        {/* Desktop Sidebar */}
        <aside
          className={cn(
            "fixed top-0 left-0 bottom-0 z-40 hidden lg:flex flex-col border-r border-admin-border bg-admin-surface transition-all duration-300",
            collapsed ? "w-16" : "w-72"
          )}
        >
          <SidebarContent onNavigate={() => {}} />

          {/* Collapse Toggle Button */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "absolute -right-3 top-6 w-6 h-6 rounded-full border border-admin-border bg-admin-surface",
              "flex items-center justify-center text-admin-text-muted hover:text-admin-primary",
              "hover:border-admin-primary transition-all shadow-lg"
            )}
          >
            {collapsed ? (
              <ChevronsRight className="w-3 h-3" />
            ) : (
              <ChevronsLeft className="w-3 h-3" />
            )}
          </button>
        </aside>

        {/* Mobile Sidebar */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-admin-surface border border-admin-border text-admin-text">
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 bg-admin-surface border-admin-border">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <div
          className={cn(
            "flex flex-col min-h-screen w-full min-w-0 transition-all duration-300",
            collapsed ? "lg:ml-16 lg:w-[calc(100vw-4rem)]" : "lg:ml-72 lg:w-[calc(100vw-18rem)]"
          )}
        >
          {/* Header */}
          <header className="sticky top-0 z-30 flex w-full items-center justify-between gap-4 px-6 py-4 border-b border-admin-border bg-admin-surface/95 backdrop-blur">
            {/* Breadcrumbs */}
            <div className="hidden md:flex items-center gap-2 text-sm min-w-0">
              {getBreadcrumbs().map((crumb, idx) => (
                <div key={crumb.path} className="flex items-center gap-2 min-w-0">
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-admin-text-subtle" />}
                  {crumb.isLast ? (
                    <span className="text-admin-text font-medium truncate">{crumb.label}</span>
                  ) : (
                    <Link
                      to={crumb.path}
                      className="text-admin-text-muted hover:text-admin-text transition-colors truncate"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-3">
              {/* Client View Link */}
              <Link to="/dashboard">
                <AdminButton variant="outline" size="sm" className="hidden md:flex">
                  <ArrowLeftRight className="w-4 h-4 mr-2" />
                  Client View
                </AdminButton>
              </Link>

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 px-3 py-2 rounded-lg border border-admin-border hover:border-admin-primary bg-admin-bg hover:bg-admin-surface transition-all">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={userAvatar} alt={user?.displayName || user?.username} />
                      <AvatarFallback className="bg-admin-primary text-white text-sm">
                        {user?.displayName?.charAt(0) || user?.username?.charAt(0) || 'A'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden md:block text-left">
                      <div className="text-admin-text text-sm font-medium">
                        {user?.displayName?.split(' ')[0] || user?.username}
                      </div>
                      <div className="text-admin-text-muted text-xs">Administrator</div>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-[#111113] border-admin-border backdrop-blur-none">
                  <DropdownMenuLabel className="text-admin-text">My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-admin-border" />
                  <DropdownMenuItem
                    onClick={() => navigate('/account/profile')}
                    className="text-admin-text hover:bg-admin-border focus:bg-admin-border"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Profile Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => navigate('/account/notifications')}
                    className="text-admin-text hover:bg-admin-border focus:bg-admin-border"
                  >
                    <Bell className="w-4 h-4 mr-2" />
                    Notifications
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-admin-border" />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-admin-danger hover:bg-admin-danger/10 focus:bg-admin-danger/10"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Main Content Area */}
          <main className="flex-1 w-full min-w-0 p-6 bg-gradient-to-b from-admin-bg via-admin-bg-secondary to-admin-bg">
            {!adminPinLoading && (adminPinVerified || isAdminPinResetRoute) ? (
              <Outlet />
            ) : (
              <div className="h-full w-full" />
            )}
          </main>
        </div>
      </div>
      {!adminPinLoading && (
        <Dialog open={!adminPinVerified && !isAdminPinResetRoute} onOpenChange={() => {}}>
          <DialogContent className="bg-[#111113] border-[#27272a] max-w-md">
            <DialogHeader>
              <DialogTitle className="text-admin-text">
                {adminPinSetupRequired
                  ? 'Create Admin PIN'
                  : 'Enter Admin PIN'}
              </DialogTitle>
              <DialogDescription className="text-admin-text-muted">
                {adminPinSetupRequired
                  ? 'First admin login: create a 4-digit code to unlock admin mode.'
                  : 'Enter your 4-digit admin code to access the admin panel.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {adminPinSetupRequired ? (
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={adminPinNewValue}
                  onChange={(e) => setAdminPinNewValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="New 4-digit PIN"
                  className="input-futuristic"
                />
              ) : (
                <>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={adminPinValue}
                    onChange={(e) => setAdminPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Enter 4-digit PIN"
                    className="input-futuristic"
                  />
                  <button
                    type="button"
                    onClick={() => navigate('/admin/pin-reset')}
                    className="text-xs text-admin-text-muted hover:text-admin-text"
                  >
                    Reset via email
                  </button>
                </>
              )}

              {adminPinError && <p className="text-xs text-[#F87171]">{adminPinError}</p>}
              {adminPinInfo && <p className="text-xs text-[#34D399]">{adminPinInfo}</p>}
            </div>

            <DialogFooter>
              {adminPinSetupRequired ? (
                <button type="button" onClick={handleAdminPinSetup} className="btn-primary">
                  Save PIN
                </button>
              ) : (
                <button type="button" onClick={handleAdminPinVerify} className="btn-primary">
                  Unlock Admin
                </button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </TooltipProvider>
  );
}
