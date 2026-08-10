import { useState, useEffect } from 'react';
import { useParams, useNavigate, NavLink, Routes, Route } from 'react-router-dom';
import { ChevronRight, Users, Globe, Settings, AlertCircle, CheckCircle, X } from 'lucide-react';
import { teamAPI } from '../api/client';
import TeamOverview from './team/TeamOverview';
import TeamMembers from './team/TeamMembers';
import TeamDomains from './team/TeamDomains';
import TeamSettings from './team/TeamSettings';

export default function TeamDetail() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (teamId) {
      fetchTeam();
    }
  }, [teamId]);

  const fetchTeam = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await teamAPI.get(parseInt(teamId, 10));
      setTeam(response.data.team);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  const refreshTeam = () => {
    fetchTeam();
  };

  if (loading) {
    return (
      <div className="page-shell">
        <div className="flex items-center justify-center h-64">
          <div className="text-white/40">Loading...</div>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="page-shell">
        <div className="flex items-center justify-center h-64">
          <div className="text-white/40">Team not found</div>
        </div>
      </div>
    );
  }

  const tabs = [
    { path: `/teams/${teamId}`, label: 'Overview', icon: Users, end: true },
    { path: `/teams/${teamId}/members`, label: 'Members', icon: Users },
    { path: `/teams/${teamId}/domains`, label: 'Domains', icon: Globe },
    { path: `/teams/${teamId}/settings`, label: 'Settings', icon: Settings }
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate('/teams')}
                  className="btn-secondary flex items-center gap-2 text-xs px-3 py-2"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" strokeWidth={1.5} />
                  Back
                </button>
                <div>
                  <h1 className="text-xl md:text-2xl font-light text-white tracking-tight">{team.name}</h1>
                  <p className="text-xs text-white/50 font-light tracking-wide">
                    {team.domain_count}/{team.domain_quota} domains • {team.member_count} members
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs Navigation */}
            <div className="flex items-center gap-2 border-b border-white/[0.08]">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-4 py-3 text-sm transition-all duration-300 border-b-2 ${
                      isActive
                        ? 'text-[#C77DFF] border-[#C77DFF]'
                        : 'text-white/50 border-transparent hover:text-white/70 hover:border-white/20'
                    }`
                  }
                >
                  <tab.icon className="w-4 h-4" strokeWidth={1.5} />
                  {tab.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Messages */}
        {success && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] w-full max-w-md mx-auto px-4 animate-fade-in">
            <div className="bg-[#10B981]/10 backdrop-blur-2xl border border-[#10B981]/20 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-[#34D399] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-xs text-[#34D399] font-light">{success}</p>
              <button onClick={() => setSuccess('')} className="ml-auto text-[#34D399]/50 hover:text-[#34D399] transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] w-full max-w-md mx-auto px-4 animate-fade-in">
            <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-[#F87171] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-xs text-[#F87171] font-light">{error}</p>
              <button onClick={() => setError('')} className="ml-auto text-[#F87171]/50 hover:text-[#F87171] transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* Routes */}
        <Routes>
          <Route index element={<TeamOverview team={team} refreshTeam={refreshTeam} setError={setError} setSuccess={setSuccess} />} />
          <Route path="members" element={<TeamMembers team={team} refreshTeam={refreshTeam} setError={setError} setSuccess={setSuccess} />} />
          <Route path="domains" element={<TeamDomains team={team} refreshTeam={refreshTeam} setError={setError} setSuccess={setSuccess} />} />
          <Route path="settings" element={<TeamSettings team={team} refreshTeam={refreshTeam} setError={setError} setSuccess={setSuccess} navigate={navigate} />} />
        </Routes>
      </div>
    </div>
  );
}
