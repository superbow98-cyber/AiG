// AiG — Visualise.jsx
// B-scan viewer page — colormap selector, amplitude range, trace zoom strip.
// Receives scan via router location.state (Upload.jsx passes it).
// TODO: replace location.state bridge with GPRContext when ready (BRAIN §7).

import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BScanViewer from '../components/BScanViewer';
import DepthScale from '../components/DepthScale';
import { getColormapNames, getMatrixRange } from '../utils/colormap';
import { DEFAULT_VELOCITY_M_PER_NS } from '../utils/depthCalc';
import { ArrowRight, Info } from 'lucide-react';

const VIEWER_HEIGHT = 480;

export default function Visualise() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const matrix   = state?.matrix   ?? null;
  const metadata = state?.metadata ?? null;
  const filename = state?.filename ?? null;
  const velocity = state?.velocity ?? DEFAULT_VELOCITY_M_PER_NS;

  // ── colormap controls ─────────────────────────────────────────────────────
  const [colormap, setColormap] = useState('seismic');

  // Amplitude range — default to actual data range
  const dataRange = useMemo(() => matrix ? getMatrixRange(matrix) : { min: 0, max: 1 }, [matrix]);
  const [minVal, setMinVal] = useState(null); // null = use dataRange
  const [maxVal, setMaxVal] = useState(null);

  const effectiveMin = minVal ?? dataRange.min;
  const effectiveMax = maxVal ?? dataRange.max;

  // ── hover info ────────────────────────────────────────────────────────────
  const [hoverInfo, setHoverInfo] = useState(null);

  // ── no scan guard ─────────────────────────────────────────────────────────
  if (!matrix) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-gray-400">
        <Info className="h-8 w-8" />
        <p>No scan loaded. <a href="/upload" className="text-emerald-400 underline">Upload a file first.</a></p>
      </div>
    );
  }

  const samples = metadata?.samples ?? matrix.length;
  const dt_ns   = metadata?.dt_ns   ?? 0.2;
  const traces  = metadata?.traces  ?? (matrix[0]?.length ?? 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Visualise</h1>
          {filename && <p className="mt-0.5 text-sm text-gray-400">{filename}</p>}
        </div>
        <button
          onClick={() => navigate('/detect', { state })}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400"
        >
          Run Detection <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Colormap */}
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 space-y-2">
          <label className="text-xs font-medium uppercase tracking-widest text-gray-400">Colormap</label>
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value)}
            className="w-full rounded-md bg-gray-700 px-3 py-1.5 text-sm text-white border border-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {getColormapNames().map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        {/* Amplitude min */}
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 space-y-2">
          <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
            Min amplitude <span className="text-gray-500 normal-case">({dataRange.min.toFixed(1)})</span>
          </label>
          <input
            type="range"
            min={dataRange.min}
            max={dataRange.max}
            step={(dataRange.max - dataRange.min) / 200}
            value={effectiveMin}
            onChange={(e) => setMinVal(parseFloat(e.target.value))}
            className="w-full accent-emerald-400"
          />
          <p className="text-right text-xs tabular-nums text-gray-400">{effectiveMin.toFixed(2)}</p>
        </div>

        {/* Amplitude max */}
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-4 space-y-2">
          <label className="text-xs font-medium uppercase tracking-widest text-gray-400">
            Max amplitude <span className="text-gray-500 normal-case">({dataRange.max.toFixed(1)})</span>
          </label>
          <input
            type="range"
            min={dataRange.min}
            max={dataRange.max}
            step={(dataRange.max - dataRange.min) / 200}
            value={effectiveMax}
            onChange={(e) => setMaxVal(parseFloat(e.target.value))}
            className="w-full accent-emerald-400"
          />
          <p className="text-right text-xs tabular-nums text-gray-400">{effectiveMax.toFixed(2)}</p>
        </div>
      </div>

      {/* Scan stats */}
      <div className="flex flex-wrap gap-6 text-xs text-gray-500">
        <span>{traces} traces</span>
        <span>{samples} samples/trace</span>
        <span>{dt_ns} ns/sample</span>
        <span>velocity {velocity} m/ns</span>
        {hoverInfo && (
          <span className="text-emerald-400">
            trace {hoverInfo.trace} · sample {hoverInfo.sample} · {hoverInfo.depth_m.toFixed(3)} m · amp {hoverInfo.amplitude?.toFixed(2)}
          </span>
        )}
      </div>

      {/* Viewer */}
      <div className="flex gap-0">
        <DepthScale
          samples={samples}
          dt_ns={dt_ns}
          velocity={velocity}
          height_px={VIEWER_HEIGHT}
        />
        <div className="flex-1 min-w-0">
          <BScanViewer
            matrix={matrix}
            colormap={colormap}
            minVal={effectiveMin}
            maxVal={effectiveMax}
            height={VIEWER_HEIGHT}
            velocity={velocity}
            dt_ns={dt_ns}
            onPixelHover={setHoverInfo}
          />
        </div>
      </div>
    </div>
  );
}
