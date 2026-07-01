// AiG — Validate.jsx
// Validation & Metrics page — answers RQ4: accuracy & reliability of pre-excavation prediction.
// Reads predicted vs xrf_material from gpr_xrf_records; demo-data fallback.
// Includes "Save as Picture" button using html2canvas.

import { useState, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { evaluate } from '../utils/metrics';
import html2canvas from 'html2canvas';
import { Download, RefreshCw, Database, FlaskConical } from 'lucide-react';

// ── Demo data (48 validated objects) ─────────────────────────────────────────
const DEMO_PAIRS = [
  // bone (11)
  ...Array(10).fill({ actual: 'bone',    predicted: 'bone',    confidence: 0.91 }),
  { actual: 'bone',    predicted: 'metal',   confidence: 0.55 },
  // ceramic (14)
  ...Array(2).fill( { actual: 'ceramic', predicted: 'bone',    confidence: 0.52 }),
  ...Array(11).fill({ actual: 'ceramic', predicted: 'ceramic', confidence: 0.88 }),
  { actual: 'ceramic', predicted: 'metal',   confidence: 0.61 },
  // metal (7)
  ...Array(6).fill( { actual: 'metal',   predicted: 'metal',   confidence: 0.86 }),
  { actual: 'metal',   predicted: 'stone',   confidence: 0.63 },
  // stone (9)
  ...Array(2).fill( { actual: 'stone',   predicted: 'metal',   confidence: 0.58 }),
  ...Array(6).fill( { actual: 'stone',   predicted: 'stone',   confidence: 0.79 }),
  { actual: 'stone',   predicted: 'void',    confidence: 0.54 },
  // void (7)
  { actual: 'void',    predicted: 'ceramic', confidence: 0.51 },
  ...Array(6).fill( { actual: 'void',    predicted: 'void',    confidence: 0.87 }),
];

const MATERIAL_COLORS = {
  bone:    '#C9971A',
  ceramic: '#7C6E3A',
  metal:   '#4A7FA5',
  stone:   '#6B7280',
  void:    '#9CA3AF',
};

function pct(n) { return typeof n === 'number' ? (n * 100).toFixed(0) + '%' : '—'; }
function f2(n)  { return typeof n === 'number' ? n.toFixed(2) : '—'; }

// ── Calibration bar ───────────────────────────────────────────────────────────
function CalBar({ bucket }) {
  const accW  = bucket.count ? bucket.accuracy * 100 : 0;
  const confW = bucket.count ? bucket.avgConfidence * 100 : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-stone-500 mb-1">
        <span>{bucket.range}</span>
        <span>{bucket.count ? pct(bucket.accuracy) + ' acc' : '—'}</span>
      </div>
      <div className="relative h-4 rounded bg-stone-100">
        <div className="absolute inset-y-0 left-0 rounded bg-amber-200" style={{ width: confW + '%' }} />
        <div className="absolute inset-y-0 left-0 rounded bg-amber-500 opacity-80" style={{ width: accW + '%' }} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Validate() {
  const { isGuest } = useAuth();
  const [source, setSource]   = useState('demo');   // 'demo' | 'db'
  const [result, setResult]   = useState(() => evaluate(DEMO_PAIRS));
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const reportRef = useRef(null);

  // ── Load from Supabase ──────────────────────────────────────────────────────
  async function loadFromDB() {
    if (!isSupabaseConfigured || isGuest) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('gpr_xrf_records')
        .select('xrf_material, predicted_material, predicted_confidence')
        .not('predicted_material', 'is', null);
      if (err) throw err;
      if (!data.length) throw new Error('No validated records found in database yet.');
      const pairs = data.map(r => ({
        actual:     r.xrf_material,
        predicted:  r.predicted_material,
        confidence: r.predicted_confidence ?? 0.5,
      }));
      setResult(evaluate(pairs));
      setSource('db');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function loadDemo() {
    setResult(evaluate(DEMO_PAIRS));
    setSource('demo');
    setError(null);
  }

  // ── Save as Picture ─────────────────────────────────────────────────────────
  async function saveAsPicture() {
    if (!reportRef.current) return;
    setSaving(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#FDFBF0',
        scale: 2,               // 2× for retina sharpness
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `AiG-Validation-${new Date().toISOString().slice(0,10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Screenshot failed:', e);
    } finally {
      setSaving(false);
    }
  }

  const { n, labels, accuracy: acc, confusion, perClass, calibration } = result;

  return (
    <div className="min-h-screen bg-[#FDFBF0] p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Validation &amp; Metrics</h1>
          <p className="mt-1 text-sm text-stone-500">
            Predicted material (from GPR pattern) vs ground-truth (pXRF / excavation).
            This answers <strong>RQ4</strong> — the accuracy &amp; reliability of pre-excavation prediction.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={loadDemo}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
          >
            <FlaskConical className="h-4 w-4" />
            Demo data
          </button>

          {isSupabaseConfigured && !isGuest && (
            <button
              onClick={loadFromDB}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Database
            </button>
          )}

          {/* Save as Picture */}
          <button
            onClick={saveAsPicture}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-[#C9971A] px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save as Picture'}
          </button>
        </div>
      </div>

      {/* Source badge */}
      <div className="mb-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          source === 'demo'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-green-100 text-green-800'
        }`}>
          {source === 'demo' ? '⚗️ Demo data' : '🗄️ Database'}
        </span>
        {source === 'demo' && (
          <span className="ml-2 text-xs text-stone-400">
            Showing built-in demo data — switch to "Database" once you have confirmed pXRF records.
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Capturable report section ── */}
      <div ref={reportRef} className="space-y-6 bg-[#FDFBF0] p-2">

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Accuracy',    value: pct(acc),           sub: `${n} validated objects` },
            { label: 'Macro F1',    value: f2(perClass.macro?.f1),    sub: 'unweighted mean' },
            { label: 'Weighted F1', value: f2(perClass.weighted?.f1), sub: 'by support' },
            { label: 'Materials',   value: labels.length,       sub: labels.join(', ') },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{s.label}</p>
              <p className="mt-1 text-3xl font-bold text-[#C9971A]">{s.value}</p>
              <p className="mt-0.5 text-xs text-stone-400 truncate">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Confusion matrix */}
          <div className="rounded-xl border border-amber-100 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-stone-700">Confusion Matrix</h2>
            <p className="mb-4 text-xs text-stone-400">Rows = actual (pXRF) · Columns = predicted (AiG)</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="py-1 pr-3 text-left text-stone-400" />
                    {labels.map(l => (
                      <th key={l} className="px-2 py-1 text-center font-semibold text-stone-600">{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((actual, ri) => (
                    <tr key={actual}>
                      <td className="py-1 pr-3 font-semibold text-stone-600">{actual}</td>
                      {labels.map((predicted, ci) => {
                        const val = confusion.matrix[ri]?.[ci] ?? 0;
                        const isCorrect = ri === ci;
                        return (
                          <td key={predicted} className={`px-2 py-1 text-center font-mono rounded ${
                            isCorrect
                              ? 'bg-amber-100 font-bold text-amber-800'
                              : val > 0
                                ? 'bg-red-50 text-red-600'
                                : 'text-stone-300'
                          }`}>
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Confidence calibration */}
          <div className="rounded-xl border border-amber-100 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-stone-700">Confidence Calibration</h2>
            <p className="mb-4 text-xs text-stone-400">
              Well-calibrated = accuracy (gold) close to confidence (grey) in each bucket.
            </p>
            {calibration.map((b, i) => (
              <CalBar key={i} bucket={b} />
            ))}
            <div className="mt-3 flex items-center gap-4 text-xs text-stone-400">
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-200" /> Confidence</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-amber-500 opacity-80" /> Accuracy</span>
            </div>
          </div>
        </div>

        {/* Per-material table */}
        <div className="rounded-xl border border-amber-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-stone-700">Per-Material Performance</h2>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs uppercase tracking-wide text-stone-400">
                {['Material', 'Precision', 'Recall', 'F1', 'Support'].map(h => (
                  <th key={h} className="pb-2 pr-4 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {perClass.rows.map(row => (
                <tr key={row.label}>
                  <td className="py-2 pr-4 font-medium text-stone-700 flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: MATERIAL_COLORS[row.label] ?? '#6B7280' }} />
                    {row.label}
                  </td>
                  <td className="py-2 pr-4 font-mono text-stone-600">{f2(row.precision)}</td>
                  <td className="py-2 pr-4 font-mono text-stone-600">{f2(row.recall)}</td>
                  <td className="py-2 pr-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      row.f1 >= 0.8 ? 'bg-green-100 text-green-700'
                      : row.f1 >= 0.6 ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                    }`}>
                      {f2(row.f1)}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-stone-400">{row.support}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-stone-200 text-xs text-stone-400">
              <tr>
                <td className="pt-2 font-medium">Macro avg</td>
                <td colSpan={2} />
                <td className="pt-2 font-mono font-semibold text-stone-600">{f2(perClass.macro?.f1)}</td>
                <td className="pt-2 font-mono">{n}</td>
              </tr>
            </tfoot>
          </table>
        </div>

      </div>{/* end reportRef */}
    </div>
  );
}