import { useState, useEffect, useMemo } from 'react';
import { Link, NavLink, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { authAPI, userAPI } from '../../api/client';
import { getAvatarUrl } from '../../utils/gravatar';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Globe,
  Link as LinkIcon,
  Users,
  Shield,
  ShieldAlert,
  LogOut,
  Menu,
  ChevronRight,
  ArrowLeftRight,
  User,
  BarChart3,
  Activity,
  Zap,
  Cable
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
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
import CompleteProfileModal from '../features/CompleteProfileModal';
import NotificationBell from '../features/NotificationBell';
import { useBrandingStore } from '../../store/brandingStore';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuthStore();
  const appName = useBrandingStore((s) => s.appName);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('client-sidebar-collapsed');
    return saved === 'true';
  });
  const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
  const [passkeyPromptLoading, setPasskeyPromptLoading] = useState(false);

  const isProfileIncomplete = !user?.email || !user?.displayName;

  useEffect(() => {
    localStorage.setItem('client-sidebar-collapsed', collapsed.toString());
  }, [collapsed]);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const response = await userAPI.getMe();
        if (response.data.user) {
          updateUser(response.data.user);
        }
      } catch {
        // silent fallback
      }
    };
    loadUserProfile();
  }, [updateUser]);

  useEffect(() => {
    const checkPasskeyPrompt = async () => {
      if (!user?.id || isProfileIncomplete) return;
      try {
        const response = await userAPI.getPasskeyPromptStatus();
        if (response.data?.shouldPrompt) {
          setShowPasskeyPrompt(true);
        }
      } catch {
        // silent fallback
      }
    };
    checkPasskeyPrompt();
  }, [user?.id, isProfileIncomplete]);

  const handlePasskeyPromptAction = async (action) => {
    try {
      setPasskeyPromptLoading(true);
      await userAPI.respondPasskeyPrompt(action);
      setShowPasskeyPrompt(false);
      if (action === 'setup_now') {
        navigate('/account/security?focus=passkey');
      }
    } catch {
      setShowPasskeyPrompt(false);
    } finally {
      setPasskeyPromptLoading(false);
    }
  };

  const navigationSections = useMemo(() => ([
    {
      title: 'Overview',
      items: [
        { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { path: '/analytics', icon: BarChart3, label: 'Analytics' },
        { path: '/live-traffic', icon: Activity, label: 'Live Traffic' },
        { path: '/current-traffic', icon: Zap, label: 'Requêtes actuelles' }
      ]
    },
    {
      title: 'Management',
      items: [
        { path: '/domains', icon: Globe, label: 'Domains' },
        { path: '/tunnels', icon: Cable, label: 'Tunnels' },
        { path: '/redirections', icon: LinkIcon, label: 'Redirections' },
        { path: '/url-blocking', icon: ShieldAlert, label: 'URL Blocking' },
        { path: '/teams', icon: Users, label: 'Teams' },
        { path: '/ssl-certificates', icon: Shield, label: 'SSL Certificates' }
      ]
    },
    ...(user?.role === 'admin'
      ? [{
          title: 'Administration',
          items: [
            { path: '/admin/dashboard', icon: Shield, label: 'Admin Area' }
          ]
        }]
      : [])
  ].filter((section) => Array.isArray(section.items) && section.items.length > 0)), [user?.role]);

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch {
      // ignore
    } finally {
      logout();
      navigate('/login');
    }
  };

  const getBreadcrumbs = () => {
    const paths = location.pathname.split('/').filter(Boolean);
    const breadcrumbs = [
      { label: 'Client', path: '/dashboard', isLast: paths.length === 0 }
    ];
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

  const isActivePath = (path) => location.pathname === path || location.pathname.startsWith(path + '/');
  const userAvatar = getAvatarUrl(user?.avatarUrl, user?.email, 72, user?.avatarUpdatedAt);

  const SidebarContent = ({ onNavigate }) => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-admin-border">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-admin-primary/10">
          <img src="/nebula.svg" alt={appName} className="w-5 h-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="text-admin-text font-semibold text-lg">{appName}</h1>
            <p className="text-admin-text-muted text-xs">Control Panel</p>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-6 px-3">
          {navigationSections.map((section) => (
            <div key={section.title}>
              {!collapsed && (
                <div className="px-3 mb-2">
                  <p className="text-admin-text-subtle text-xs font-semibold uppercase tracking-wider">{section.title}</p>
                </div>
              )}
              {collapsed && <Separator className="bg-admin-border mb-3" />}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(item.path);
                  const linkContent = (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
                        'hover:bg-admin-primary/10',
                        active && 'bg-admin-primary/20 text-admin-primary',
                        !active && 'text-admin-text hover:text-admin-primary',
                        collapsed && 'justify-center'
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {!collapsed && <span className="font-medium text-sm">{item.label}</span>}
                      {active && !collapsed && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-admin-primary" />}
                    </NavLink>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.path} delayDuration={0}>
                        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
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
    </div>
  );

  return (
    <TooltipProvider>
      <div className="admin-layout w-screen max-w-[100vw] overflow-x-hidden" data-admin-theme data-client-theme>
        <aside
          className={cn(
            'fixed top-0 left-0 bottom-0 z-40 hidden lg:flex flex-col border-r border-admin-border bg-admin-surface transition-all duration-300',
            collapsed ? 'w-16' : 'w-72'
          )}
        >
          <SidebarContent onNavigate={() => {}} />
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'absolute -right-3 top-6 w-6 h-6 rounded-full border border-admin-border bg-admin-surface',
              'flex items-center justify-center text-admin-text-muted hover:text-admin-primary',
              'hover:border-admin-primary transition-all shadow-lg'
            )}
          >
            <ArrowLeftRight className="w-3 h-3" />
          </button>
        </aside>

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

        <div
          className={cn(
            'flex flex-col min-h-screen w-full min-w-0 transition-all duration-300',
            collapsed ? 'lg:ml-16 lg:w-[calc(100vw-4rem)]' : 'lg:ml-72 lg:w-[calc(100vw-18rem)]'
          )}
        >
          <header className="sticky top-0 z-30 flex w-full items-center justify-between gap-4 px-6 py-4 border-b border-admin-border bg-admin-surface/95 backdrop-blur">
            <div className="hidden md:flex items-center gap-2 text-sm min-w-0">
              {getBreadcrumbs().map((crumb, idx) => (
                <div key={crumb.path} className="flex items-center gap-2 min-w-0">
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-admin-text-subtle" />}
                  {crumb.isLast ? (
                    <span className="text-admin-text font-medium truncate">{crumb.label}</span>
                  ) : (
                    <Link to={crumb.path} className="text-admin-text-muted hover:text-admin-text transition-colors truncate">
                      {crumb.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {user?.role === 'admin' && (
                <Link to="/admin/dashboard">
                  <AdminButton variant="outline" size="sm" className="hidden md:flex">
                    <ArrowLeftRight className="w-4 h-4 mr-2" />
                    Admin View
                  </AdminButton>
                </Link>
              )}

              <NotificationBell />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 px-3 py-2 rounded-lg border border-admin-border hover:border-admin-primary bg-admin-bg hover:bg-admin-surface transition-all">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={userAvatar} alt={user?.displayName || user?.username} />
                      <AvatarFallback className="bg-admin-primary text-white text-sm">
                        {user?.displayName?.charAt(0) || user?.username?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden md:block text-left">
                      <div className="text-admin-text text-sm font-medium">{user?.displayName?.split(' ')[0] || user?.username}</div>
                      <div className="text-admin-text-muted text-xs">
                        {user?.role === 'admin' ? 'Administrator' : 'User'}
                      </div>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-[#111113] border-admin-border backdrop-blur-none">
                  <DropdownMenuLabel className="text-admin-text">My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-admin-border" />
                  <DropdownMenuItem onClick={() => navigate('/account')} className="text-admin-text hover:bg-admin-border focus:bg-admin-border">
                    <User className="w-4 h-4 mr-2" />
                    Profile Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-admin-border" />
                  <DropdownMenuItem onClick={handleLogout} className="text-admin-danger hover:bg-admin-danger/10 focus:bg-admin-danger/10">
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 w-full min-w-0 p-6 bg-admin-bg">
            <Outlet />
          </main>
        </div>
      </div>

      {isProfileIncomplete && <CompleteProfileModal />}
      <Dialog open={showPasskeyPrompt} onOpenChange={(open) => !open && handlePasskeyPromptAction('later')}>
        <DialogContent className="bg-[#111113] border-[#27272a] max-w-md shadow-none">
          <DialogHeader>
            <DialogTitle className="text-admin-text">Add a Passkey</DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Secure your account with a passkey for faster sign-in. If you skip now, we will remind you in 30 days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              disabled={passkeyPromptLoading}
              onClick={() => handlePasskeyPromptAction('later')}
              className="btn-secondary"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={passkeyPromptLoading}
              onClick={() => handlePasskeyPromptAction('setup_now')}
              className="btn-primary"
            >
              Set up passkey
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
