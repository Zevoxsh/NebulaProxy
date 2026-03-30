import { X } from 'lucide-react';

export default function GroupBadge({ group, onRemove, size = 'md' }) {
  const sizeClasses = {
    sm: 'text-[9px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5'
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${sizeClasses[size]} font-light transition-all duration-300 bg-admin-surface2 text-admin-text-muted border-admin-border`}
    >
      {group.icon && <span className="flex-shrink-0">{group.icon}</span>}
      <span className="truncate max-w-[120px]">{group.name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 hover:opacity-70 transition-opacity flex-shrink-0"
          title={`Remove from ${group.name}`}
        >
          <X className="w-3 h-3" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
