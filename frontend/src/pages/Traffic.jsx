import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, Radio, BarChart3 } from 'lucide-react';
import RealtimeTraffic from './RealtimeTraffic';
import CurrentTraffic from './CurrentTraffic';
import Analytics from './Analytics';

// Groups the 3 previously-scattered traffic/observability pages
// (/live-traffic, /current-traffic, /analytics) behind one nav entry, as
// tabs — same route-based tab pattern as DomainDetail.jsx. Each tab renders
// the existing page component unmodified; this is purely a navigation
// regroup, no changes to their internals.
const TABS = [
  { id: 'live', label: 'Live', icon: Radio, path: '/traffic' },
  { id: 'connections', label: 'Connexions actives', icon: Activity, path: '/traffic/connections' },
  { id: 'reports', label: 'Rapports', icon: BarChart3, path: '/traffic/reports' },
];

function getTabFromPath(pathname) {
  if (pathname.endsWith('/connections')) return 'connections';
  if (pathname.endsWith('/reports')) return 'reports';
  return 'live';
}

export default function Traffic() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => getTabFromPath(location.pathname));

  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  const navigateToTab = (tab) => {
    const target = TABS.find((t) => t.id === tab);
    navigate(target?.path || '/traffic', { replace: true });
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight">Traffic</h1>
              <p className="text-sm text-white/50 font-light mt-1">Live, connexions actives et rapports historiques</p>
            </div>
          </div>

          <div className="flex gap-2 mt-6 border-b border-white/[0.08]">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => navigateToTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-xs font-light transition-all border-b-2 ${
                    activeTab === tab.id
                      ? 'border-[#9D4EDD] text-white'
                      : 'border-transparent text-white/60 hover:text-white hover:border-white/20'
                  }`}
                >
                  <Icon className="w-4 h-4" strokeWidth={1.5} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab === 'live' && <RealtimeTraffic />}
      {activeTab === 'connections' && <CurrentTraffic />}
      {activeTab === 'reports' && <Analytics />}
    </div>
  );
}
