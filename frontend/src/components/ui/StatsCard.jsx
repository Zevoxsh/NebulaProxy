const VARIANT_COLOR = {
  purple: '#9D4EDD',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#22D3EE'
};

export default function StatsCard({
  icon: Icon,
  title,
  value,
  subtitle,
  badge,
  variant = 'purple', // purple, success, warning, error, info
  delay = '0s'
}) {
  const color = VARIANT_COLOR[variant] || VARIANT_COLOR.purple;

  return (
    <div
      className="group bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] hover:border-white/[0.14] rounded-xl p-4 transition-all duration-300 animate-fade-in"
      style={{ animationDelay: delay }}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center border flex-shrink-0 transition-all duration-500"
          style={{ background: `${color}18`, borderColor: `${color}44` }}>
          <Icon className="w-6 h-6" style={{ color }} strokeWidth={1.5} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/50 uppercase tracking-widest mb-1">
            {title}
          </p>
          <p className="text-2xl font-light text-white tracking-tight capitalize">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-white/40 font-light mt-1 tracking-wide">
              {subtitle}
            </p>
          )}
        </div>

        {badge && (
          <div className="px-2.5 py-1 rounded-full text-xs font-medium tracking-wide border flex-shrink-0"
            style={{ background: `${color}18`, borderColor: `${color}44`, color }}>
            {badge}
          </div>
        )}
      </div>
    </div>
  );
}
