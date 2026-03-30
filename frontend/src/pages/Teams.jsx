import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, Globe, Crown, ChevronRight, X, AlertCircle, CheckCircle } from 'lucide-react';
import { teamAPI } from '../api/client';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function Teams() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: '', maxDomains: '' });
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await teamAPI.list();
      setTeams(response.data.teams);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await teamAPI.create({
        name: teamForm.name,
        maxDomains: teamForm.maxDomains ? parseInt(teamForm.maxDomains) : null
      });
      setSuccess('Team created successfully');
      setShowCreateTeam(false);
      setTeamForm({ name: '', maxDomains: '' });
      fetchTeams();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create team');
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(teams.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTeams = teams.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-xl md:text-2xl font-light text-white tracking-tight">Teams</h1>
                <p className="text-xs text-white/50 font-light tracking-wide">Collaborate and share domains</p>
              </div>
              <button
                onClick={() => { setShowCreateTeam(true); setError(''); }}
                className="btn-primary flex items-center gap-2 text-xs px-4 py-2"
              >
                <UserPlus className="w-4 h-4" strokeWidth={1.5} />
                Create Team
              </button>
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

        {/* Teams Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-white/40">Loading...</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
            {paginatedTeams.map(team => (
              <div
                key={team.id}
                onClick={() => navigate(`/teams/${team.id}`)}
                className="group card-standard hover:bg-[#161722]/70 hover:border-[#9D4EDD]/20 hover: transition-all duration-500 cursor-pointer"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover: transition-all duration-500 overflow-hidden ${team.logo_url ? 'bg-white/[0.03] border border-white/[0.08]' : 'bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20'}`}>
                    {team.logo_url ? (
                      <img
                        src={`${team.logo_url}${team.logo_updated_at ? `?t=${new Date(team.logo_updated_at).getTime()}` : ''}`}
                        alt={`${team.name} logo`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Users className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-[#C77DFF] transition-colors duration-500" strokeWidth={1.5} />
                </div>

                <h3 className="text-base font-normal text-white mb-3">{team.name}</h3>

                <div className="flex items-center gap-4 text-xs text-white/50 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>{team.member_count}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>{team.domain_count}/{team.domain_quota}</span>
                  </div>
                </div>

                <div className="w-full h-1 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#9D4EDD] to-[#C77DFF] transition-all duration-500"
                    style={{ width: `${Math.min((team.domain_count / (team.domain_quota || 1)) * 100, 100)}%` }}
                  />
                </div>

                {team.user_role === 'owner' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.05]">
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#C77DFF] font-medium uppercase tracking-wider">
                      <Crown className="w-3 h-3" strokeWidth={1.5} />
                      Owner
                    </span>
                  </div>
                )}
              </div>
            ))}

            {teams.length === 0 && (
              <div className="col-span-full text-center py-12">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                </div>
                <p className="text-white/40 font-light text-xs">No teams yet</p>
              </div>
            )}
            </div>
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={teams.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              label="teams"
            />
          </>
        )}
      </div>

      {/* Create Team Modal */}
      {showCreateTeam && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-md w-full animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-light text-white">Create Team</h2>
              <button onClick={() => { setShowCreateTeam(false); setError(''); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Team Name</label>
                <input
                  type="text"
                  value={teamForm.name}
                  onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                  placeholder="Enter team name"
                  required
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Max Domains (Optional)</label>
                <input
                  type="number"
                  value={teamForm.maxDomains}
                  onChange={(e) => setTeamForm({ ...teamForm, maxDomains: e.target.value })}
                  placeholder="Leave empty for cumulative quotas"
                  min="0"
                  max="30"
                  disabled={submitting}
                  className="input-futuristic text-xs"
                />
                <p className="text-xs text-white/60 font-light mt-1.5">Max 30. If empty, quota = sum of members' quotas</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => { setShowCreateTeam(false); setError(''); }} disabled={submitting} className="btn-secondary flex-1 text-xs px-4 py-2.5">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 text-xs px-4 py-2.5">{submitting ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
