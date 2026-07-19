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
import FileLoader from '../components/FileLoader';
import BScanViewer from '../components/BScanViewer';
import HyperbolaOverlay from '../components/HyperbolaOverlay';
import DepthScale from '../components/DepthScale';
import useGPRData from '../hooks/useGPRData';
import {
  getSpatialEmbedding,
  getDefaultResNet18,
  RESNET_ARCH_SUMMARY,
} from '../models/resnet18';
import { generateSyntheticScan } from '../utils/gprParser';
import { sampleToDepth } from '../utils/depthCalc';
import { getMatrixRange } from '../utils/colormap';
import { quickAutoDetect } from '../utils/autoDetect';
import { useFusionWorkspace } from '../context/FusionWorkspaceContext';
import { saveLabelledRecord, listSavedXrfSamples } from '../lib/db';
import { getChemicalEmbedding, XRF_ELEMENTS } from '../models/xrfMLP';
import { parseXRFCsv } from '../utils/xrfCsv';
import { MATERIAL_CLASSES } from '../models/fusionEngine';

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
  const { setResnet, setXrf } = useFusionWorkspace();
  const state = location.state;

  const [localScan, setLocalScan] = useState(null);
  const matrix = state?.matrix ?? localScan?.matrix ?? null;
  const detections = state?.detections ?? localScan?.detections ?? [];
  const metadata = state?.metadata ?? localScan?.metadata ?? null;
  const filename = state?.filename ?? (localScan ? localScan.filename ?? 'synthetic demo scan' : 'scan');
  const scanId = state?.scanId ?? null;
  const velocity = state?.velocity ?? 0.1;

  function loadSampleScan() {
    const scan = generateSyntheticScan();
    setLocalScan({ ...scan, filename: 'synthetic demo scan', detections: generateSampleDetections({ dt_ns: scan.metadata.dt_ns, dx_m: scan.metadata.dx_m, velocity }) });
  }

  // ── Standalone upload: only used when this page is opened directly (no
  // location.state from Detect.jsx). Reuses the same FileLoader + parser as
  // the Upload page, then runs the same quick classical detector Detect.jsx
  // uses (models/knn.js findPeaks + utils/autoDetect.js) so a detection list
  // exists for the crop-picker below — no need to visit Detect.jsx first. ──
  const uploadHook = useGPRData();
  const { scan: uploadedScan, setScan: setUploadedScan } = uploadHook;
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState(null);
  const processedFileRef = useRef(null);

  useEffect(() => {
    if (state?.matrix) return; // arrived via Detect.jsx — nothing to auto-detect
    if (!uploadedScan.matrix || !uploadedScan.metadata) return;
    if (processedFileRef.current === uploadedScan.filename) return; // already processed
    processedFileRef.current = uploadedScan.filename;

    setAutoDetecting(true);
    setAutoDetectError(null);
    setTimeout(() => {
      try {
        const dets = quickAutoDetect(
          uploadedScan.matrix,
          uploadedScan.metadata,
          uploadedScan.velocity ?? velocity,
          uploadedScan.metadata.dx_m
        );
        if (dets.length === 0) {
          setAutoDetectError('No anomalies found by the quick detector on this file. Try Detect.jsx directly for adjustable thresholds, or use "Load Sample Scan".');
        } else {
          setLocalScan({
            matrix: uploadedScan.matrix,
            metadata: uploadedScan.metadata,
            filename: uploadedScan.filename,
            detections: dets,
          });
        }
      } catch (err) {
        setAutoDetectError(err.message ?? 'Auto-detection failed on this file.');
      } finally {
        setAutoDetecting(false);
      }
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedScan.matrix, uploadedScan.metadata, uploadedScan.filename]);

  const [selectedId, setSelectedId] = useState(detections[0]?.id ?? null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  // §22 follow-up — "why can't I add XRF right after ResNet, why does it just
  // fuse GPR-only silently?" Give an explicit choice instead of a silent
  // skip: pair with a previously-saved XRF reading, enter one from an
  // external/reference source, or deliberately proceed GPR-only.
  const [xrfMode, setXrfMode] = useState(null); // null | 'saved' | 'external' | 'skip'
  const [savedXrfList, setSavedXrfList] = useState([]);
  const [loadingSavedXrf, setLoadingSavedXrf] = useState(false);
  const [savedXrfError, setSavedXrfError] = useState(null);
  const [selectedSavedXrfId, setSelectedSavedXrfId] = useState('');
  const [externalElements, setExternalElements] = useState(
    Object.fromEntries(XRF_ELEMENTS.map((el) => [el, '']))
  );
  const [externalSourceNote, setExternalSourceNote] = useState('');
  const [pairedXrf, setPairedXrf] = useState(null); // { embedding, elements, source, sourceNote/sourceId/sourceMaterial }
  const [xrfPairError, setXrfPairError] = useState(null);
  // Option 4 — upload a CSV, exactly the same parser XRF Workspace uses
  // (models/xrfMLP.js XRF_ELEMENTS-matched columns), so this doesn't become
  // a second, subtly-different CSV format to learn.
  const [csvRows, setCsvRows] = useState([]);
  const [csvFilename, setCsvFilename] = useState(null);
  const [csvError, setCsvError] = useState(null);
  const [selectedCsvRowId, setSelectedCsvRowId] = useState('');

  function handleXrfCsvFile(file) {
    setCsvError(null);
    setCsvRows([]);
    setSelectedCsvRowId('');
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsvError('Please upload a .csv file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, error } = parseXRFCsv(String(reader.result));
      if (error) { setCsvError(error); return; }
      setCsvRows(rows);
      setCsvFilename(file.name);
    };
    reader.onerror = () => setCsvError('Could not read the file.');
    reader.readAsText(file);
  }

  function pickCsvRow(id) {
    setSelectedCsvRowId(id);
    const row = csvRows.find((r) => r.id === id);
    if (!row) return;
    if (row.missing.length > 0) {
      setXrfPairError(`Row "${row.label}" is missing: ${row.missing.join(', ')} — fill those columns in the CSV and re-upload.`);
      return;
    }
    try {
      const { embedding } = getChemicalEmbedding(row.elements);
      setPairedXrf({
        embedding: Array.from(embedding),
        elements: row.elements,
        source: 'csv-upload',
        sourceNote: `${csvFilename ?? 'uploaded CSV'} — ${row.label}`,
      });
      setXrfPairError(null);
    } catch (err) {
      setXrfPairError(err.message || String(err));
    }
  }

  async function openSavedXrfPicker() {
    setXrfMode('saved');
    setXrfPairError(null);
    if (savedXrfList.length > 0) return; // already loaded this visit
    setLoadingSavedXrf(true);
    setSavedXrfError(null);
    try {
      const { data, error } = await listSavedXrfSamples(25);
      if (error) throw error;
      setSavedXrfList(data);
    } catch (err) {
      setSavedXrfError(err.message || String(err));
    } finally {
      setLoadingSavedXrf(false);
    }
  }

  function pickSavedXrf(id) {
    setSelectedSavedXrfId(id);
    const rec = savedXrfList.find((r) => r.id === id);
    if (!rec) return;
    try {
      const { embedding } = getChemicalEmbedding(rec.xrf_elements);
      setPairedXrf({
        embedding: Array.from(embedding),
        elements: rec.xrf_elements,
        source: 'saved-record',
        sourceId: rec.id,
        sourceMaterial: rec.xrf_material,
      });
      setXrfPairError(null);
    } catch (err) {
      setXrfPairError(err.message || String(err));
    }
  }

  function submitExternalXrf() {
    const parsed = {};
    for (const el of XRF_ELEMENTS) {
      const v = parseFloat(externalElements[el]);
      if (Number.isNaN(v)) {
        setXrfPairError(`Enter a number for ${el} (or 0 if not detected).`);
        return;
      }
      parsed[el] = v;
    }
    try {
      const { embedding } = getChemicalEmbedding(parsed);
      setPairedXrf({
        embedding: Array.from(embedding),
        elements: parsed,
        source: 'external-reference',
        sourceNote: externalSourceNote || '(no source noted)',
      });
      setXrfPairError(null);
    } catch (err) {
      setXrfPairError(err.message || String(err));
    }
  }
  // §20 Stage 1 — GPR-only labelled record (trains gprOnlyHead later).
  const [groundTruth, setGroundTruth] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [isSynthetic, setIsSynthetic] = useState(false); // §24 — original/synthetic tag

  // ── Batch mode: run ResNet-18 on every detection at once (instead of
  // picking one at a time) and preview all of them together as labelled
  // boxes on a single B-scan — a "black box" view like the AI Detection Lab,
  // but for the ResNet-18 crop→embedding step. Keyed by detection.id. ──
  const [batchResults, setBatchResults] = useState({}); // { [detId]: resnetOutput }
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [colormap] = useState('grey'); // grayscale-only — standard GPR B-scan display (not seismic reflection data)

  const { min: minVal, max: maxVal } = matrix ? getMatrixRange(matrix) : { min: 0, max: 1 };
  const samples = metadata?.samples ?? matrix?.length ?? 0;
  const traces  = metadata?.traces  ?? (matrix?.[0]?.length ?? 0);

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
      setBatchResults((prev) => ({ ...prev, [selectedDetection.id]: out }));
      setRunning(false);
    }, 0);
  }

  // Runs ResNet-18 over every detection in one pass — same forward pass as
  // runEmbedding(), just looped — so all crops get labelled on the B-scan
  // together instead of switching the dropdown one at a time.
  function runAllEmbeddings() {
    if (!matrix || detections.length === 0) return;
    setBatchRunning(true);
    setBatchProgress(0);
    setTimeout(() => {
      const next = {};
      detections.forEach((det, i) => {
        next[det.id] = getSpatialEmbedding(matrix, det, { size: 32, model });
        setBatchProgress(Math.round(((i + 1) / detections.length) * 100));
      });
      setBatchResults(next);
      // also populate the single-select panel with the currently selected one
      if (selectedDetection && next[selectedDetection.id]) setResult(next[selectedDetection.id]);
      setBatchRunning(false);
    }, 0);
  }

  // Detections annotated with each one's material-agnostic ResNet status
  // (ran / not yet) so HyperbolaOverlay can label them on the shared B-scan.
  const overlayDetections = detections.map((d, i) => ({
    ...d,
    label: batchResults[d.id] ? 'stone' : 'void', // stone=violet(ran), void=sky(pending) — see HyperbolaOverlay palette
    confidence: batchResults[d.id] ? 1 : 0,
  }));

  function sendToFusion() {
    if (!result) return;
    const resnetData = {
      embedding: Array.from(result.embedding),
      patch: Array.from(result.patch),
      patchSize: result.size,
      detection: selectedDetection,
      filename, scanId,
    };
    // Write to the shared, navigation-independent store FIRST so that even if
    // the user later leaves Fusion Engine to fill in the XRF half and comes
    // back, this ResNet embedding is still there (fixes "only fuses one").
    setResnet(resnetData);

    // If the user paired an XRF reading right here (saved record or external
    // reference), carry it along too — no detour through XRF Workspace
    // required. If they chose "skip", pairedXrf stays null and Fusion Engine
    // shows XRF as not-loaded exactly as before (GPR-only still works).
    let xrfState = {};
    if (pairedXrf) {
      const xrfData = {
        embedding: pairedXrf.embedding,
        elements: pairedXrf.elements,
        source: pairedXrf.source,
        sourceNote: pairedXrf.sourceNote,
        sourceId: pairedXrf.sourceId,
      };
      setXrf(xrfData);
      xrfState = { xrfEmbedding: xrfData.embedding, elements: xrfData.elements };
    }

    navigate('/fusion-engine', {
      state: {
        resnetEmbedding: resnetData.embedding,
        resnetPatch: resnetData.patch,
        resnetPatchSize: resnetData.patchSize,
        detection: selectedDetection,
        matrix, metadata, filename, scanId, velocity,
        detections,
        ...xrfState,
      },
    });
  }

  async function handleSaveLabelledRecord() {
    if (!groundTruth || !result || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const { error } = await saveLabelledRecord({
        groundTruthMaterial: groundTruth,
        resnetEmbedding: result.embedding,
        isSynthetic,
        ctx: { filename },
      });
      if (error) throw error;
      setSaveMsg({
        type: 'success',
        text: isSynthetic
          ? 'Saved and tagged synthetic — excluded from Stage 2 training queries by default, visible in Database → Browse.'
          : 'Saved as a GPR-only labelled record (trains gprOnlyHead once fusionEngine.train() is implemented — §20 Stage 2).',
      });
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message || String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!matrix || detections.length === 0) {
    return (
      <div className="min-h-full flex items-center justify-center p-6" style={{ background: '#FDFBF0' }}>
        <div className="text-center max-w-sm w-full space-y-4">
          <p className="text-stone-500">
            No detections loaded. Upload a GPR file below, run detection on a scan first via Detect, or try a sample.
          </p>

          {/* Standalone upload — parses the file then auto-runs the quick
              classical detector so a crop can be picked immediately below.
              FileLoader's built-in "synthetic demo scan" link reuses the
              same sample-detection flow as the button further down. */}
          <div className="text-left">
            <FileLoader setScan={setUploadedScan} loadDemo={loadSampleScan} scan={uploadedScan} />
          </div>

          {autoDetecting && (
            <p className="text-xs text-stone-500">Parsing file &amp; auto-detecting anomalies…</p>
          )}
          {autoDetectError && (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs p-3 text-left">
              {autoDetectError}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-stone-400">
            <div className="flex-1 h-px bg-[#F0E9B8]" /> or <div className="flex-1 h-px bg-[#F0E9B8]" />
          </div>

          <Link to="/detect" className="text-sm font-medium block" style={{ color: '#C9971A' }}>
            ← Go to Detect (full pipeline, adjustable thresholds)
          </Link>
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
            onClick={runAllEmbeddings}
            disabled={batchRunning || detections.length === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            {batchRunning ? `Running all (${batchProgress}%)…` : `Run ResNet-18 on all ${detections.length}`}
          </button>
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

      {/* Shared B-scan — every detection labelled at once, click a box's row
          in the picker (or the dropdown) to inspect that one's crop/embedding
          on the right. Violet = ResNet-18 already run, sky = not yet. */}
      <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-stone-600">
            B-scan — all {detections.length} detections at once (violet = ran, sky = pending)
          </span>
          <span className="text-xs text-stone-400 bg-[#F7F3D0] border border-[#E8DFA0] rounded px-2 py-1">
            grayscale · amplitude
          </span>
        </div>
        <div className="relative flex">
          <DepthScale samples={samples} dt_ns={metadata.dt_ns} velocity={velocity} height_px={360} />
          <div className="relative flex-1">
            <BScanViewer
              matrix={matrix}
              colormap={colormap}
              minVal={minVal}
              maxVal={maxVal}
              height={360}
              velocity={velocity}
              dt_ns={metadata.dt_ns}
              onViewChange={({ panOffset: po, zoom: z, canvasWidth: cw, canvasHeight: ch }) => {
                setPanOffset(po); setZoom(z); setCanvasSize({ width: cw, height: ch });
              }}
            />
            <HyperbolaOverlay
              detections={overlayDetections}
              canvasWidth={canvasSize.width}
              canvasHeight={canvasSize.height}
              totalTraces={traces}
              totalSamples={samples}
              panOffset={panOffset}
              zoom={zoom}
            />
          </div>
        </div>
        {Object.keys(batchResults).length > 0 && (
          <p className="text-xs text-stone-400">
            {Object.keys(batchResults).length}/{detections.length} embeddings extracted.
            Pick one below to inspect its crop, activations and 128-D vector, or send it to Fusion.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: detection picker + crop preview */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-4">
          <div>
            <label className="text-xs text-stone-400 block mb-1">Select detection</label>
            <select
              value={selectedId ?? ''}
              onChange={(e) => { setSelectedId(e.target.value); setResult(batchResults[e.target.value] ?? null); }}
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

      {result && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Add XRF before sending to Fusion (optional)
            </p>
            <p className="text-[11px] text-stone-400 mt-1 max-w-xl">
              "Send to Fusion Engine" used to go GPR-only every time, silently, with no chance to
              pair a chemistry reading here first. Pick one explicitly — or choose "skip" on
              purpose (still fine, GPR-only fusion still works):
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={openSavedXrfPicker}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={xrfMode === 'saved'
                ? { borderColor: '#C9971A', color: 'white', background: '#C9971A' }
                : { borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
            >
              Pick a saved XRF reading
            </button>
            <button
              onClick={() => { setXrfMode('external'); setXrfPairError(null); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={xrfMode === 'external'
                ? { borderColor: '#C9971A', color: 'white', background: '#C9971A' }
                : { borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
            >
              Enter reference/external XRF values
            </button>
            <button
              onClick={() => { setXrfMode('csv'); setXrfPairError(null); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={xrfMode === 'csv'
                ? { borderColor: '#C9971A', color: 'white', background: '#C9971A' }
                : { borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
            >
              Upload XRF CSV
            </button>
            <button
              onClick={() => { setXrfMode('skip'); setPairedXrf(null); setXrfPairError(null); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={xrfMode === 'skip'
                ? { borderColor: '#92692A', color: 'white', background: '#92692A' }
                : { borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
            >
              Skip — send GPR-only
            </button>
          </div>

          {/* Option 1: pick a previously-saved reading */}
          {xrfMode === 'saved' && (
            <div className="space-y-2 pt-2 border-t border-[#F0E9B8]">
              {loadingSavedXrf && <p className="text-xs text-stone-400">Loading saved XRF readings…</p>}
              {savedXrfError && <p className="text-xs text-red-600">{savedXrfError}</p>}
              {!loadingSavedXrf && !savedXrfError && savedXrfList.length === 0 && (
                <p className="text-xs text-stone-400">No saved XRF readings found yet.</p>
              )}
              {savedXrfList.length > 0 && (
                <select
                  value={selectedSavedXrfId}
                  onChange={(e) => pickSavedXrf(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm border bg-white"
                  style={{ borderColor: '#E8DFA0' }}
                >
                  <option value="">Select a saved reading…</option>
                  {savedXrfList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.created_at).toLocaleDateString()} — {r.xrf_material ?? 'unlabelled'}
                      {r.scan_filename ? ` (${r.scan_filename})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Only reuse a saved reading here if it's genuinely from the <strong>same physical
                artifact</strong> as this GPR anomaly. Pairing an unrelated object's chemistry with
                this crop is fine for exploring how Fusion behaves, but should not later be saved
                as a combined ground-truth record.
              </p>
            </div>
          )}

          {/* Option 2: enter values from an external/reference source */}
          {xrfMode === 'external' && (
            <div className="space-y-2 pt-2 border-t border-[#F0E9B8]">
              <div className="grid grid-cols-4 gap-2">
                {XRF_ELEMENTS.map((el) => (
                  <div key={el}>
                    <label className="text-[10px] text-stone-400 block mb-0.5">{el} (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={externalElements[el]}
                      onChange={(e) => setExternalElements((prev) => ({ ...prev, [el]: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm"
                      style={{ borderColor: '#E8DFA0' }}
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-stone-400 block mb-0.5">
                  Source (e.g. citation, prior study reference — not this specific artifact)
                </label>
                <input
                  type="text"
                  value={externalSourceNote}
                  onChange={(e) => setExternalSourceNote(e.target.value)}
                  placeholder="e.g. Smith et al. 2019, typical bronze artifact composition"
                  className="w-full px-2 py-1.5 rounded border text-sm"
                  style={{ borderColor: '#E8DFA0' }}
                />
              </div>
              <button
                onClick={submitExternalXrf}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                style={{ background: '#92692A' }}
              >
                Compute embedding from these values
              </button>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                This is reference/external chemistry, not a field reading of this specific
                artifact — treat any resulting fusion score as exploratory only. Do not save it
                through "Save labelled record" as this artifact's confirmed ground truth.
              </p>
            </div>
          )}

          {/* Option 3: upload a CSV — same parser/format as XRF Workspace */}
          {xrfMode === 'csv' && (
            <div className="space-y-2 pt-2 border-t border-[#F0E9B8]">
              <label
                htmlFor="resnet-xrf-csv-input"
                className="block border-2 border-dashed rounded-lg p-4 text-center text-xs cursor-pointer"
                style={{ borderColor: '#E8DFA0', background: '#FDFBF0' }}
              >
                {csvFilename ? <strong className="text-stone-700">{csvFilename}</strong> : 'Click to browse, or drag a .csv here — one row per XRF reading'}
                <input
                  id="resnet-xrf-csv-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) handleXrfCsvFile(e.target.files[0]); }}
                />
              </label>
              {csvError && <p className="text-xs text-red-600">{csvError}</p>}
              {csvRows.length > 0 && !csvError && (
                <select
                  value={selectedCsvRowId}
                  onChange={(e) => pickCsvRow(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm border bg-white"
                  style={{ borderColor: '#E8DFA0' }}
                >
                  <option value="">
                    {csvRows.length} reading{csvRows.length === 1 ? '' : 's'} parsed — select one…
                  </option>
                  {csvRows.map((r) => (
                    <option key={r.id} value={r.id} disabled={r.missing.length > 0}>
                      {r.label}{r.missing.length > 0 ? ` (missing ${r.missing.join(', ')})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Same "same physical artifact" rule applies — only save the resulting fusion as
                ground truth if this CSV row is genuinely this anomaly's own XRF reading.
              </p>
            </div>
          )}

          {xrfPairError && <p className="text-xs text-red-600">{xrfPairError}</p>}

          {pairedXrf && (
            <p className="text-xs text-emerald-700">
              ✓ XRF paired ({pairedXrf.source === 'saved-record'
                ? `saved reading, ${pairedXrf.sourceMaterial ?? 'unlabelled'}`
                : pairedXrf.source === 'csv-upload'
                ? `CSV upload — ${pairedXrf.sourceNote}`
                : `external reference — ${pairedXrf.sourceNote}`}). Will be sent along with the
              ResNet embedding.
            </p>
          )}
          {xrfMode === 'skip' && (
            <p className="text-xs text-stone-400">
              Proceeding GPR-only on purpose — Fusion Engine will show XRF as not loaded, GPR-only
              head still runs normally.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Save labelled record for training (§20)
            </p>
            <p className="text-[11px] text-stone-400 mt-1 max-w-xl">
              Confirm the actual material for this crop (human judgement, e.g. from a field log or
              this scan's known context) — this saves a GPR-only ground-truth record, distinct
              from any AI prediction, for later use training <code>gprOnlyHead</code>.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={isSynthetic}
              onChange={(e) => setIsSynthetic(e.target.checked)}
            />
            This is synthetic/demo data (e.g. §21 test files), not a real field reading
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={groundTruth}
              onChange={(e) => { setGroundTruth(e.target.value); setSaveMsg(null); }}
              className="px-3 py-2 rounded-lg text-sm border bg-white capitalize"
              style={{ borderColor: '#E8DFA0' }}
            >
              <option value="">Confirmed material…</option>
              {MATERIAL_CLASSES.map((c) => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
            <button
              onClick={handleSaveLabelledRecord}
              disabled={!groundTruth || saving}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40"
              style={{ background: '#92692A' }}
            >
              {saving ? 'Saving…' : 'Save labelled record'}
            </button>
          </div>
          {saveMsg && (
            <p className={`text-xs ${saveMsg.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
              {saveMsg.text}
            </p>
          )}
        </div>
      )}

      <StatusBar
        step={running ? 'Running ResNet-18 forward pass…' : result ? '128-D embedding extracted.' : 'Select a detection and run the network.'}
        progress={running ? 60 : result ? 100 : 0}
      />
    </div>
  );
}
