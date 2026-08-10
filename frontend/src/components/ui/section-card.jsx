export function SectionCard({ children, className = '' }) {
  return (
    <div className={`bg-[#111113] border border-[#27272a] rounded-xl overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeader({ icon: Icon, title, description, action }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[#27272a]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-white/60" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{title}</p>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatusDot({ active }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />;
}
