// AiG — XRFWorkspace.jsx
// AI Research Lab · XRF AI Workspace
// Pipeline: 8 elements (Fe,Cu,Pb,Ca,Si,Al,Ti,Zn) → MLP (8→64→32) →
// chemical embedding + fingerprint + feature importance + confidence.
//
// Reads:  optional location.state.detection / scan info (for context header only)
// Passes: → /fusion-engine ({ xrfEmbedding, elements, ...scan info })

import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { UploadCloud, FileWarning, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  XRF_ELEMENTS,
  XRF_REFERENCE_RANGES,
  getChemicalEmbedding,
  getDefaultXRFMLP,
} from '../models/xrfMLP';
import { parseXRFCsv } from '../utils/xrfCsv';
import { useFusionWorkspace } from '../context/FusionWorkspaceContext';

const DEFAULT_ELEMENTS = XRF_ELEMENTS.reduce((acc, el) => {
  const { typical } = XRF_REFERENCE_RANGES[el];
  acc[el] = Number(((typical[0] + typical[1]) / 2).toFixed(2));
  return acc;
}, {});

function FingerprintBar({ fingerprint }) {
  return (
    <div className="space-y-1.5">
      {XRF_ELEMENTS.map((el) => (
        <div key={el} className="flex items-center gap-2">
          <span className="text-xs text-stone-500 w-8">{el}</span>
          <div className="flex-1 h-2 bg-[#F7F3D0] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round((fingerprint[el] ?? 0) * 100)}%`, background: '#C9971A' }}
            />
          </div>
          <span className="text-xs text-stone-400 font-mono w-9 text-right">
            {Math.round((fingerprint[el] ?? 0) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function ImportanceBar({ importance }) {
  const sorted = XRF_ELEMENTS
    .map((el) => ({ el, v: importance[el] ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const max = Math.max(1e-6, ...sorted.map((d) => d.v));
  return (
    <div className="space-y-1.5">
      {sorted.map(({ el, v }) => (
        <div key={el} className="flex items-center gap-2">
          <span className="text-xs text-stone-500 w-8">{el}</span>
          <div className="flex-1 h-2 bg-[#F7F3D0] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round((v / max) * 100)}%`, background: '#92692A' }}
            />
          </div>
          <span className="text-xs text-stone-400 font-mono w-9 text-right">
            {Math.round(v * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function XRFWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state ?? {};
  const { setXrf } = useFusionWorkspace();

  const [elements, setElements] = useState(state.elements ?? DEFAULT_ELEMENTS);
  const [result, setResult] = useState(null);
  const [dbRecords, setDbRecords] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [started, setStarted] = useState(false);

  // ── CSV upload: one row = one XRF reading. Parsed client-side via
  // utils/xrfCsv.js (case-insensitive match against XRF_ELEMENTS), then
  // picked from a dropdown — same pattern as the existing "Load from
  // database" select below. Purely additive: manual entry and the
  // database dropdown are untouched. ──
  const [csvRows, setCsvRows] = useState([]);
  const [csvFilename, setCsvFilename] = useState(null);
  const [csvError, setCsvError] = useState(null);
  const [selectedCsvRowId, setSelectedCsvRowId] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const csvInputRef = useRef(null);

  function handleCsvFile(file) {
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
      setStarted(true); // reveal the main view immediately, same as §12a's upload→auto-detect→reveal flow
    };
    reader.onerror = () => setCsvError('Could not read the file.');
    reader.readAsText(file);
  }

  function onCsvDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleCsvFile(file);
  }

  // "Try a sample" path — same role as ResNet-18's loadSampleScan(): clearly
  // synthetic values (typical range midpoint ± small jitter), not real data,
  // labelled as a sample in the UI. Reveals the main view but does NOT
  // auto-run the MLP — user still clicks "Run XRF MLP" themselves.
  function loadSampleReading() {
    const sample = XRF_ELEMENTS.reduce((acc, el) => {
      const { typical } = XRF_REFERENCE_RANGES[el];
      const mid = (typical[0] + typical[1]) / 2;
      const jitter = (typical[1] - typical[0]) * 0.15 * (Math.random() * 2 - 1);
      acc[el] = Number(Math.max(0, mid + jitter).toFixed(2));
      return acc;
    }, {});
    setElements(sample);
    setResult(null);
    setStarted(true);
  }

  function loadCsvRow(id) {
    setSelectedCsvRowId(id);
    const row = csvRows.find((r) => r.id === id);
    if (row) {
      const merged = { ...DEFAULT_ELEMENTS, ...row.elements };
      setElements(merged);
      setResult(null);
    }
  }

  const model = useMemo(() => getDefaultXRFMLP(), []);

  // Optional: pull existing xrf_elements from gpr_xrf_records so a researcher
  // can inspect a real historical reading instead of typing values by hand.
  // Read-only fetch — does not touch the existing Database.jsx page/table.
  useEffect(() => {
    supabase
      .from('gpr_xrf_records')
      .select('id, site_id, xrf_material, xrf_elements')
      .not('xrf_elements', 'is', null)
      .limit(50)
      .then(({ data, error }) => {
        if (!error && data) setDbRecords(data);
      })
      .catch(() => {});
  }, []);

  function handleElementChange(el, value) {
    setElements((prev) => ({ ...prev, [el]: value === '' ? '' : Number(value) }));
    setResult(null);
  }

  function loadRecord(id) {
    setSelectedRecordId(id);
    const rec = dbRecords.find((r) => String(r.id) === String(id));
    if (rec?.xrf_elements) {
      const merged = { ...DEFAULT_ELEMENTS, ...rec.xrf_elements };
      setElements(merged);
      setResult(null);
    }
  }

  function runMLP() {
    const out = getChemicalEmbedding(elements, { model });
    setResult(out);
  }

  function sendToFusion() {
    if (!result) return;
    const xrfData = { embedding: Array.from(result.embedding), elements };
    // Write to the shared, navigation-independent store FIRST. Previously,
    // navigating here directly (not via Fusion Engine's "Not loaded" link)
    // meant `state` was empty, so this navigate() call below would carry
    // ONLY the xrfEmbedding — silently discarding any ResNet embedding the
    // user had already loaded on the Fusion Engine page in an earlier visit.
    // setXrf keeps that ResNet half intact regardless of how this page was
    // reached.
    setXrf(xrfData);
    navigate('/fusion-engine', {
      state: {
        ...state,
        xrfEmbedding: xrfData.embedding,
        elements,
      },
    });
  }

  return (
    <div className="min-h-full p-6 space-y-6" style={{ background: '#FDFBF0' }}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#C9971A' }}>
            AI Research Lab
          </p>
          <h1 className="text-2xl font-bold text-stone-800">XRF AI Workspace</h1>
          <p className="text-stone-500 text-sm mt-1">
            8 elements → MLP (8→64→32) → chemical embedding, fingerprint, feature importance
          </p>
        </div>
        {started && (
          <button
            onClick={sendToFusion}
            disabled={!result}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-40"
            style={{ background: '#C9971A' }}
          >
            Send to Fusion Engine →
          </button>
        )}
      </div>

      <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#E8DFA0', background: '#F7F3D0', color: '#92692A' }}>
        <strong>Architecture demo — untrained weights.</strong> The MLP forward pass is real, but
        weights are seeded, not fit on labelled GPR+XRF ground truth. "Confidence" below is an
        <em> input-typicality</em> score (how close readings sit to expected geochemical ranges) —
        not a trained classifier's confidence in a material label.
      </div>

      {!started ? (
        <div className="min-h-full flex items-center justify-center p-6" style={{ background: '#FDFBF0' }}>
          <div className="text-center max-w-sm w-full space-y-4">
            <p className="text-stone-500">
              Feed 8 XRF elemental readings into a small MLP and inspect the resulting chemical
              fingerprint, feature importance, and embedding. Upload a CSV below, or try a sample.
            </p>

            <div className="text-left">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onCsvDrop}
                onClick={() => csvInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <UploadCloud className="h-10 w-10 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">
                  Drag &amp; drop a CSV here, or click to browse
                </p>
                <p className="text-xs text-gray-500">
                  One row per reading — header names Fe, Cu, Pb, Ca, Si, Al, Ti, Zn
                </p>
                <input
                  ref={csvInputRef}
                  type="file"
                  className="hidden"
                  accept=".csv"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleCsvFile(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
              </div>

              {csvError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 mt-2 text-sm text-red-700">
                  <FileWarning className="h-4 w-4 flex-shrink-0" />
                  <span>{csvError}</span>
                </div>
              )}

              <div className="text-center mt-3">
                <button type="button" onClick={loadSampleReading}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
                  Or try a sample XRF reading
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-stone-400">
              <div className="flex-1 h-px bg-[#F0E9B8]" /> or <div className="flex-1 h-px bg-[#F0E9B8]" />
            </div>

            <button
              onClick={() => setStarted(true)}
              className="text-sm font-medium block w-full"
              style={{ color: '#C9971A' }}
            >
              Enter values manually →
            </button>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inputs */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-4">
          <div>
            <label className="text-xs text-stone-400 block mb-1">Upload XRF readings (.csv)</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onCsvDrop}
              onClick={() => csvInputRef.current?.click()}
              className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs cursor-pointer transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-[#E8DFA0] bg-[#FDFBF0] text-stone-500 hover:border-[#C9971A]'
              }`}
            >
              <UploadCloud className="h-4 w-4 flex-shrink-0" style={{ color: '#C9971A' }} />
              <span>
                {csvFilename ? <strong className="text-stone-700">{csvFilename}</strong> : 'Click to browse — one row per reading'}
              </span>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleCsvFile(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </div>

            {csvError && (
              <div className="flex items-start gap-1.5 mt-1.5 text-xs text-red-700">
                <FileWarning className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{csvError}</span>
              </div>
            )}

            {csvRows.length > 0 && !csvError && (
              <>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{csvRows.length} reading{csvRows.length === 1 ? '' : 's'} parsed.</span>
                </div>
                <select
                  value={selectedCsvRowId}
                  onChange={(e) => loadCsvRow(e.target.value)}
                  className="w-full mt-2 bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— select a row —</option>
                  {csvRows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}{r.missing.length ? ` (missing: ${r.missing.join(', ')})` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {dbRecords.length > 0 && (
            <div>
              <label className="text-xs text-stone-400 block mb-1">Load from database (optional)</label>
              <select
                value={selectedRecordId}
                onChange={(e) => loadRecord(e.target.value)}
                className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">— manual entry —</option>
                {dbRecords.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.site_id ?? r.id} — {r.xrf_material ?? 'unlabelled'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            {XRF_ELEMENTS.map((el) => (
              <div key={el} className="flex items-center gap-3">
                <label className="text-sm text-stone-600 w-10">{el}</label>
                <input
                  type="number"
                  step="0.01"
                  value={elements[el] ?? ''}
                  onChange={(e) => handleElementChange(el, e.target.value)}
                  className="flex-1 bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg px-3 py-1.5 text-sm font-mono"
                />
                <span className="text-xs text-stone-400 w-8">wt%</span>
              </div>
            ))}
          </div>

          <button
            onClick={runMLP}
            className="w-full px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            Run XRF MLP
          </button>
        </div>

        {/* Fingerprint + importance */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Chemical fingerprint</p>
            {result
              ? <FingerprintBar fingerprint={result.fingerprint} />
              : <p className="text-xs text-stone-400">Run the MLP to see the fingerprint.</p>}
          </div>
          <div className="pt-2 border-t border-[#F0E9B8]">
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Feature importance</p>
            {result
              ? <ImportanceBar importance={result.importance} />
              : <p className="text-xs text-stone-400">Perturbation sensitivity per element.</p>}
          </div>
        </div>

        {/* Embedding + confidence */}
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Input typicality confidence</p>
            {result ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-[#F7F3D0] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(result.confidence * 100)}%`, background: '#C9971A' }}
                  />
                </div>
                <span className="text-sm font-mono text-stone-700">{Math.round(result.confidence * 100)}%</span>
              </div>
            ) : <p className="text-xs text-stone-400">—</p>}
          </div>

          <div className="pt-2 border-t border-[#F0E9B8]">
            <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">32-D chemical embedding</p>
            {result ? (
              <>
                <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(8, 1fr)' }}>
                  {Array.from(result.embedding).map((v, i) => {
                    const max = Math.max(1e-6, ...Array.from(result.embedding, Math.abs));
                    const t = Math.abs(v) / max;
                    return (
                      <div
                        key={i}
                        title={`dim ${i}: ${v.toFixed(4)}`}
                        className="aspect-square rounded-sm"
                        style={{ background: `hsl(${v >= 0 ? 40 : 0} 80% ${85 - t * 45}%)` }}
                      />
                    );
                  })}
                </div>
                <details className="text-xs mt-2">
                  <summary className="cursor-pointer text-stone-500">View raw vector (JSON)</summary>
                  <pre className="mt-2 p-2 bg-[#FDFBF0] rounded-lg overflow-x-auto text-[10px] text-stone-600">
                    {JSON.stringify(Array.from(result.embedding).map((v) => Number(v.toFixed(4))))}
                  </pre>
                </details>
              </>
            ) : <p className="text-xs text-stone-400">Run the MLP to see the embedding.</p>}
          </div>
        </div>
      </div>
      )}

      <p className="text-xs text-stone-400">
        Want to inspect a GPR anomaly's spatial embedding too? <Link to="/resnet-spatial" className="underline" style={{ color: '#C9971A' }}>Open ResNet-18 Spatial AI Module</Link>
      </p>
    </div>
  );
}
