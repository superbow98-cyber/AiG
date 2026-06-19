// AiG — Upload.jsx
// Upload page — FileLoader + Supabase save + navigate to /preprocess.
// useGPRData is instantiated here and passed down; it should eventually live
// in a GPRContext so Preprocess/Visualise/Detect can all share the same scan.
// For now it lives here and is threaded via route state as a short-term bridge
// until GPRContext is wired in (Layer 3 follow-up task noted in BRAIN §7).

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGPRData } from '../hooks/useGPRData';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import FileLoader from '../components/FileLoader';
import StatusBar from '../components/StatusBar';
import { ArrowRight, Database } from 'lucide-react';

export default function Upload() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { scan, setScan, loadDemo, clearScan, getDxM } = useGPRData();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedId, setSavedId] = useState(null);

  // Reset save state when a new file is loaded
  useEffect(() => {
    setSavedId(null);
    setSaveError(null);
  }, [scan.filename]);

  // ── save scan record to Supabase ──────────────────────────────────────────
  const saveScan = async () => {
    if (!scan.matrix || !user) return;
    setSaving(true);
    setSaveError(null);

    const { data, error } = await supabase
      .from('gpr_scans')
      .insert({
        user_id: user.id,
        filename: scan.filename,
        format: scan.format,
        traces: scan.metadata?.traces ?? null,
        samples: scan.metadata?.samples ?? null,
        dt_ns: scan.metadata?.dt_ns ?? null,
        dx_m: getDxM(),
      })
      .select('id')
      .single();

    if (error) {
      setSaveError(error.message);
    } else {
      setSavedId(data.id);
    }
    setSaving(false);
  };

  // ── proceed to preprocess ─────────────────────────────────────────────────
  const proceed = () => {
    // Pass scan via location state as temporary bridge (replace with GPRContext later)
    navigate('/preprocess', {
      state: {
        matrix: scan.matrix,
        metadata: scan.metadata,
        filename: scan.filename,
        format: scan.format,
        velocity: scan.velocity,
        scanId: savedId,
      },
    });
  };

  const loaded = !!scan.filename && !scan.loading;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Upload GPR Scan</h1>
        <p className="mt-1 text-sm text-gray-400">
          Supported formats: GSSI .DZT · Mala .dt2/.rd3 · SEG-Y .sgy · .csv
        </p>
      </div>

      {/* File loader */}
      <div className="rounded-xl border border-gray-700 bg-gray-800 p-6">
        <FileLoader
          scan={scan}
          setScan={setScan}
          loadDemo={loadDemo}
          onScanLoaded={() => { setSavedId(null); setSaveError(null); }}
        />
      </div>

      {/* Parse progress */}
      {scan.loading && (
        <StatusBar step="Parsing GPR file…" progress={50} visible />
      )}

      {/* Scan metadata summary */}
      {loaded && scan.metadata && (
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6 space-y-4">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-widest">
            Scan Info
          </h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ['Filename', scan.filename],
              ['Format', scan.format?.toUpperCase()],
              ['Traces', scan.metadata.traces?.toLocaleString()],
              ['Samples / trace', scan.metadata.samples?.toLocaleString()],
              ['Time step (dt)', scan.metadata.dt_ns != null ? `${scan.metadata.dt_ns} ns` : '—'],
              ['Trace spacing', `${getDxM()} m${scan.metadata.dx_m == null ? ' (default)' : ''}`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-white font-medium">{value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Save + proceed */}
      {loaded && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Save to DB */}
          <div className="flex items-center gap-3">
            {!savedId ? (
              <button
                onClick={saveScan}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
              >
                <Database className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save to database'}
              </button>
            ) : (
              <p className="text-sm text-emerald-400">✓ Saved to database</p>
            )}
            {saveError && (
              <p className="text-sm text-red-400">{saveError}</p>
            )}
          </div>

          {/* Proceed */}
          <button
            onClick={proceed}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
          >
            Proceed to Preprocess
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
