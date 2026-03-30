import { Globe, Server, Edit, Trash2, Power, Shield, Gamepad2, Zap, Radio } from 'lucide-react';
import SSLStatusBadge from './SSLStatusBadge';

export default function DomainCard({ domain, onEdit, onDelete, onToggle, onToggleSSL }) {
  // Determine icon and color based on proxy type
  const getProxyIcon = () => {
    switch (domain.proxy_type) {
      case 'tcp':
        return { icon: Zap, color: '#F59E0B', bgColor: 'bg-[#F59E0B]/10', borderColor: 'border-[#F59E0B]/20' };
      case 'udp':
        return { icon: Radio, color: '#9D4EDD', bgColor: 'bg-[#9D4EDD]/10', borderColor: 'border-[#9D4EDD]/20' };
      case 'minecraft':
        return { icon: Gamepad2, color: '#10B981', bgColor: 'bg-[#10B981]/10', borderColor: 'border-[#10B981]/20' };
      default:
        return { icon: Globe, color: '#6366f1', bgColor: 'bg-[#6366f1]/10', borderColor: 'border-[#6366f1]/20' };
    }
  };

  const { icon: Icon, color, bgColor, borderColor } = getProxyIcon();

  return (
    <div className="bg-[#191a22] border border-[#23234b] rounded-xl p-5 hover:border-[#6366f1]/50 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center border ${borderColor}`}>
            <Icon className="w-5 h-5" style={{ color }} strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-100">{domain.hostname}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {domain.proxy_type?.toUpperCase() || 'HTTP'} • {domain.is_active ? 'Active' : 'Inactive'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SSLStatusBadge status={domain.ssl_status} />
          <div className={`w-2 h-2 rounded-full ${domain.is_active ? 'bg-green-400' : 'bg-gray-600'}`} />
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Server className="w-4 h-4 text-gray-400" strokeWidth={2} />
          <span className="text-gray-400">Backend:</span>
          <span className="text-gray-200 font-mono text-xs">
            {domain.backend_url}
            {domain.backend_port && `:${domain.backend_port}`}
          </span>
        </div>

        {(domain.proxy_type === 'minecraft' || domain.proxy_type === 'tcp' || domain.proxy_type === 'udp') && domain.external_port && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">External Port:</span>
            <span className="text-gray-200 font-mono text-xs">
              {domain.proxy_type === 'minecraft' ? '25565 (shared)' : domain.external_port}
            </span>
          </div>
        )}

        {domain.username && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Owner:</span>
            <span className="text-gray-200">{domain.user_display_name || domain.username}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-[#23234b]">
        <button
          onClick={() => onEdit(domain)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 bg-[#14151a] hover:bg-[#23234b] border border-[#23234b] rounded-lg transition-colors"
        >
          <Edit className="w-4 h-4" strokeWidth={2} />
          Edit
        </button>

        <button
          onClick={() => onToggle(domain)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 bg-[#14151a] hover:bg-[#23234b] border border-[#23234b] rounded-lg transition-colors"
        >
          <Power className="w-4 h-4" strokeWidth={2} />
          {domain.is_active ? 'Disable' : 'Enable'}
        </button>

        {!domain.ssl_enabled && (
          <button
            onClick={() => onToggleSSL(domain)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 bg-[#14151a] hover:bg-[#23234b] border border-[#23234b] rounded-lg transition-colors"
          >
            <Shield className="w-4 h-4" strokeWidth={2} />
            SSL
          </button>
        )}

        <button
          onClick={() => onDelete(domain)}
          className="px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-900/40 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
