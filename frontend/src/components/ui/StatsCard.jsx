export default function StatsCard({
  icon: Icon,
  title,
  value,
  subtitle,
  badge,
  variant = 'purple', // purple, success, warning, error, info
  delay = '0s'
}) {
  const variantStyles = {
    purple: {
      container: 'bg-white/5 border-white/15',
      icon: 'text-white/80'
    },
    success: {
      container: 'bg-white/5 border-white/15',
      icon: 'text-white/80'
    },
    warning: {
      container: 'bg-white/5 border-white/15',
      icon: 'text-white/80'
    },
    error: {
      container: 'bg-white/5 border-white/15',
      icon: 'text-white/80'
    },
    info: {
      container: 'bg-white/5 border-white/15',
      icon: 'text-white/80'
    }
  };

  const styles = variantStyles[variant] || variantStyles.purple;

  return (
    <div
      className="group bg-admin-surface rounded-xl p-4 hover:bg-admin-surface2 transition-all duration-300 animate-fade-in"
      style={{ animationDelay: delay }}
    >
      <div className="flex items-center gap-3">
        {/* Icon Container */}
        <div className={`w-12 h-12 rounded-xl ${styles.container} border flex items-center justify-center transition-all duration-500`}>
          <Icon className={`w-6 h-6 ${styles.icon}`} strokeWidth={1.5} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-admin-text-muted uppercase tracking-widest mb-1">
            {title}
          </p>
          <p className="text-2xl font-light text-admin-text tracking-tight capitalize">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-admin-text-muted font-light mt-1 tracking-wide">
              {subtitle}
            </p>
          )}
        </div>

        {/* Badge (optional) */}
        {badge && (
          <div className={`
            px-2.5 py-1 rounded-full text-xs font-medium tracking-wide border
            ${variant === 'success' ? 'bg-emerald-400/15 text-emerald-300 border-emerald-300/35' : ''}
            ${variant === 'warning' ? 'bg-amber-400/15 text-amber-300 border-amber-300/35' : ''}
            ${variant === 'purple' ? 'bg-zinc-300/15 text-zinc-200 border-zinc-300/35' : ''}
            ${variant === 'error' ? 'bg-rose-400/15 text-rose-300 border-rose-300/35' : ''}
            ${variant === 'info' ? 'bg-slate-300/15 text-slate-200 border-slate-300/35' : ''}
          `}>
            {badge}
          </div>
        )}
      </div>
    </div>
  );
}
