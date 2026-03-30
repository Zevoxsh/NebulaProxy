import { Shield, ShieldAlert, ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';

export default function SSLStatusBadge({ status }) {
  const statusConfig = {
    disabled: {
      icon: ShieldOff,
      text: 'Disabled',
      badgeClass: 'px-4 py-1.5 bg-white/[0.05] text-white/40 rounded-full text-xs font-medium tracking-wide border border-white/[0.08] backdrop-blur-sm',
      iconColor: 'text-white/40'
    },
    pending: {
      icon: Loader2,
      text: 'Pending',
      badgeClass: 'badge-warning',
      iconColor: 'text-[#FBBF24]',
      spin: true
    },
    active: {
      icon: ShieldCheck,
      text: 'Active',
      badgeClass: 'badge-purple',
      iconColor: 'text-[#C77DFF]'
    },
    error: {
      icon: ShieldAlert,
      text: 'Error',
      badgeClass: 'badge-error',
      iconColor: 'text-admin-danger'
    }
  };

  const config = statusConfig[status] || statusConfig.disabled;
  const Icon = config.icon;

  return (
    <div className={config.badgeClass}>
      <Icon
        className={`w-4 h-4 ${config.iconColor} ${config.spin ? 'animate-spin' : ''}`}
        strokeWidth={1.5}
      />
      <span className="text-xs font-medium uppercase tracking-wide">
        {config.text}
      </span>
    </div>
  );
}
