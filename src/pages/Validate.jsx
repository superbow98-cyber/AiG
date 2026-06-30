// AiG — Validate.jsx
// Stage 5 · Validation & Metrics — answers PhD RQ4:
//   "What is the accuracy and reliability of pre-excavation material prediction?"
//
// Compares the material AiG PREDICTED (from the GPR pattern) against the
// ground-truth material CONFIRMED by pXRF / excavation, and reports
// accuracy, confusion matrix, per-material precision/recall/F1, and
// confidence calibration.
//
// Data sources:
//   • Supabase `gpr_xrf_records` rows that have BOTH a predicted_material and a
//     confirmed xrf_material (the validation set).
//   • A built-in demo evaluation, so the page is useful before real data exists.
//
// Consumed by: App.jsx (route /validate)

import { useState, useEffect } from 'react';
import { ClipboardCheck, Database as DbIcon, FlaskConical, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { evaluate } from '../utils/metrics';

const MATERIALS = ['ceramic', 'metal', 'bone', 'stone', 'void'];

// Deterministic-ish synthetic validation set (~82% accuracy, calibrated-ish).
function demoPairs(n = 48) {
  const out = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) {
    const actual = MATERIALS[Math.floor(rnd() * MATERIALS.length)];
    const correct = rnd() < 0.82;
    let predicted = actual;
    if (!correct) {
      do { predicted = MATERIALS[Math.floor(rnd() * MATERIALS.length)]; }
      while (predicted === actual);
    }
    const confidence = correct
      ? 0.6 + rnd() * 0.4
      : 0.3 + rnd() * 0.4;
    out.push({ predicted, actual, confidence: +confidence.toFixed(2) });
  }
  return out;
}

