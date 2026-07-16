// AiG — DetectionLab.jsx
// §7d — AI Research Lab · AI Detection Lab
// Runs a selectable deep-detector head (YOLO-lite / Faster R-CNN-lite /
// Mask R-CNN-lite) directly on the full B-scan, alongside — not replacing —
// the existing SVM/peak-picking detector in Detect.jsx. Shows boxes, masks
// (Mask R-CNN-lite only) and a classical-vs-AI comparison panel.
//
// Reads:  location.state passed from Detect.jsx
//         ({ matrix, metadata, detections /* classical */, filename, scanId, velocity })
// Passes: → /resnet-spatial ({ matrix, metadata, detections: aiDetections, ... })
//         so an AI Detection Lab box can be sent into the same ResNet-18 /
//         Fusion Engine pipeline as a classical detection.
//
// Purely additive — does not touch Detect.jsx's own detector or state.

import { useState, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import HyperbolaOverlay from '../components/HyperbolaOverlay';
import BScanViewer from '../components/BScanViewer';
import DepthScale from '../components/DepthScale';
import { getMatrixRange } from '../utils/colormap';
import { generateSyntheticScan } from '../utils/gprParser';
import {
  runDetector,
  getDefaultDetector,
  DETECTOR_METHODS,
  DETECTOR_CLASSES,
  ARCH_SUMMARIES,
  compareDetections,
} from '../models/detectionModels';

const MATERIAL_COLORS = {
  ceramic: '#34d399', metal: '#f87171', stone: '#a78bfa', void: '#38bdf8', unknown: '#94a3b8',
};

function MaskChip({ mask, size = 8, color }) {
  if (!mask) return null;
  return (
    <div
      className="grid gap-px rounded overflow-hidden border border-[#F0E9B8]"
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, width: 40, height: 40 }}
    >
      {mask.map((v, i) => (
        <div key={i} style={{ background: color, opacity: Math.max(0.05, v) }} />
      ))}
    </div>
  );
}

