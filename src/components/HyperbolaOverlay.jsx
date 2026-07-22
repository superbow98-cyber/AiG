// AiG — HyperbolaOverlay.jsx
// SVG bounding boxes rendered absolutely over BScanViewer canvas.
// Each detection gets a coloured box + label + confidence badge.
//
// Props:
//   detections    — Detection[] from useResults / Detect.jsx
//   canvasWidth   — rendered pixel width of BScanViewer canvas
//   canvasHeight  — rendered pixel height of BScanViewer canvas
//   totalTraces   — total trace count in the matrix (for coordinate mapping)
//   totalSamples  — total sample count in the matrix
//   panOffset     — { x, y } pixel offset from BScanViewer pan state
//   zoom          — current zoom scale from BScanViewer
//
// Consumed by: Detect.jsx

const MATERIAL_COLORS = {
  ceramic: '#34d399',   // emerald
  metal:   '#f87171',   // red
  bone:    '#fbbf24',   // amber
  stone:   '#a78bfa',   // violet
  void:    '#38bdf8',   // sky
  unknown: '#94a3b8',   // slate
};

function getColor(label) {
  return MATERIAL_COLORS[label?.toLowerCase()] ?? MATERIAL_COLORS.unknown;
}

/**
 * Map a trace/sample index to SVG pixel coordinates,
 * accounting for BScanViewer's current pan + zoom state.
 */
function toPixel(index, total, canvasDim, zoom, panOffset) {
  const scaled = (index / (total || 1)) * canvasDim * zoom;
  return scaled + panOffset;
}

export default function HyperbolaOverlay({
  detections   = [],
  canvasWidth  = 0,
  canvasHeight = 0,
  totalTraces  = 1,
  totalSamples = 1,
  panOffset    = { x: 0, y: 0 },
  zoom         = 1,
}) {
  if (!detections.length || !canvasWidth || !canvasHeight) return null;

  return (
    <svg
      width={canvasWidth}
      height={canvasHeight}
      style={{
        position:      'absolute',
        top:           0,
        left:          0,
        pointerEvents: 'none',   // let mouse events pass through to canvas
        overflow:      'hidden',
      }}
    >
      {detections.map((det, i) => {
        // statusColor/statusText (§39) let a caller show a neutral
        // processing-status pill (e.g. "Extracted"/"Pending") instead of
        // forcing the box through the material-name palette below — used by
        // ResNet-18 Spatial AI, which has no classifier of its own and was
        // previously faking "stone"/"void" labels just to get a colour.
        const color = det.statusColor ?? getColor(det.label);

        // Convert trace/sample coords → pixel coords
        const x1 = toPixel(det.trace - det.halfWidthTraces,  totalTraces,  canvasWidth,  zoom, panOffset.x);
        const y1 = toPixel(det.apexSample - det.halfDepthSamples, totalSamples, canvasHeight, zoom, panOffset.y);
        const x2 = toPixel(det.trace + det.halfWidthTraces,  totalTraces,  canvasWidth,  zoom, panOffset.x);
        const y2 = toPixel(det.apexSample + det.halfDepthSamples, totalSamples, canvasHeight, zoom, panOffset.y);

        const boxX = Math.min(x1, x2);
        const boxY = Math.min(y1, y2);
        const boxW = Math.max(Math.abs(x2 - x1), 8);
        const boxH = Math.max(Math.abs(y2 - y1), 8);

        const labelText = det.statusText
          ? det.statusText
          : det.label
            ? `${det.label} ${Math.round((det.confidence ?? 0) * 100)}%`
            : `Object ${i + 1}`;

        // Keep label inside SVG bounds
        const labelX = Math.min(boxX + 4, canvasWidth - 80);
        const labelY = boxY > 18 ? boxY - 5 : boxY + boxH + 14;

        return (
          <g key={det.id ?? i}>
            {/* Bounding box */}
            <rect
              x={boxX}
              y={boxY}
              width={boxW}
              height={boxH}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              opacity={0.9}
            />

            {/* Label background pill */}
            <rect
              x={labelX - 2}
              y={labelY - 11}
              width={labelText.length * 6.5 + 6}
              height={14}
              rx={3}
              fill={color}
              opacity={0.85}
            />

            {/* Label text */}
            <text
              x={labelX + 1}
              y={labelY}
              fontSize={10}
              fontFamily="monospace"
              fill="#000"
              fontWeight="600"
            >
              {labelText}
            </text>

            {/* Apex dot */}
            <circle
              cx={toPixel(det.trace, totalTraces, canvasWidth, zoom, panOffset.x)}
              cy={toPixel(det.apexSample, totalSamples, canvasHeight, zoom, panOffset.y)}
              r={3}
              fill={color}
              opacity={0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}