function pct(x) { return `${Math.round(x * 100)}%`; }

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-[#F0E9B8] rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent ? 'text-[#C9971A]' : 'text-stone-800'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

export default function Validate() {
  const [source, setSource] = useState('database'); // 'database' | 'demo'
  const [dbPairs, setDbPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setDbError(null);
      try {
        // Try to read predicted + confirmed columns; tolerate older schemas.
        let { data, error } = await supabase
          .from('gpr_xrf_records')
          .select('xrf_material, predicted_material, predicted_confidence');
        if (error) {
          const fallback = await supabase
            .from('gpr_xrf_records')
            .select('xrf_material');
          data = fallback.data;
        }
        if (!active) return;
        const pairs = (data ?? [])
          .filter((r) => r.xrf_material && r.predicted_material)
          .map((r) => ({
            actual: r.xrf_material,
            predicted: r.predicted_material,
            confidence: typeof r.predicted_confidence === 'number' ? r.predicted_confidence : undefined,
          }));
        setDbPairs(pairs);
      } catch (e) {
        if (active) setDbError(e.message ?? 'Failed to load records');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const pairs = source === 'demo' ? demoPairs() : dbPairs;
  const hasData = pairs.length > 0;
  const ev = hasData ? evaluate(pairs) : null;

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9971A] bg-[#F7F3D0] border border-[#E8DFA0] px-2 py-0.5 rounded-full">
          Stage 5 · Validation
        </span>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-[#C9971A]" />
            Validation &amp; Metrics
          </h1>
          <p className="text-stone-500 text-sm mt-1 max-w-2xl">
            Predicted material (from GPR pattern) vs ground-truth (pXRF / excavation).
            This answers RQ4 — the accuracy &amp; reliability of pre-excavation prediction.
          </p>
        </div>
        {/* Source toggle */}
        <div className="flex rounded-lg overflow-hidden border border-[#E8DFA0]">
          {[
            { v: 'database', label: 'Database', Icon: DbIcon },
            { v: 'demo', label: 'Demo data', Icon: FlaskConical },
          ].map(({ v, label, Icon }) => (
            <button
              key={v}
              onClick={() => setSource(v)}
              className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                source === v ? 'bg-[#C9971A] text-white' : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty / loading states for DB source */}
      {source === 'database' && loading && (
        <div className="p-10 text-center text-sm text-stone-400">Loading validation set…</div>
      )}

      {source === 'database' && !loading && !hasData && (
        <div className="bg-white border border-[#F0E9B8] rounded-2xl p-8 text-center">
          <Info className="w-6 h-6 text-[#C9971A] mx-auto mb-3" />
          <p className="text-stone-700 font-medium mb-1">No validation pairs yet</p>
          <p className="text-sm text-stone-500 max-w-md mx-auto mb-4">
            A validation pair needs both a <strong>predicted_material</strong> (what AiG predicted)
            and a confirmed <strong>xrf_material</strong> (ground truth) on the same record.
            Run Classify, then confirm the real material after pXRF/excavation.
          </p>
          <button
            onClick={() => setSource('demo')}
            className="px-4 py-2 rounded-lg bg-[#F7F3D0] border border-[#E8DFA0] text-sm font-medium text-stone-700 hover:bg-[#F0E9B8] transition-colors"
          >
            Show demo evaluation instead
          </button>
          {dbError && <p className="text-xs text-red-600 mt-3">{dbError}</p>}
        </div>
      )}

      {/* Metrics */}
      {ev && (
        <div className="space-y-6">
          {/* Top stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Accuracy" value={pct(ev.accuracy)} sub={`${ev.n} validated objects`} accent />
            <StatCard label="Macro F1" value={ev.perClass.macro.f1.toFixed(2)} sub="unweighted mean" />
            <StatCard label="Weighted F1" value={ev.perClass.weighted.f1.toFixed(2)} sub="by support" />
            <StatCard label="Materials" value={ev.labels.length} sub={ev.labels.join(', ')} />
          </div>

          {/* Confusion matrix */}
          <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F0E9B8]">
              <h2 className="text-sm font-semibold text-stone-700">Confusion Matrix</h2>
              <p className="text-xs text-stone-400 mt-0.5">Rows = actual (pXRF) · Columns = predicted (AiG)</p>
            </div>
            <div className="p-5 overflow-x-auto">
              <table className="text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="p-2 text-stone-400 text-xs"></th>
                    {ev.confusion.labels.map((l) => (
                      <th key={l} className="p-2 text-xs font-semibold text-stone-500 capitalize">{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ev.confusion.matrix.map((row, i) => {
                    const rowTotal = row.reduce((s, v) => s + v, 0) || 1;
                    return (
                      <tr key={i}>
                        <td className="p-2 text-xs font-semibold text-stone-500 capitalize text-right">
                          {ev.confusion.labels[i]}
                        </td>
                        {row.map((v, j) => {
                          const intensity = v / rowTotal;
                          const isDiag = i === j;
                          const bg = isDiag
                            ? `rgba(22,163,74,${0.12 + intensity * 0.6})`
                            : v > 0 ? `rgba(220,38,38,${0.10 + intensity * 0.5})` : 'transparent';
                          return (
                            <td key={j} className="p-0">
                              <div
                                className="w-12 h-10 flex items-center justify-center text-sm font-mono text-stone-700 rounded m-0.5"
                                style={{ background: bg }}
                              >
                                {v}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-class metrics */}
          <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F0E9B8]">
              <h2 className="text-sm font-semibold text-stone-700">Per-Material Performance</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#FDFBF0] text-stone-400 text-xs uppercase tracking-wide">
                <tr>
                  {['Material', 'Precision', 'Recall', 'F1', 'Support'].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0E9B8]">
                {ev.perClass.rows.map((r) => (
                  <tr key={r.label} className="hover:bg-[#FDFBF0]">
                    <td className="px-5 py-2.5 text-stone-700 font-medium capitalize">{r.label}</td>
                    <td className="px-5 py-2.5 font-mono text-stone-600">{r.precision.toFixed(2)}</td>
                    <td className="px-5 py-2.5 font-mono text-stone-600">{r.recall.toFixed(2)}</td>
                    <td className="px-5 py-2.5 font-mono text-stone-600">{r.f1.toFixed(2)}</td>
                    <td className="px-5 py-2.5 font-mono text-stone-400">{r.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Calibration */}
          <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F0E9B8]">
              <h2 className="text-sm font-semibold text-stone-700">Confidence Calibration</h2>
              <p className="text-xs text-stone-400 mt-0.5">
                Well-calibrated = accuracy (gold) close to confidence (grey) in each bucket.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {ev.calibration.map((b) => (
                <div key={b.range} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-stone-400 w-16 shrink-0">{b.range}</span>
                  <div className="flex-1 space-y-1">
                    <div className="h-3 rounded-full bg-[#F7F3D0] overflow-hidden">
                      <div className="h-full bg-[#C9971A]" style={{ width: pct(b.accuracy) }} />
                    </div>
                    <div className="h-2 rounded-full bg-[#F7F3D0] overflow-hidden">
                      <div className="h-full bg-stone-400" style={{ width: pct(b.avgConfidence) }} />
                    </div>
                  </div>
                  <span className="text-xs font-mono text-stone-500 w-24 shrink-0 text-right">
                    {b.count ? `${pct(b.accuracy)} acc` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {source === 'demo' && (
            <p className="text-xs text-stone-400 text-center">
              Showing built-in demo data — switch to “Database” once you have confirmed pXRF records.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