export default function DetectionLab() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state;

  const [localScan, setLocalScan] = useState(null);
  const matrix = state?.matrix ?? localScan?.matrix ?? null;
  const metadata = state?.metadata ?? localScan?.metadata ?? null;
  const classicalDetections = state?.detections ?? [];
  const filename = state?.filename ?? (localScan ? 'synthetic demo scan' : 'scan');
  const scanId = state?.scanId ?? null;
  const velocity = state?.velocity ?? 0.1;

  const [method, setMethod] = useState('yolo');
  const [confThreshold, setConfThreshold] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [colormap, setColormap] = useState('seismic');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showClassical, setShowClassical] = useState(true);

  const { min: minVal, max: maxVal } = matrix ? getMatrixRange(matrix) : { min: 0, max: 1 };
  const samples = metadata?.samples ?? matrix?.length ?? 0;
  const traces  = metadata?.traces  ?? (matrix?.[0]?.length ?? 0);

  const comparison = useMemo(
    () => (result ? compareDetections(result.detections, classicalDetections) : null),
    [result, classicalDetections]
  );

  function runAiDetection() {
    if (!matrix || !metadata) return;
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      const model = getDefaultDetector(method);
      const out = runDetector(matrix, metadata, { method, model, confThreshold });
      setResult(out);
      setRunning(false);
    }, 0);
  }

  function sendToResNet(detection) {
    navigate('/resnet-spatial', {
      state: {
        matrix, metadata, filename, scanId, velocity,
        detections: [detection],
      },
    });
  }

  function sendAllToResNet() {
    if (!result?.detections?.length) return;
    navigate('/resnet-spatial', {
      state: { matrix, metadata, filename, scanId, velocity, detections: result.detections },
    });
  }

  if (!matrix || !metadata) {
    return (
      <div className="min-h-full flex items-center justify-center" style={{ background: '#FDFBF0' }}>
        <div className="text-center max-w-sm space-y-4">
          <p className="text-stone-500">No scan loaded. Run detection on a scan first, then open it here.</p>
          <Link to="/detect" className="text-sm font-medium block" style={{ color: '#C9971A' }}>← Go to Detect</Link>
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="flex-1 h-px bg-[#F0E9B8]" /> or <div className="flex-1 h-px bg-[#F0E9B8]" />
          </div>
          <button
            onClick={() => setLocalScan(generateSyntheticScan())}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            Load Sample Scan (try standalone)
          </button>
        </div>
      </div>
    );
  }

  const arch = ARCH_SUMMARIES[method];
  const combinedOverlayDetections = [
    ...(showClassical ? classicalDetections : []),
    ...(result?.detections ?? []),
  ];

  return (
    <div className="min-h-full p-6 space-y-6" style={{ background: '#FDFBF0' }}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#C9971A' }}>
            AI Research Lab
          </p>
          <h1 className="text-2xl font-bold text-stone-800">AI Detection Lab</h1>
          <p className="text-stone-500 text-sm mt-1 truncate max-w-lg">
            {filename} — deep-detector head running alongside the classical SVM/peak detector
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={sendAllToResNet}
            disabled={!result?.detections?.length}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40"
            style={{ background: '#C9971A' }}
          >
            Send all to ResNet-18 →
          </button>
        </div>
      </div>

      {/* Untrained-weights banner */}
      <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#E8DFA0', background: '#F7F3D0', color: '#92692A' }}>
        <strong>Architecture demo — untrained weights.</strong> The backbone + head below run a real
        forward pass (conv over a {ARCH_SUMMARIES.yolo.input.split(',')[0]} feature grid → per-method head → NMS),
        but weights are seeded, not trained on labelled GPR object boxes/masks. Treat boxes/masks as
        illustrating the pipeline, not yet calibrated detections. Swap in trained weights via{' '}
        <code>loadWeights()</code> in <code>src/models/detectionModels.js</code>.
      </div>

      {/* Controls */}
      <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-stone-400 block mb-1">Detector</label>
            <select
              value={method}
              onChange={(e) => { setMethod(e.target.value); setResult(null); }}
              className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg px-3 py-2 text-sm"
            >
              {DETECTOR_METHODS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-stone-400 mt-1">
              {DETECTOR_METHODS.find((m) => m.key === method)?.description}
            </p>
          </div>

          <div>
            <label className="text-xs text-stone-500 block mb-1">
              Confidence threshold: <span className="text-stone-800 font-mono">{confThreshold.toFixed(2)}</span>
            </label>
            <input
              type="range" min={0.1} max={0.9} step={0.05}
              value={confThreshold}
              onChange={(e) => setConfThreshold(Number(e.target.value))}
              className="w-full accent-[#C9971A]"
            />
          </div>

          <div className="flex items-end gap-3">
            <button
              onClick={runAiDetection}
              disabled={running}
              className="flex-1 px-4 py-2 bg-[#C9971A] hover:bg-[#a87d12] disabled:bg-stone-200
                         text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {running ? 'Running…' : `Run ${DETECTOR_METHODS.find((m) => m.key === method)?.label.split(' ')[0]}`}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-stone-500 whitespace-nowrap">
              <input type="checkbox" checked={showClassical} onChange={(e) => setShowClassical(e.target.checked)} />
              show classical
            </label>
          </div>
        </div>
      </div>

      <StatusBar
        step={running ? `Running ${method}-lite over ${ARCH_SUMMARIES[method].input.split(',')[0]} grid…` : result ? `${result.stats.count} AI detections at ≥${(confThreshold * 100).toFixed(0)}% confidence` : 'Choose a detector and run.'}
        progress={running ? 60 : result ? 100 : 0}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* B-scan + overlay (spans 2 cols) */}
        <div className="lg:col-span-2 bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-stone-600">B-scan — classical (dashed) vs AI (solid, colored by class)</span>
            <select
              value={colormap}
              onChange={(e) => setColormap(e.target.value)}
              className="text-xs bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded px-2 py-1"
            >
              {['seismic', 'grey', 'viridis', 'hot'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="relative flex">
            <DepthScale samples={samples} dt_ns={metadata.dt_ns} velocity={velocity} height_px={440} />
            <div className="relative flex-1">
              <BScanViewer
                matrix={matrix}
                colormap={colormap}
                minVal={minVal}
                maxVal={maxVal}
                height={440}
                velocity={velocity}
                dt_ns={metadata.dt_ns}
                onViewChange={({ panOffset: po, zoom: z, canvasWidth: cw, canvasHeight: ch }) => {
                  setPanOffset(po); setZoom(z); setCanvasSize({ width: cw, height: ch });
                }}
              />
              <HyperbolaOverlay
                detections={combinedOverlayDetections}
                canvasWidth={canvasSize.width}
                canvasHeight={canvasSize.height}
                totalTraces={traces}
                totalSamples={samples}
                panOffset={panOffset}
                zoom={zoom}
              />
            </div>
          </div>
        </div>

        {/* Architecture panel */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Architecture — {method}</p>
          <div className="text-xs text-stone-600 space-y-1.5 font-mono">
            <p>{arch.input}</p>
            <p>↓ {arch.backbone}</p>
            <p>↓ {arch.head}</p>
          </div>
          <p className="text-xs text-stone-400 pt-2 border-t border-[#F0E9B8]">{arch.notes}</p>
          {result && (
            <div className="pt-2 border-t border-[#F0E9B8] space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-stone-500">Candidates before NMS</span><span className="font-mono text-stone-800">{result.stats.candidatesBeforeNms}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Detections kept</span><span className="font-mono text-stone-800">{result.stats.count}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Avg confidence</span><span className="font-mono text-stone-800">{(result.stats.avgConfidence * 100).toFixed(1)}%</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Per-class stats */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {DETECTOR_CLASSES.map((c) => (
            <div key={c} className="bg-white border border-[#F0E9B8] rounded-xl p-4">
              <p className="text-xs text-stone-400 mb-1 capitalize flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: MATERIAL_COLORS[c] }} />
                {c}
              </p>
              <p className="text-2xl font-bold" style={{ color: '#C9971A' }}>{result.stats.perClass[c] ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Classical vs AI comparison */}
      {comparison && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-5">
          <p className="text-sm font-semibold text-stone-700 mb-3">Classical (SVM/peak) vs AI Detection Lab</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
            {[
              { label: 'Classical detections', value: classicalDetections.length },
              { label: 'AI detections', value: result.detections.length },
              { label: 'Matched (both agree)', value: comparison.matched.length },
              { label: 'Match rate vs classical', value: `${(comparison.matchRate * 100).toFixed(0)}%` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-stone-400">{label}</p>
                <p className="text-lg font-bold text-stone-800">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-stone-400">
            Matched = an AI box and a classical detection land within a small trace/sample tolerance of each other.
            Position/depth agreement doesn't imply the material label is correct — labels come from this untrained head.
          </p>
        </div>
      )}

      {/* Detection table */}
      {result && result.detections.length > 0 && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF0] text-stone-500 text-xs uppercase tracking-wide">
              <tr>
                {['#', 'Class', 'Position', 'Depth', 'Confidence', method === 'maskrcnn' ? 'Mask' : null, ''].filter(Boolean).map((h) => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E9B8]">
              {result.detections.map((det, i) => (
                <tr key={det.id} className="hover:bg-[#FDFBF0] transition-colors">
                  <td className="px-4 py-2 text-stone-500 font-mono">{i + 1}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 text-stone-800 capitalize">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: MATERIAL_COLORS[det.label] }} />
                      {det.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-stone-800 font-mono">{det.position_m.toFixed(2)}m</td>
                  <td className="px-4 py-2 text-stone-800 font-mono">{det.depth_m.toFixed(2)}m</td>
                  <td className="px-4 py-2 text-stone-600 font-mono">{(det.confidence * 100).toFixed(0)}%</td>
                  {method === 'maskrcnn' && (
                    <td className="px-4 py-2">
                      <MaskChip mask={det.mask} size={8} color={MATERIAL_COLORS[det.label]} />
                    </td>
                  )}
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => sendToResNet(det)}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors"
                      style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
                    >
                      → ResNet-18
                    </button>
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
