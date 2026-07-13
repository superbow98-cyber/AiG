// AiG — Reclassify.jsx  (NEW · additive)
// Re-run k-NN classification for records already stored in gpr_xrf_records
// whose material is still 'unknown' — using the gpr_signature vector already
// saved with each record (no need to re-upload the original scan file).
//
// Flow:
//   1. Fetch reference records (xrf_material NOT in [null, 'unknown'])
//   2. Fetch target records (xrf_material IS null OR 'unknown', has gpr_signature)
//   3. For each target: knnSearch against references -> predictMaterial
//   4. Update xrf_material, ai_prediction, predicted_material, confidence,
//      predicted_confidence back onto that row
//
// Route: /reclassify   ·   Sidebar: Database / Maintenance
import { useState } from 'react';
import { Wand2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { knnSearch, predictMaterial } from '../models/knn';

export default function Reclassify() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  async function runReclassify() {
    setRunning(true);
    setError(null);
    setSummary(null);
    setProgress(0);

    try {
      setStatusMsg('Loading reference records…');
      const { data: refs, error: refErr } = await supabase
        .from('gpr_xrf_records')
        .select('id, xrf_material as material, gpr_signature, hyperbola_shape, xrf_elements, depth_m, size_width_cm, site_id')
        .not('xrf_material', 'is', null)
        .neq('xrf_material', 'unknown')
        .not('gpr_signature', 'is', null);
      if (refErr) throw refErr;

      if (!refs || refs.length < 3) {
        throw new Error(`Only ${refs?.length ?? 0} reference records with signatures — need at least 3. Add more confirmed records first.`);
      }

      setStatusMsg('Loading unknown records…');
      const { data: targets, error: tgtErr } = await supabase
        .from('gpr_xrf_records')
        .select('id, gpr_signature')
        .or('xrf_material.is.null,xrf_material.eq.unknown')
        .not('gpr_signature', 'is', null);
      if (tgtErr) throw tgtErr;

      if (!targets || targets.length === 0) {
        setSummary({ total: 0, updated: 0, failed: 0 });
        setStatusMsg('No unknown records with a stored signature to reclassify.');
        return;
      }

      let updated = 0, failed = 0;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        setProgress(Math.round(((i + 1) / targets.length) * 100));
        setStatusMsg(`Reclassifying ${i + 1} of ${targets.length}…`);
        await new Promise((r) => setTimeout(r, 0));

        try {
          const matches = knnSearch(t.gpr_signature, refs, 5, 'cosine');
          const pred = predictMaterial(matches, refs);
          if (!pred?.material || pred.material === 'unknown') { failed++; continue; }

          const { error: updErr } = await supabase
            .from('gpr_xrf_records')
            .update({
              xrf_material: pred.material,
              ai_prediction: pred.material,
              predicted_material: pred.material,
              confidence: pred.confidence ?? null,
              predicted_confidence: pred.confidence ?? null,
            })
            .eq('id', t.id);
          if (updErr) throw updErr;
          updated++;
        } catch (_e) {
          failed++;
        }
      }

      setSummary({ total: targets.length, updated, failed });
      setStatusMsg(`Done — ${updated}/${targets.length} reclassified`);
    } catch (e) {
      setError(e.message ?? 'Reclassify failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-[#C9971A]" /> Reclassify Unknown Records
        </h1>
        <p className="text-sm text-stone-500 mt-1">
          Re-runs k-NN classification for stored records still marked "unknown", using
          their saved GPR signature against your current reference database. Useful
          after adding new confirmed records — no re-upload needed.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {running && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-stone-600 mb-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {statusMsg}
          </div>
          <div className="h-2 bg-[#F7F3D0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#C9971A] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {summary && !running && (
        <div className="bg-white border border-[#C9971A] rounded-xl p-5">
          <h3 className="text-sm font-bold text-stone-800 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Reclassify complete
          </h3>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div><dt className="text-xs text-stone-400">Total scanned</dt><dd className="font-semibold text-stone-800">{summary.total}</dd></div>
            <div><dt className="text-xs text-stone-400">Updated</dt><dd className="font-semibold text-emerald-700">{summary.updated}</dd></div>
            <div><dt className="text-xs text-stone-400">Still unknown</dt><dd className={summary.failed ? 'font-semibold text-red-600' : 'text-stone-500'}>{summary.failed}</dd></div>
          </dl>
        </div>
      )}

      <button
        onClick={runReclassify}
        disabled={running}
        className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
        style={{ background: '#C9971A' }}
      >
        {running ? 'Running…' : 'Run Reclassify'}
      </button>
    </div>
  );
}
