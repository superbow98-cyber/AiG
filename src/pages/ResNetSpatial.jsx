// AiG — ResNetSpatial.jsx
// AI Research Lab · ResNet-18 Spatial AI Module
// Pipeline: Detected anomaly → Crop → ResNet-18 → 128-D Spatial Embedding
//
// Reads:  location.state passed from Detect.jsx ({ matrix, metadata, detections, ... })
// Passes: → /fusion-engine ({ resnetEmbedding, resnetPatch, detection, ...scan info })
//
// This page is purely additive — it does not touch Detect.jsx's own detector,
// it only reads its output when navigated to explicitly.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import {
  getSpatialEmbedding,
  getDefaultResNet18,
  RESNET_ARCH_SUMMARY,
} from '../models/resnet18';
import { generateSyntheticScan } from '../utils/gprParser';
import { sampleToDepth } from '../utils/depthCalc';

// Matches the 3 hardcoded reflectors inside generateSyntheticScan() (traces=200,
// samples=300, dt_ns=0.2, dx_m=0.02 defaults) so a standalone "sample" detection
// actually lands on a real synthetic hyperbola, not just background noise.
function generateSampleDetections({ dt_ns = 0.2, dx_m = 0.02, velocity = 0.1 } = {}) {
  const reflectors = [
    { traceCenter: 50, depthSample: 80 },
    { traceCenter: 120, depthSample: 150 },
    { traceCenter: 165, depthSample: 60 },
  ];
  return reflectors.map(({ traceCenter, depthSample }, i) => ({
    id: `sample-${i}`,
    trace: traceCenter,
    apexSample: depthSample,
    halfWidthTraces: 8,
    halfDepthSamples: 15,
    position_m: traceCenter * dx_m,
    depth_m: sampleToDepth(depthSample, dt_ns, velocity),
    size_width_cm: 16 * dx_m * 100,
    size_height_cm: sampleToDepth(30, dt_ns, velocity) * 100,
  }));
}

function PatchCanvas({ patch, size }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!patch || !canvasRef.current) return;
    const scale = 6;
    const canvas = canvasRef.current;
    canvas.width = size * scale;
    canvas.height = size * scale;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = Math.round(((patch[i] + 1) / 2) * 255); // [-1,1] -> [0,255]
      img.data[i * 4 + 0] = v;
      img.data[i * 4 + 1] = Math.round(v * 0.85);
      img.data[i * 4 + 2] = Math.round(v * 0.55);
      img.data[i * 4 + 3] = 255;
    }
    // draw at native size then scale up with imageSmoothingEnabled off for crisp pixels
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, size, size, 0, 0, canvas.width, canvas.height);
  }, [patch, size]);
  return <canvas ref={canvasRef} className="rounded-lg border border-[#F0E9B8]" />;
}

function EmbeddingStrip({ embedding }) {
  const max = useMemo(() => Math.max(1e-6, ...Array.from(embedding, Math.abs)), [embedding]);
  return (
    <div className="grid grid-cols-16 gap-[2px]" style={{ gridTemplateColumns: 'repeat(32, 1fr)' }}>
      {Array.from(embedding).map((v, i) => {
        const t = Math.abs(v) / max;
        const hue = v >= 0 ? 40 : 0; // gold for positive, red-ish for negative
        return (
          <div
            key={i}
            title={`dim ${i}: ${v.toFixed(4)}`}
            className="aspect-square rounded-sm"
            style={{ background: `hsl(${hue} 80% ${85 - t * 45}%)` }}
          />
        );
      })}
    </div>
  );
}

