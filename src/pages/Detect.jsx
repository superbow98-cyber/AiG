// AiG — Detect.jsx
// Object detection page — peak picking + feature extraction + SVM target/noise
// classification on the preprocessed B-scan matrix.
//
// Detection pipeline:
//   1. findPeaks()        → candidate amplitude maxima
//   2. extractFeatures()  → 18-element feature vector per peak
//   3. SVM (if trained) or amplitude threshold → label 'target' | 'noise'
//   4. Build Detection objects with position_m, depth_m, size estimates
//   5. Show BScanViewer + HyperbolaOverlay + ObjectMap + summary stats
//
// Reads:  location.state  (passed from Visualise.jsx)
// Passes: location.state + detections → /classify
//
// Consumed by: App.jsx (route)

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import BScanViewer     from '../components/BScanViewer';
import DepthScale      from '../components/DepthScale';
import HyperbolaOverlay from '../components/HyperbolaOverlay';
import ObjectMap       from '../components/ObjectMap';
import StatusBar       from '../components/StatusBar';
import { findPeaks, extractFeatures } from '../models/knn';
import { trainClassifier, predictClassifier } from '../models/svmModel';
import { getMatrixRange } from '../utils/colormap';
import { sampleToDepth } from '../utils/depthCalc';

// ── Detection helpers ─────────────────────────────────────────────────────────

/**
 * Estimate bounding box half-dimensions for a detected peak.
 * Uses the half-width at half-max in the apex row, and a fixed
 * depth window below the apex for height.
 */
function estimateBounds(matrix, apexSample, apexTrace, halfDepthSamples = 15) {
  const samples = matrix.length;
  const traces  = matrix[0]?.length ?? 0;
  const apexAmp = Math.abs(matrix[apexSample]?.[apexTrace] ?? 0);
  const halfMax = apexAmp * 0.5;

  let halfWidthTraces = 5; // default fallback
  for (let dt = 1; dt <= 30; dt++) {
    const l = Math.abs(matrix[apexSample]?.[Math.max(0, apexTrace - dt)] ?? 0);
    const r = Math.abs(matrix[apexSample]?.[Math.min(traces - 1, apexTrace + dt)] ?? 0);
    if (l < halfMax && r < halfMax) { halfWidthTraces = dt; break; }
  }

  return {
    halfWidthTraces:  Math.max(3, halfWidthTraces),
    halfDepthSamples: Math.min(halfDepthSamples, samples - apexSample - 1),
  };
}

/**
 * Convert peak list → Detection objects.
 */
function buildDetections(peaks, matrix, metadata, velocity, dx_m) {
  return peaks.map((peak, i) => {
    const { halfWidthTraces, halfDepthSamples } = estimateBounds(
      matrix, peak.sample, peak.trace
    );
    const features = extractFeatures(matrix, peak.sample, peak.trace);
    const depth_m  = sampleToDepth(peak.sample, metadata.dt_ns, velocity);
    const position_m = peak.trace * (dx_m ?? 0.02);

    // Size estimate: width in cm from trace spacing, height from sample spacing
    const size_width_cm  = halfWidthTraces  * 2 * (dx_m ?? 0.02) * 100;
    const size_height_cm = halfDepthSamples * 2 * (metadata.dt_ns * velocity / 2) * 100;

    return {
      id:               `det-${i}`,
      trace:            peak.trace,
      apexSample:       peak.sample,
      position_m,
      depth_ns:         peak.sample * metadata.dt_ns,
      depth_m,
      size_width_cm:    Math.round(size_width_cm  * 10) / 10,
      size_height_cm:   Math.round(size_height_cm * 10) / 10,
      halfWidthTraces,
      halfDepthSamples,
      amplitude:        peak.amplitude,
      features,
      label:            null,   // filled after classification
      confidence:       null,
      hyperbola: {
        amplitude:    Math.abs(peak.amplitude),
        width_traces: halfWidthTraces * 2,
        curvature:    features[10] ?? 0,
      },
    };
  });
}

// ── Default detection options ─────────────────────────────────────────────────

