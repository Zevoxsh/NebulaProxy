import { ChevronLeft, ChevronRight } from 'lucide-react';

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  label = 'items',
  className = '',
}) {
  if (totalPages <= 1) {
    return null;
  }

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={`flex items-center justify-between gap-3 mt-4 ${className}`}>
      <p className="text-xs text-white/60">
        {start}-{end} / {totalItems} {label}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="btn-secondary px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Prev
        </button>
        <span className="text-xs text-white/70 min-w-[72px] text-center">
          {currentPage} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="btn-secondary px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