export default function ResNetSpatial() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state;

  const [localScan, setLocalScan] = useState(null);
  const matrix = state?.matrix ?? localScan?.matrix ?? null;
  const detections = state?.detections ?? localScan?.detections ?? [];
  const metadata = state?.metadata ?? localScan?.metadata ?? null;
  const filename = state?.filename ?? (localScan ? 'synthetic demo scan' : 'scan');
  const scanId = state?.scanId ?? null;
  const velocity = state?.velocity ?? 0.1;

  function loadSampleScan() {
    const scan = generateSyntheticScan();
    setLocalScan({ ...scan, detections: generateSampleDetections({ dt_ns: scan.metadata.dt_ns, dx_m: scan.metadata.dx_m, velocity }) });
  }

  const [selectedId, setSelectedId] = useState(detections[0]?.id ?? null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // detections can populate after mount (via "Load Sample Scan"), so keep
  // the selection in sync rather than only initialising it once.
  useEffect(() => {
    if (!detections.find((d) => d.id === selectedId) && detections.length > 0) {
      setSelectedId(detections[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detections]);

  const model = useMemo(() => getDefaultResNet18(), []);
  const selectedDetection = detections.find((d) => d.id === selectedId) ?? null;

  function runEmbedding() {
    if (!matrix || !selectedDetection) return;
    setRunning(true);
    setTimeout(() => {
      const out = getSpatialEmbedding(matrix, selectedDetection, { size: 32, model });
      setResult(out);
      setRunning(false);
    }, 0);
  }

  function sendToFusion() {
    if (!result) return;
    navigate('/fusion-engine', {
      state: {
        resnetEmbedding: Array.from(result.embedding),
        resnetPatch: Array.from(result.patch),
        resnetPatchSize: result.size,
        detection: selectedDetection,
        matrix, metadata, filename, scanId, velocity,
        detections,
      },
    });
  }

  if (!matrix || detections.length === 0) {
    return (
      <div className="min-h-full flex items-center justify-center" style={{ background: '#FDFBF0' }}>
        <div className="text-center max-w-sm space-y-4">
          <p className="text-stone-500">
            No detections loaded. Run detection on a scan first, then open it here.
          </p>
          <Link to="/detect" className="text-sm font-medium block" style={{ color: '#C9971A' }}>
            ← Go to Detect
          </Link>
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="flex-1 h-px bg-[#F0E9B8]" /> or <div className="flex-1 h-px bg-[#F0E9B8]" />
          </div>
          <button
            onClick={loadSampleScan}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            Load Sample Scan (try standalone)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-6 space-y-6" style={{ background: '#FDFBF0' }}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#C9971A' }}>
            AI Research Lab
          </p>
          <h1 className="text-2xl font-bold text-stone-800">ResNet-18 Spatial AI Module</h1>
          <p className="text-stone-500 text-sm mt-1 truncate max-w-lg">
            {filename} — anomaly crop → ResNet-18 → 128-D spatial embedding
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={sendToFusion}
            disabled={!result}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40"
            style={{ background: '#C9971A' }}
          >
            Send to Fusion Engine →
          </button>
        </div>
      </div>

      {/* Untrained-weights banner */}
      <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#E8DFA0', background: '#F7F3D0', color: '#92692A' }}>
        <strong>Architecture demo — untrained weights.</strong> The ResNet-18 forward pass below is real
        (conv → residual blocks → global-avg-pool), but the weights are seeded, not trained on labelled
        GPR anomaly imagery. Treat the embedding as structurally correct, not yet a calibrated material
        signal. Swap in trained weights via <code>loadWeights()</code> in <code>src/models/resnet18.js</code>.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: detection picker + crop preview */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-4">
          <div>
            <label className="text-xs text-stone-400 block mb-1">Select detection</label>
            <select
              value={selectedId ?? ''}
              onChange={(e) => { setSelectedId(e.target.value); setResult(null); }}
              className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg px-3 py-2 text-sm"
            >
              {detections.map((d, i) => (
                <option key={d.id} value={d.id}>
                  #{i + 1} — {d.position_m.toFixed(2)}m @ {d.depth_m.toFixed(2)}m depth
                </option>
              ))}
            </select>
          </div>

          {selectedDetection && (
            <div className="grid grid-cols-2 gap-2 text-xs text-stone-500">
              <div>Position: <span className="text-stone-800 font-mono">{selectedDetection.position_m.toFixed(2)}m</span></div>
              <div>Depth: <span className="text-stone-800 font-mono">{selectedDetection.depth_m.toFixed(2)}m</span></div>
              <div>Width: <span className="text-stone-800 font-mono">{selectedDetection.size_width_cm}cm</span></div>
              <div>Height: <span className="text-stone-800 font-mono">{selectedDetection.size_height_cm}cm</span></div>
            </div>
          )}

          <button
            onClick={runEmbedding}
            disabled={running || !selectedDetection}
            className="w-full px-4 py-2 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            {running ? 'Extracting & running ResNet-18…' : 'Extract crop & run ResNet-18'}
          </button>

          {result && (
            <div>
              <p className="text-xs text-stone-400 mb-2">32×32 normalised crop (input to network)</p>
              <PatchCanvas patch={result.patch} size={result.size} />
            </div>
          )}
        </div>

        {/* Middle: architecture summary */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Architecture</p>
          <div className="text-xs text-stone-600 space-y-1.5 font-mono">
            <p>{RESNET_ARCH_SUMMARY.input}</p>
            <p>↓ {RESNET_ARCH_SUMMARY.stem}</p>
            {RESNET_ARCH_SUMMARY.stages.map((s, i) => <p key={i}>↓ {s}</p>)}
            <p>↓ {RESNET_ARCH_SUMMARY.head}</p>
          </div>
          <p className="text-xs text-stone-400 pt-2 border-t border-[#F0E9B8]">
            {RESNET_ARCH_SUMMARY.totalLayers} conv layers total
          </p>

          {result?.stageActivations && (
            <div className="pt-2">
              <p className="text-xs text-stone-400 mb-1">Per-stage mean activation</p>
              <div className="space-y-1">
                {result.stageActivations.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500 w-14">stage {i + 1}</span>
                    <span className="text-stone-400 font-mono w-16">{s.H}×{s.W}×{s.C}</span>
                    <span className="text-stone-700 font-mono">{s.mean.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: embedding */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">128-D Spatial Embedding</p>
          {!result && <p className="text-xs text-stone-400">Run the network to see the embedding.</p>}
          {result && (
            <>
              <EmbeddingStrip embedding={result.embedding} />
              <p className="text-xs text-stone-400">
                Hover a cell for its value. Gold = positive, red = negative activation.
              </p>
              <details className="text-xs">
                <summary className="cursor-pointer text-stone-500">View raw vector (JSON)</summary>
                <pre className="mt-2 p-2 bg-[#FDFBF0] rounded-lg overflow-x-auto text-[10px] text-stone-600">
                  {JSON.stringify(Array.from(result.embedding).map((v) => Number(v.toFixed(4))))}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>

      <StatusBar
        step={running ? 'Running ResNet-18 forward pass…' : result ? '128-D embedding extracted.' : 'Select a detection and run the network.'}
        progress={running ? 60 : result ? 100 : 0}
      />
    </div>
  );
}
