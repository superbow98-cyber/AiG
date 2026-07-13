// AiG — BatchUpload.jsx  (NEW · additive)
// Batch database upload — drop up to 10 GPR files at once. The app auto-detects
// each file type, parses it, assigns ONE dataset ID for the batch, links it to
// the signed-in user, and stores a scan record per file. No manual input needed.
//
// Route: /batch   ·   Sidebar: Stage 1 · Survey
import { useState, useRef } from 'react';
import { UploadCloud, FileCheck2, FileWarning, Loader2, Database } from 'lucide-react';
import { detectFormat, validateFile } from '../utils/fileHelpers';
import { parseGPRFile } from '../utils/gprParser';
import { supabase } from '../lib/supabase';
import { getAuthUser, isRealUser, createDataset } from '../lib/db';

const MAX_FILES = 10;

const STATUS_STYLE = {
  queued:  'text-stone-400',
  parsing: 'text-[#C9971A]',
  saving:  'text-[#C9971A]',
  saved:   'text-emerald-700',
  error:   'text-red-600',
};

export default function BatchUpload() {
  const inputRef = useRef(null);
  const [items, setItems] = useState([]);   // { file, format, status, rows, error }
  const [running, setRunning] = useState(false);
  const [datasetId, setDatasetId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  function onPick(e) {
    setError(null);
    setSummary(null);
    const picked = Array.from(e.target.files ?? []);
    // separate .rad companions (used to pair with Mala rd3/dt2, not stored alone)
    const rads = picked.filter((f) => f.name.toLowerCase().endsWith('.rad'));
    const data = picked.filter((f) => !f.name.toLowerCase().endsWith('.rad'));
    if (data.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files per batch — you selected ${data.length}.`);
      return;
    }
    const radMap = {};
    for (const r of rads) radMap[r.name.replace(/\.rad$/i, '').toLowerCase()] = r;
    setItems(
      data.map((file) => ({
        file,
        rad: radMap[file.name.replace(/\.[^.]+$/, '').toLowerCase()] ?? null,
        format: detectFormat(file.name) ?? 'unknown',
        status: 'queued',
        rows: 0,
        error: null,
      }))
    );
  }

  async function runBatch() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const user = await getAuthUser();
      if (!isRealUser(user)) {
        throw new Error('Guest/demo mode is local only — sign in with Google to store a batch.');
      }

      const { data: ds, error: dsErr, dataset_id } = await createDataset({
        title: `Batch ${new Date().toLocaleString()}`,
        visibility: 'private',
      });
      if (dsErr) throw dsErr;
      setDatasetId(dataset_id);

      let ok = 0, fail = 0;
      const next = [...items];
      for (let i = 0; i < next.length; i++) {
        const it = next[i];
        try {
          // validate + parse (auto-detect)
          it.status = 'parsing'; setItems([...next]);
          const v = validateFile(it.file);
          if (v && v.valid === false) throw new Error(v.error || 'Invalid file');
          if ((it.format === 'rd3' || it.format === 'dt2') && !it.rad) {
            throw new Error('Mala file needs a companion .rad — add it to the batch.');
          }
          const parsed = await parseGPRFile(it.file, { radFile: it.rad });

          // store scan record (auto-linked to user + dataset)
          it.status = 'saving'; setItems([...next]);
          const { error: insErr } = await supabase.from('gpr_scans').insert({
            user_id:   user.id,
            dataset_id,
            filename:  parsed.filename ?? it.file.name,
            format:    parsed.metadata?.format ?? it.format,
            traces:    parsed.metadata?.traces ?? null,
            samples:   parsed.metadata?.samples ?? null,
            dt_ns:     parsed.metadata?.dt_ns ?? null,
            dx_m:      parsed.metadata?.dx_m ?? 0.02,
          });
          if (insErr) throw insErr;

          it.status = 'saved';
          it.rows = parsed.metadata?.traces ?? 0;
          ok++;
        } catch (e) {
          it.status = 'error';
          it.error = e.message ?? 'Failed';
          fail++;
        }
        setItems([...next]);
      }
      setSummary({ datasetId: dataset_id, user: user.email, ok, fail, total: next.length });
    } catch (e) {
      setError(e.message ?? 'Batch failed');
    } finally {
      setRunning(false);
    }
  }

  const canRun = items.length > 0 && !running;

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      <div className="mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9971A] bg-[#F7F3D0] border border-[#E8DFA0] px-2 py-0.5 rounded-full">
          Stage 1 · Survey
        </span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
          <Database className="w-6 h-6 text-[#C9971A]" /> Batch Database Upload
        </h1>
        <p className="text-stone-500 text-sm mt-1 max-w-2xl">
          Add up to {MAX_FILES} GPR files at once (.DZT, .dt2/.rd3 + .rad, .sgy, .csv). AiG
          auto-detects each type, assigns one Dataset ID, links it to your account, and stores them.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        className="rounded-2xl p-8 mb-5 border-2 border-dashed text-center cursor-pointer transition-colors"
        style={{ borderColor: '#E8DFA0', background: '#F7F3D0' }}
      >
        <UploadCloud className="w-8 h-8 mx-auto text-[#C9971A] mb-2" />
        <p className="text-sm font-medium text-stone-700">Click to choose files (max {MAX_FILES})</p>
        <p className="text-xs text-stone-400 mt-1">Add matching .rad files for Mala .rd3/.dt2 scans</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".dzt,.dt2,.rd3,.rad,.sgy,.segy,.csv"
          className="hidden"
          onChange={onPick}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl p-3 border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* File table */}
      {items.length > 0 && (
        <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden mb-5">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF0] text-stone-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">File</th>
                <th className="px-5 py-2.5 text-left font-medium">Type</th>
                <th className="px-5 py-2.5 text-left font-medium">Status</th>
                <th className="px-5 py-2.5 text-left font-medium">Traces</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E9B8]">
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5 text-stone-700 truncate max-w-xs">{it.file.name}</td>
                  <td className="px-5 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase bg-[#F7F3D0] text-stone-600">
                      {it.format}
                    </span>
                  </td>
                  <td className={`px-5 py-2.5 font-medium ${STATUS_STYLE[it.status]}`}>
                    <span className="inline-flex items-center gap-1.5">
                      {it.status === 'parsing' || it.status === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {it.status === 'saved' ? <FileCheck2 className="w-3.5 h-3.5" /> : null}
                      {it.status === 'error' ? <FileWarning className="w-3.5 h-3.5" /> : null}
                      {it.status}{it.error ? ` — ${it.error}` : ''}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 font-mono text-stone-500">{it.rows || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Run */}
      {items.length > 0 && (
        <button
          onClick={runBatch}
          disabled={!canRun}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
          style={{ background: '#C9971A' }}
        >
          {running ? 'Uploading…' : `Upload ${items.length} file${items.length !== 1 ? 's' : ''} to Database`}
        </button>
      )}

      {/* Summary receipt */}
      {summary && (
        <div className="mt-5 bg-white border border-[#C9971A] rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-stone-800 mb-3">Batch stored</h3>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div><dt className="text-xs text-stone-400">Dataset ID</dt><dd className="font-mono font-semibold text-stone-800 break-all">{summary.datasetId}</dd></div>
            <div><dt className="text-xs text-stone-400">User</dt><dd className="text-stone-700 truncate">{summary.user}</dd></div>
            <div><dt className="text-xs text-stone-400">Stored</dt><dd className="font-semibold text-emerald-700">{summary.ok}/{summary.total}</dd></div>
            <div><dt className="text-xs text-stone-400">Failed</dt><dd className={summary.fail ? 'font-semibold text-red-600' : 'text-stone-500'}>{summary.fail}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}
