import { Users, Globe, Crown } from 'lucide-react';
import { getAvatarUrl } from '../../utils/gravatar';

export default function TeamOverview({ team }) {
  return (
    <div className="animate-fade-in">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Members Count */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-[#C77DFF]" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs text-white/50">Members</p>
              <p className="text-xl font-light text-white">{team.member_count}</p>
            </div>
          </div>
        </div>

        {/* Domains Count */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/5 border border-[#10B981]/20 flex items-center justify-center">
              <Globe className="w-5 h-5 text-[#34D399]" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs text-white/50">Domains</p>
              <p className="text-xl font-light text-white">
                {team.domain_count}
                <span className="text-sm text-white/40 ml-1">/ {team.domain_quota}</span>
              </p>
            </div>
          </div>
          <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#10B981] to-[#34D399] transition-all duration-500"
              style={{ width: `${Math.min((team.domain_count / (team.domain_quota || 1)) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Owner Info */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F59E0B]/10 to-[#F59E0B]/5 border border-[#F59E0B]/20 flex items-center justify-center">
              <Crown className="w-5 h-5 text-[#FBBF24]" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs text-white/50">Owner</p>
              <p className="text-sm font-normal text-white">{team.owner_username}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Members */}
      <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-4">
        <h3 className="text-sm font-normal text-white mb-4">Team Members</h3>
        <div className="space-y-2">
          {team.members?.slice(0, 5).map((member) => (
            <div key={member.id} className="flex items-center gap-3 p-2.5 bg-white/[0.02] rounded-lg">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#9D4EDD] to-[#7B2CBF] flex items-center justify-center flex-shrink-0 overflow-hidden">
                {getAvatarUrl(member.avatar_url, member.email, 64, member.avatar_updated_at) ? (
                  <img
                    src={getAvatarUrl(member.avatar_url, member.email, 64, member.avatar_updated_at)}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-medium text-white">
                    {member.display_name?.charAt(0) || member.username?.charAt(0) || 'U'}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-normal text-white truncate">{member.display_name || member.username}</p>
                <p className="text-[10px] text-white/40 truncate">{member.username}</p>
              </div>
              {member.role === 'owner' && (
                <Crown className="w-4 h-4 text-[#F59E0B] flex-shrink-0" strokeWidth={1.5} />
              )}
              {member.role !== 'owner' && (
                <div className="flex gap-1">
                  {member.can_manage_domains && (
                    <span className="text-[9px] px-2 py-0.5 bg-[#10B981]/10 text-[#34D399] border border-[#10B981]/20 rounded-full">Domains</span>
                  )}
                  {member.can_manage_members && (
                    <span className="text-[9px] px-2 py-0.5 bg-[#9D4EDD]/10 text-[#C77DFF] border border-[#9D4EDD]/20 rounded-full">Members</span>
                  )}
                  {member.can_manage_settings && (
                    <span className="text-[9px] px-2 py-0.5 bg-[#06B6D4]/10 text-[#22D3EE] border border-[#06B6D4]/20 rounded-full">Settings</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {team.member_count > 5 && (
            <div className="text-center text-xs text-white/40 py-2">
              +{team.member_count - 5} more members
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
