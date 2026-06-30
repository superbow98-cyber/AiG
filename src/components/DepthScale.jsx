// AiG — DepthScale.jsx
// SVG y-axis showing depth in both nanoseconds and metres.
// Props:
//   samples    — number
//   dt_ns      — number
//   velocity   — number (m/ns)
//   height_px  — number — must match BScanViewer height exactly

import { useMemo } from 'react';
import { getDepthTicks, sampleToDepth, metresToNs } from '../utils/depthCalc';

const WIDTH = 72; // px — fixed sidebar width

export default function DepthScale({ samples, dt_ns, velocity, height_px = 480 }) {
  const ticks = useMemo(
    () => getDepthTicks(samples, dt_ns, velocity, 8),
    [samples, dt_ns, velocity]
  );

  if (!samples || !dt_ns) return null;

  const maxDepthM = sampleToDepth(samples - 1, dt_ns, velocity);

  return (
    <svg
      width={WIDTH}
      height={height_px}
      className="shrink-0 select-none"
      style={{ fontFamily: 'ui-monospace, monospace' }}
    >
      {/* background */}
      <rect width={WIDTH} height={height_px} fill="rgb(17 24 39)" />

      {/* axis line */}
      <line x1={WIDTH - 1} y1={0} x2={WIDTH - 1} y2={height_px} stroke="rgb(75 85 99)" strokeWidth={1} />

      {ticks.map((depthM) => {
        const y = maxDepthM > 0 ? (depthM / maxDepthM) * height_px : 0;
        const ns = metresToNs(depthM, velocity);

        return (
          <g key={depthM} transform={`translate(0,${y})`}>
            {/* tick mark */}
            <line x1={WIDTH - 6} y1={0} x2={WIDTH - 1} y2={0} stroke="rgb(107 114 128)" strokeWidth={1} />

            {/* metres label */}
            <text
              x={WIDTH - 10}
              y={-3}
              textAnchor="end"
              fontSize={9}
              fill="rgb(209 213 219)"
            >
              {depthM.toFixed(depthM < 1 ? 2 : 1)} m
            </text>

            {/* nanoseconds label */}
            <text
              x={WIDTH - 10}
              y={7}
              textAnchor="end"
              fontSize={8}
              fill="rgb(107 114 128)"
            >
              {ns.toFixed(1)} ns
            </text>
          </g>
        );
      })}

      {/* axis title */}
      <text
        transform={`translate(10, ${height_px / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={9}
        fill="rgb(107 114 128)"
        letterSpacing="0.05em"
      >
        DEPTH
      </text>
    </svg>
  );
}
