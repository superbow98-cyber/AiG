// AiG — ConfidenceBar.jsx
// Horizontal confidence bar for material prediction display.
//
// Props:
//   label      — string  material name e.g. 'ceramic'
//   confidence — number  0–1
//   color      — string  hex colour e.g. '#34d399'
//   showLabel  — bool    show label text left of bar (default true)
//   showPct    — bool    show percentage right of bar (default true)
//   height     — number  bar height px (default 6)
//
// Consumed by: Classify.jsx, ResultCard.jsx, Results.jsx

export default function ConfidenceBar({
  label      = '',
  confidence = 0,
  color      = '#34d399',
  showLabel  = true,
  showPct    = true,
  height     = 6,
}) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);

  return (
    <div className="flex items-center gap-3 w-full">
      {showLabel && (
        <span className="text-xs text-gray-300 capitalize w-20 flex-shrink-0 truncate">
          {label || 'unknown'}
        </span>
      )}

      <div
        className="flex-1 bg-gray-700 rounded-full overflow-hidden"
        style={{ height }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>

      {showPct && (
        <span className="text-xs font-mono text-gray-400 w-9 text-right flex-shrink-0">
          {pct}%
        </span>
      )}
    </div>
  );
}
