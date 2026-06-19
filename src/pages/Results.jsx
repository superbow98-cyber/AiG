// AiG — Results.jsx
// Final report page — summary stats + ObjectMap + ResultCard list + PDF/CSV export.
//
// Reads:  location.state { matrix, metadata, velocity, filename, scanId, detections }
//         detections here are ClassificationResults (from Classify.jsx)
// Export: generatePDFReport, exportCSV, exportJSON from exportResults.js
//
// Consumed by: App.jsx (route /results)

import { useState, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { supabase }        from '../lib/supabase';
import ObjectMap           from '../components/ObjectMap';
import ResultCard          from '../components/ResultCard';
import StatusBar           from '../components/StatusBar';
import { generatePDFReport, exportCSV, exportJSON } from '../utils/exportResults';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statCards(detections, scanLengthM) {
  if (!detections.length) return [];
  const depths  = detections.map((d) => d.depth_m).filter(Boolean);
  const mats    = detections.map((d) => d.material ?? d.label ?? 'unknown');
  const matFreq = mats.reduce((acc, m) => { acc[m] = (acc[m] ?? 0) + 1; return acc; }, {});
  const topMat  = Object.entries(matFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  const avgConf = detections.reduce((s, d) => s + (d.confidence ?? 0), 0) / detections.length;

  return [
    { label: 'Objects detected', value: detections.length },
    { label: 'Deepest object',   value: `${Math.max(...depths).toFixed(2)}m` },
    { label: 'Most common material', value: topMat, capitalize: true },
    { label: 'Avg confidence',   value: `${Math.round(avgConf * 100)}%` },
    { label: 'Survey length',    value: `${scanLengthM.toFixed(1)}m` },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Results() {
  const location   = useLocation();
  const state      = location.state;
  const mapRef     = useRef(null);

  const detections  = state?.detections ?? [];
  const metadata    = state?.metadata   ?? null;
  const velocity    = state?.velocity   ?? 0.1;
  const filename    = state?.filename   ?? 'scan';
  const scanId      = state?.scanId     ?? null;
  const dx_m        = metadata?.dx_m    ?? 0.02;
  const scanLengthM = (metadata?.traces ?? 0) * dx_m;

  const [exporting,  setExporting]  = useState(false);
  const [exportMsg,  setExportMsg]  = useState('');
  const [saveStatus, setSaveStatus] = useState({}); // { [det.id]: 'saving'|'saved'|'error' }
  const [filter,     setFilter]     = useState('all');

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!detections.length) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-gray-400">No results to display.</p>
        <Link to="/detect" className="text-emerald-400 hover:underline text-sm">
          ← Back to Detect
        </Link>
      </div>
    );
  }

  // ── Filtered detections ────────────────────────────────────────────────────
  const materials = ['all', ...new Set(detections.map((d) => d.material ?? d.label ?? 'unknown'))];
  const filtered  = filter === 'all'
    ? detections
    : detections.filter((d) => (d.material ?? d.label) === filter);

  // ── Export handlers ────────────────────────────────────────────────────────
  async function handleExportPDF() {
    setExporting(true);
    setExportMsg('Generating PDF…');
    try {
      await generatePDFReport(detections, { filename, metadata, velocity, scanLengthM });
      setExportMsg('PDF downloaded ✓');
    } catch (e) {
      setExportMsg(`PDF error: ${e.message}`);
    } finally {
      setExporting(false);
      setTimeout(() => setExportMsg(''), 4000);
    }
  }

  function handleExportCSV() {
    exportCSV(detections, filename);
    setExportMsg('CSV downloaded ✓');
    setTimeout(() => setExportMsg(''), 3000);
  }

  function handleExportJSON() {
    exportJSON(detections, filename);
    setExportMsg('JSON downloaded ✓');
    setTimeout(() => setExportMsg(''), 3000);
  }

  // ── Save single record to Supabase ────────────────────────────────────────
  async function handleSaveToDb(det) {
    setSaveStatus((s) => ({ ...s, [det.id]: 'saving' }));
    try {
      const { error } = await supabase.from('gpr_xrf_records').insert({
        scan_filename:   filename,
        gpr_signature:   Array.from(det.features ?? []),
        hyperbola_shape: det.hyperbola ?? null,
        position_trace:  det.trace ?? null,
        position_m:      det.position_m ?? null,
        depth_ns:        det.depth_ns ?? null,
        depth_m:         det.depth_m ?? null,
        size_width_cm:   det.size_width_cm ?? null,
        size_height_cm:  det.size_height_cm ?? null,
        xrf_material:    det.material ?? det.label ?? null,
        xrf_elements:    det.xrf_elements ?? null,
      });
      if (error) throw error;
      setSaveStatus((s) => ({ ...s, [det.id]: 'saved' }));
    } catch (e) {
      setSaveStatus((s) => ({ ...s, [det.id]: 'error' }));
    }
  }

  // ── Save all to Supabase ───────────────────────────────────────────────────
  async function handleSaveAll() {
    setExporting(true);
    setExportMsg('Saving all records…');
    let saved = 0;
    for (const det of detections) {
      if (saveStatus[det.id] === 'saved') continue;
      try {
        await handleSaveToDb(det);
        saved++;
      } catch (_) {}
    }
    setExporting(false);
    setExportMsg(`${saved} record${saved !== 1 ? 's' : ''} saved to database ✓`);
    setTimeout(() => setExportMsg(''), 4000);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const stats = statCards(detections, scanLengthM);

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Results Report</h1>
          <p className="text-sm text-gray-400 mt-0.5">{filename}</p>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200
                       text-xs font-semibold rounded-lg transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJSON}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200
                       text-xs font-semibold rounded-lg transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-600
                       text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {exporting ? 'Generating…' : 'Export PDF'}
          </button>
          <button
            onClick={handleSaveAll}
            disabled={exporting}
            className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600
                       text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Save All to DB
          </button>
        </div>
      </div>

      {/* Export status */}
      {exportMsg && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2
                        text-sm text-gray-300 font-mono">
          {exportMsg}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-5 gap-3">
        {stats.map(({ label, value, capitalize }) => (
          <div key={label} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-xl font-bold text-emerald-400 ${capitalize ? 'capitalize' : ''}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Object map */}
      <div ref={mapRef}>
        <ObjectMap
          detections={detections}
          scanLengthM={scanLengthM}
          velocity={velocity}
        />
      </div>

      {/* Material filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {materials.map((mat) => (
          <button
            key={mat}
            onClick={() => setFilter(mat)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full capitalize transition-colors
              ${filter === mat
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
          >
            {mat}
            {mat !== 'all' && (
              <span className="ml-1 opacity-60">
                ({detections.filter((d) => (d.material ?? d.label) === mat).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Result cards */}
      <div className="space-y-4">
        {filtered.map((det, i) => (
          <ResultCard
            key={det.id}
            object={det}
            index={detections.indexOf(det) + 1}
            onSaveToDb={
              saveStatus[det.id] !== 'saved'
                ? () => handleSaveToDb(det)
                : undefined
            }
          />
        ))}
      </div>

      {/* Material breakdown table */}
      {detections.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-300">Material Breakdown</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
              <tr>
                {['Material', 'Count', 'Avg Depth', 'Avg Confidence'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {Object.entries(
                detections.reduce((acc, d) => {
                  const m = d.material ?? d.label ?? 'unknown';
                  if (!acc[m]) acc[m] = { count: 0, depthSum: 0, confSum: 0 };
                  acc[m].count++;
                  acc[m].depthSum += d.depth_m ?? 0;
                  acc[m].confSum  += d.confidence ?? 0;
                  return acc;
                }, {})
              )
                .sort((a, b) => b[1].count - a[1].count)
                .map(([mat, { count, depthSum, confSum }]) => (
                  <tr key={mat} className="hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-2 text-white capitalize font-medium">{mat}</td>
                    <td className="px-4 py-2 text-gray-300 font-mono">{count}</td>
                    <td className="px-4 py-2 text-gray-300 font-mono">
                      {(depthSum / count).toFixed(2)}m
                    </td>
                    <td className="px-4 py-2 text-gray-300 font-mono">
                      {Math.round((confSum / count) * 100)}%
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
