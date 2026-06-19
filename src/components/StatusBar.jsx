// AiG — StatusBar.jsx
// Progress bar + step label shown during file parsing, preprocessing, detection runs.
// Props:
//   step     — string  — current step label e.g. "Parsing file…" / "Running detection…"
//   progress — number  — 0–100
//   visible  — boolean — mount/unmount controlled by parent

export default function StatusBar({ step = '', progress = 0, visible = true }) {
  if (!visible) return null;

  const pct = Math.max(0, Math.min(100, progress));

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{step}</span>
        <span className="text-xs tabular-nums text-gray-500">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
