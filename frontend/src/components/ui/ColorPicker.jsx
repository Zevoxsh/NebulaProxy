import { Check } from 'lucide-react';

const PRESET_COLORS = [
  '#9D4EDD', // Purple
  '#C77DFF', // Light Purple
  '#22D3EE', // Cyan
  '#06B6D4', // Dark Cyan
  '#34D399', // Green
  '#10B981', // Dark Green
  '#FBBF24', // Yellow
  '#F59E0B', // Orange
  '#F87171', // Red
  '#EF4444', // Dark Red
  '#60A5FA', // Blue
  '#3B82F6', // Dark Blue
  '#A78BFA', // Lavender
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#DB2777'  // Dark Pink
];

export default function ColorPicker({ value, onChange, label = 'Color' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-3">
        {label}
      </label>
      <div className="grid grid-cols-8 gap-2">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className={`w-10 h-10 rounded-lg transition-all duration-300 relative ${
              value === color
                ? 'ring-2 ring-offset-2 ring-offset-[#0B0C0F] scale-110'
                : 'hover:scale-105'
            }`}
            style={{
              backgroundColor: color,
              ringColor: color
            }}
            title={color}
          >
            {value === color && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Check className="w-5 h-5 text-white drop-shadow-lg" strokeWidth={3} />
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Custom color input */}
      <div className="mt-4 flex items-center gap-3">
        <label className="text-xs font-medium text-white/60 uppercase tracking-[0.15em]">
          Custom
        </label>
        <div className="flex items-center gap-2 flex-1">
          <input
            type="color"
            value={value || '#9D4EDD'}
            onChange={(e) => onChange(e.target.value)}
            className="w-12 h-10 rounded-lg cursor-pointer border border-white/[0.08] bg-transparent"
          />
          <input
            type="text"
            value={value || '#9D4EDD'}
            onChange={(e) => {
              const hex = e.target.value.trim();
              if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                onChange(hex);
              }
            }}
            placeholder="#9D4EDD"
            maxLength={7}
            className="input-futuristic text-xs flex-1"
          />
        </div>
      </div>
    </div>
  );
}