const DEFAULT_OPTS = {
  minAmplitudePct: 20,   // % of global max
  neighborRadius:  10,
  depthSkipPct:    5,    // skip top N% of scan (air wave)
  depthMaxPct:     90,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Detect() {
  const location = useLocation();
  const navigate = useNavigate();
  const state    = location.state;

  const matrix   = state?.matrix   ?? null;
  const metadata = state?.metadata ?? null;
  const velocity = state?.velocity ?? 0.1;
  const filename = state?.filename ?? 'scan';
  const scanId   = state?.scanId   ?? null;
  const dx_m     = metadata?.dx_m  ?? 0.02;

  // ── Detection state ────────────────────────────────────────────────────────
  const [detections,  setDetections]  = useState([]);
  const [running,     setRunning]     = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [statusMsg,   setStatusMsg]   = useState('');
  const [error,       setError]       = useState(null);
  const [opts,        setOpts]        = useState(DEFAULT_OPTS);

  // ── BScanViewer view state (for HyperbolaOverlay sync) ────────────────────
  const [canvasSize,  setCanvasSize]  = useState({ width: 0, height: 0 });
  const [panOffset,   setPanOffset]   = useState({ x: 0, y: 0 });
  const [zoom,        setZoom]        = useState(1);
  const [colormap,    setColormap]    = useState('seismic');
  const [hoverInfo,   setHoverInfo]   = useState(null);

  const canvasRef = useRef(null);

  const { min: minVal, max: maxVal } = matrix ? getMatrixRange(matrix) : { min: 0, max: 1 };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!matrix || !metadata) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400 mb-4">No scan loaded.</p>
        <Link to="/upload" className="text-emerald-400 hover:underline">
          ← Upload a scan
        </Link>
      </div>
    );
  }

  const samples     = metadata.samples ?? matrix.length;
  const traces      = metadata.traces  ?? (matrix[0]?.length ?? 0);
  const scanLengthM = traces * dx_m;

  // ── Run detection ──────────────────────────────────────────────────────────
  const runDetection = useCallback(async () => {
    setRunning(true);
    setError(null);
    setDetections([]);
    setProgress(10);
    setStatusMsg('Finding amplitude peaks…');

    try {
      await new Promise((r) => setTimeout(r, 0)); // yield to UI

      const gMax = (() => {
        let m = 0;
        for (let s = 0; s < matrix.length; s++)
          for (let t = 0; t < (matrix[0]?.length ?? 0); t++) {
            const v = Math.abs(matrix[s][t]);
            if (v > m) m = v;
          }
        return m;
      })();

      const peaks = findPeaks(matrix, {
        minAmplitude:   gMax * (opts.minAmplitudePct / 100),
        neighborRadius: opts.neighborRadius,
        depthRange: [
          Math.floor(samples * opts.depthSkipPct / 100),
          Math.floor(samples * opts.depthMaxPct  / 100),
        ],
      });

      setProgress(40);
      setStatusMsg(`${peaks.length} candidates found — extracting features…`);
      await new Promise((r) => setTimeout(r, 0));

      const allDets = buildDetections(peaks, matrix, metadata, velocity, dx_m);

      setProgress(70);
      setStatusMsg('Classifying targets vs noise…');
      await new Promise((r) => setTimeout(r, 0));

      // Simple amplitude-based target/noise split (no training data yet).
      // When useResults has stored training examples, swap this for SVM.
      const median = (() => {
        const amps = allDets.map((d) => Math.abs(d.amplitude)).sort((a, b) => a - b);
        return amps[Math.floor(amps.length / 2)] ?? 0;
      })();

      const targets = allDets.filter((d) => Math.abs(d.amplitude) >= median);

      setProgress(90);
      setStatusMsg('Building detection results…');
      await new Promise((r) => setTimeout(r, 0));

      setDetections(targets);
      setProgress(100);
      setStatusMsg(`Detection complete — ${targets.length} objects found`);
    } catch (err) {
      setError(err.message ?? 'Detection failed');
    } finally {
      setRunning(false);
    }
  }, [matrix, metadata, velocity, dx_m, opts, samples]);

  // ── Proceed to classify ────────────────────────────────────────────────────
  const goClassify = () => {
    navigate('/classify', {
      state: {
        ...state,
        detections,
      },
    });
  };

  // ── Opt slider helper ──────────────────────────────────────────────────────
  const setOpt = (key, val) => setOpts((o) => ({ ...o, [key]: val }));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Object Detection</h1>
          <p className="text-sm text-gray-400 mt-0.5">{filename}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runDetection}
            disabled={running}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-600
                       text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {running ? 'Detecting…' : 'Run Detection'}
          </button>
          {detections.length > 0 && (
            <button
              onClick={goClassify}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500
                         text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Classify Materials →
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <StatusBar step={statusMsg} progress={progress} visible={running || progress === 100} />

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Detection options */}
      <details className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4">
        <summary className="text-sm font-semibold text-gray-300 cursor-pointer select-none">
          Detection Options
        </summary>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-4">
          {[
            { key: 'minAmplitudePct', label: 'Min amplitude threshold', unit: '% of max', min: 5,  max: 60, step: 5  },
            { key: 'neighborRadius',  label: 'Suppression radius',       unit: 'traces',   min: 2,  max: 30, step: 1  },
            { key: 'depthSkipPct',    label: 'Skip surface',             unit: '% depth',  min: 0,  max: 20, step: 1  },
            { key: 'depthMaxPct',     label: 'Max search depth',         unit: '% depth',  min: 50, max: 100, step: 5 },
          ].map(({ key, label, unit, min, max, step }) => (
            <div key={key}>
              <label className="text-xs text-gray-400 block mb-1">
                {label}: <span className="text-white font-mono">{opts[key]}{unit.startsWith('%') ? '%' : ` ${unit}`}</span>
              </label>
              <input
                type="range" min={min} max={max} step={step}
                value={opts[key]}
                onChange={(e) => setOpt(key, Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>
          ))}
        </div>
      </details>

      {/* B-scan + overlay */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-300">B-scan</span>
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value)}
            className="text-xs bg-gray-700 border border-gray-600 text-gray-200
                       rounded px-2 py-1"
          >
            {['seismic', 'grey', 'viridis', 'hot'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Canvas + overlay wrapper */}
        <div className="relative flex" ref={canvasRef}>
          <DepthScale
            samples={samples}
            dt_ns={metadata.dt_ns}
            velocity={velocity}
            height_px={480}
          />
          <div className="relative flex-1">
            <BScanViewer
              matrix={matrix}
              colormap={colormap}
              minVal={minVal}
              maxVal={maxVal}
              height={480}
              velocity={velocity}
              dt_ns={metadata.dt_ns}
              onPixelHover={setHoverInfo}
              onViewChange={({ panOffset: po, zoom: z, canvasWidth: cw, canvasHeight: ch }) => {
                setPanOffset(po);
                setZoom(z);
                setCanvasSize({ width: cw, height: ch });
              }}
            />
            <HyperbolaOverlay
              detections={detections}
              canvasWidth={canvasSize.width}
              canvasHeight={canvasSize.height}
              totalTraces={traces}
              totalSamples={samples}
              panOffset={panOffset}
              zoom={zoom}
            />
          </div>
        </div>

        {/* Hover info */}
        {hoverInfo && (
          <div className="text-xs text-gray-400 font-mono">
            Trace {hoverInfo.trace} · Sample {hoverInfo.sample} ·
            Depth {hoverInfo.depth_m?.toFixed(3)}m · Amp {hoverInfo.amplitude?.toFixed(1)}
          </div>
        )}
      </div>

      {/* Summary stats */}
      {detections.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Objects detected', value: detections.length },
            {
              label: 'Deepest object',
              value: `${Math.max(...detections.map((d) => d.depth_m)).toFixed(2)}m`,
            },
            {
              label: 'Survey length',
              value: `${scanLengthM.toFixed(1)}m`,
            },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-emerald-400">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Object map */}
      <ObjectMap
        detections={detections}
        scanLengthM={scanLengthM}
        velocity={velocity}
      />

      {/* Detection table */}
      {detections.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
              <tr>
                {['#', 'Position', 'Depth', 'Width', 'Height', 'Amplitude'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {detections.map((det, i) => (
                <tr key={det.id} className="hover:bg-gray-700/40 transition-colors">
                  <td className="px-4 py-2 text-gray-400 font-mono">{i + 1}</td>
                  <td className="px-4 py-2 text-white font-mono">{det.position_m.toFixed(2)}m</td>
                  <td className="px-4 py-2 text-white font-mono">{det.depth_m.toFixed(2)}m</td>
                  <td className="px-4 py-2 text-gray-300 font-mono">{det.size_width_cm}cm</td>
                  <td className="px-4 py-2 text-gray-300 font-mono">{det.size_height_cm}cm</td>
                  <td className="px-4 py-2 text-gray-300 font-mono">
                    {det.amplitude.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
