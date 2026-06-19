// AiG — ObjectMap.jsx
// Top-down 2D SVG map of detected object positions along the survey line.
// Shows each detected object as a circle, scaled by estimated size,
// colour-coded by material label.
//
// Props:
//   detections   — Detection[] | ClassificationResult[]
//   scanLengthM  — total survey line length in metres (from metadata + getDxM())
//   velocity     — soil velocity m/ns (for depth display, default 0.1)
//
// Consumed by: Detect.jsx, Cluster.jsx, Results.jsx

const MATERIAL_COLORS = {
  ceramic: '#34d399',
  metal:   '#f87171',
  bone:    '#fbbf24',
  stone:   '#a78bfa',
  void:    '#38bdf8',
  unknown: '#94a3b8',
};

function getColor(label) {
  return MATERIAL_COLORS[label?.toLowerCase()] ?? MATERIAL_COLORS.unknown;
}

const PAD   = { top: 28, right: 24, bottom: 40, left: 52 };
const H     = 160;   // total SVG height px
const TRACK = 40;    // survey track height px (centred in plot area)

export default function ObjectMap({
  detections  = [],
  scanLengthM = 10,
  velocity    = 0.1,
}) {
  // ObjectMap needs a measured width — use a fixed 100% wide container
  // and a viewBox so it scales naturally.
  const VW = 800;   // internal viewBox width
  const plotW = VW  - PAD.left - PAD.right;
  const plotH = H   - PAD.top  - PAD.bottom;
  const trackY = PAD.top + plotH / 2;  // centre of survey track

  // X axis: metres along survey line
  const xScale = (m) => PAD.left + (m / (scanLengthM || 1)) * plotW;

  // Circle radius: proportional to size_width_cm, clamped 4–20px
  const rScale = (cm) => {
    if (!cm) return 6;
    return Math.max(4, Math.min(20, (cm / 100) * plotW * 0.5));
  };

  // X-axis tick marks — aim for ~6 ticks
  const tickCount = 6;
  const tickStep  = Math.ceil(scanLengthM / tickCount);
  const ticks     = [];
  for (let m = 0; m <= scanLengthM; m += tickStep) ticks.push(m);

  return (
    <div className="w-full bg-gray-800 rounded-xl border border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Survey Map — {detections.length} object{detections.length !== 1 ? 's' : ''} detected
      </h3>

      <svg
        viewBox={`0 0 ${VW} ${H}`}
        width="100%"
        height={H}
        aria-label="Top-down survey map"
      >
        {/* ── Survey track line ── */}
        <line
          x1={PAD.left}  y1={trackY}
          x2={PAD.left + plotW} y2={trackY}
          stroke="#475569"
          strokeWidth={2}
        />

        {/* ── X axis ticks + labels ── */}
        {ticks.map((m) => (
          <g key={m}>
            <line
              x1={xScale(m)} y1={trackY + TRACK / 2 + 4}
              x2={xScale(m)} y2={trackY + TRACK / 2 + 10}
              stroke="#64748b"
              strokeWidth={1}
            />
            <text
              x={xScale(m)}
              y={H - PAD.bottom + 20}
              textAnchor="middle"
              fontSize={10}
              fill="#94a3b8"
              fontFamily="monospace"
            >
              {m}m
            </text>
          </g>
        ))}

        {/* ── Y axis label ── */}
        <text
          x={PAD.left - 8}
          y={trackY}
          textAnchor="middle"
          fontSize={9}
          fill="#64748b"
          fontFamily="monospace"
          dominantBaseline="middle"
        >
          line
        </text>

        {/* ── Detected objects ── */}
        {detections.map((det, i) => {
          const cx = xScale(det.position_m ?? 0);
          const r  = rScale(det.size_width_cm);
          const color = getColor(det.label ?? det.material);
          const depthLabel = det.depth_m != null
            ? `${det.depth_m.toFixed(2)}m`
            : '';

          return (
            <g key={det.id ?? i}>
              {/* Depth indicator line from track to circle */}
              <line
                x1={cx} y1={trackY}
                x2={cx} y2={trackY - r - 4}
                stroke={color}
                strokeWidth={1}
                opacity={0.4}
              />

              {/* Object circle */}
              <circle
                cx={cx}
                cy={trackY - r - 4}
                r={r}
                fill={color}
                fillOpacity={0.25}
                stroke={color}
                strokeWidth={1.5}
              >
                <title>
                  {`Object ${i + 1} — ${det.label ?? det.material ?? 'unclassified'}\n`
                  + `Position: ${(det.position_m ?? 0).toFixed(2)}m\n`
                  + `Depth: ${depthLabel}\n`
                  + `Size: ${det.size_width_cm ?? '?'}×${det.size_height_cm ?? '?'} cm`}
                </title>
              </circle>

              {/* Depth label below circle */}
              {depthLabel && (
                <text
                  x={cx}
                  y={trackY + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill={color}
                  fontFamily="monospace"
                >
                  {depthLabel}
                </text>
              )}

              {/* Object index */}
              <text
                x={cx}
                y={trackY - r - 4}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fill="#fff"
                fontWeight="700"
                fontFamily="monospace"
              >
                {i + 1}
              </text>
            </g>
          );
        })}

        {/* ── Empty state ── */}
        {detections.length === 0 && (
          <text
            x={VW / 2}
            y={trackY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={12}
            fill="#475569"
            fontFamily="monospace"
          >
            No detections yet
          </text>
        )}
      </svg>

      {/* ── Legend ── */}
      {detections.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {Object.entries(MATERIAL_COLORS).map(([mat, col]) => {
            const hasThis = detections.some(
              (d) => (d.label ?? d.material)?.toLowerCase() === mat
            );
            if (!hasThis) return null;
            return (
              <div key={mat} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: col }}
                />
                <span className="text-xs text-gray-400 capitalize">{mat}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
