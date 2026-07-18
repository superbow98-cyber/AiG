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
import { findPeaks } from '../models/knn';
import { trainClassifier, predictClassifier } from '../models/svmModel';
import { getMatrixRange } from '../utils/colormap';
import { buildDetections, DEFAULT_DETECT_OPTS as DEFAULT_OPTS } from '../utils/autoDetect';

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
  const [colormap] = useState('grey'); // grayscale-only — standard GPR B-scan display (not seismic reflection data)
  const [hoverInfo,   setHoverInfo]   = useState(null);

  const canvasRef = useRef(null);

  const { min: minVal, max: maxVal } = matrix ? getMatrixRange(matrix) : { min: 0, max: 1 };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!matrix || !metadata) {
    return (
      <div className="p-8 text-center">
        <p className="text-stone-500 mb-4">No scan loaded.</p>
        <Link to="/upload" className="text-[#C9971A] hover:underline">
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
          <h1 className="text-xl font-bold text-stone-800">Object Detection</h1>
          <p className="text-sm text-stone-500 mt-0.5">{filename}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={runDetection}
            disabled={running}
            className="px-4 py-2 bg-[#C9971A] hover:bg-[#a87d12] disabled:bg-stone-200
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
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Detection options */}
      <details className="bg-white border border-[#F0E9B8] rounded-xl px-5 py-4">
        <summary className="text-sm font-semibold text-stone-600 cursor-pointer select-none">
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
              <label className="text-xs text-stone-500 block mb-1">
                {label}: <span className="text-stone-800 font-mono">{opts[key]}{unit.startsWith('%') ? '%' : ` ${unit}`}</span>
              </label>
              <input
                type="range" min={min} max={max} step={step}
                value={opts[key]}
                onChange={(e) => setOpt(key, Number(e.target.value))}
                className="w-full accent-[#C9971A]"
              />
            </div>
          ))}
        </div>
      </details>

      {/* B-scan + overlay */}
      <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-stone-600">B-scan</span>
          <span className="text-xs text-stone-400 bg-[#F7F3D0] border border-[#E8DFA0] rounded px-2 py-1">
            grayscale · amplitude
          </span>
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
          <div className="text-xs text-stone-500 font-mono">
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
            <div key={label} className="bg-white border border-[#F0E9B8] rounded-xl p-4">
              <p className="text-xs text-stone-400 mb-1">{label}</p>
              <p className="text-2xl font-bold text-[#C9971A]">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* AI Research Lab handoff — additive, does not change the detector above */}
      {detections.length > 0 && (
        <div className="flex justify-end gap-3">
          <Link
            to="/detection-lab"
            state={{ matrix, metadata, detections, filename, scanId, velocity }}
            className="text-sm font-medium px-4 py-2 rounded-xl border transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            Compare with AI Detection Lab (YOLO/Faster R-CNN/Mask R-CNN) →
          </Link>
          <Link
            to="/resnet-spatial"
            state={{ matrix, metadata, detections, filename, scanId, velocity }}
            className="text-sm font-medium px-4 py-2 rounded-xl border transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            Analyze in AI Research Lab (ResNet-18) →
          </Link>
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
        <div className="bg-white border border-[#F0E9B8] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF0] text-stone-500 text-xs uppercase tracking-wide">
              <tr>
                {['#', 'Position', 'Depth', 'Width', 'Height', 'Amplitude'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E9B8]">
              {detections.map((det, i) => (
                <tr key={det.id} className="hover:bg-[#FDFBF0] transition-colors">
                  <td className="px-4 py-2 text-stone-500 font-mono">{i + 1}</td>
                  <td className="px-4 py-2 text-stone-800 font-mono">{det.position_m.toFixed(2)}m</td>
                  <td className="px-4 py-2 text-stone-800 font-mono">{det.depth_m.toFixed(2)}m</td>
                  <td className="px-4 py-2 text-stone-600 font-mono">{det.size_width_cm}cm</td>
                  <td className="px-4 py-2 text-stone-600 font-mono">{det.size_height_cm}cm</td>
                  <td className="px-4 py-2 text-stone-600 font-mono">
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
