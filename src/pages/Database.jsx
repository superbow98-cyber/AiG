// AiG — Database.jsx
// GPR+XRF reference database — browse + search + add records.
//
// Two tabs:
//   "Browse"  — paginated table of gpr_xrf_records with search/filter
//   "Add"     — manual entry form to add a confirmed excavation record
//
// Consumed by: App.jsx (route /database)

import { useState, useEffect, useCallback } from 'react';
import { useLocation }  from 'react-router-dom';
import { supabase }     from '../lib/supabase';
import StatusBar        from '../components/StatusBar';
import { parseRecordsCsv, buildTemplateCsv } from '../utils/recordsCsv';

// ── Constants ─────────────────────────────────────────────────────────────────

const MATERIALS = ['ceramic', 'metal', 'bone', 'stone', 'void', 'other'];
const PAGE_SIZE = 20;
const RECORD_TYPES = ['gpr_xrf', 'xrf_only', 'gpr_only'];
const MIN_VERIFIED_RECOMMENDED = 15; // per-material threshold used in KNN sufficiency check

const EMPTY_FORM = {
  record_type:    'gpr_xrf',
  site_id:        '',
  scan_filename:  '',
  depth_m:        '',
  size_width_cm:  '',
  size_height_cm: '',
  xrf_material:   '',
  xrf_elements:   '',   // free JSON / key:value text — parsed on submit
  gps_lat:        '',
  gps_lng:        '',
  excavation_date:'',
  notes:          '',
  is_synthetic:   false,
};

// ── XRF elements parser ───────────────────────────────────────────────────────
// Accepts "Fe:12.3, Ca:8.1" or raw JSON object string
function parseXRFElements(raw) {
  if (!raw?.trim()) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const obj = {};
  raw.split(',').forEach((pair) => {
    const [k, v] = pair.split(':').map((s) => s.trim());
    if (k && v !== undefined) obj[k] = parseFloat(v) || v;
  });
  return Object.keys(obj).length ? obj : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Database() {
  const location = useLocation();
  const passedState = location.state; // may have { detections, filename } from Results

  const [tab,         setTab]        = useState('browse');
  const [records,     setRecords]    = useState([]);
  const [total,       setTotal]      = useState(0);
  const [page,        setPage]       = useState(0);
  const [loading,     setLoading]    = useState(false);
  const [error,       setError]      = useState(null);
  const [searchMat,   setSearchMat]  = useState('');
  const [searchSite,  setSearchSite] = useState('');
  const [filterType,  setFilterType] = useState(''); // '' = all record types
  const [filterSynthetic, setFilterSynthetic] = useState(''); // '' | 'false' | 'true'
  const [expandedId,  setExpandedId] = useState(null);
  const [deleteId,    setDeleteId]   = useState(null);
  const [counts,      setCounts]     = useState([]); // from gpr_xrf_material_counts view

  // Add form
  const [form,        setForm]       = useState(EMPTY_FORM);
  const [submitting,  setSubmitting] = useState(false);
  const [submitMsg,   setSubmitMsg]  = useState('');
  const [submitError, setSubmitError]= useState('');

  // §30 — Import CSV tab
  const [csvFileName, setCsvFileName] = useState('');
  const [csvParsed,   setCsvParsed]   = useState(null);  // parseRecordsCsv() result
  const [csvImporting,setCsvImporting]= useState(false);
  const [csvResult,   setCsvResult]   = useState(null);  // { inserted, failed, dbError }

  // ── Fetch records ──────────────────────────────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('gpr_xrf_records')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (searchMat)  query = query.ilike('xrf_material', `%${searchMat}%`);
      if (searchSite) query = query.ilike('site_id',      `%${searchSite}%`);
      if (filterType) query = query.eq('record_type', filterType);
      if (filterSynthetic !== '') query = query.eq('is_synthetic', filterSynthetic === 'true');

      const { data, error, count } = await query;
      if (error) throw error;
      setRecords(data ?? []);
      setTotal(count ?? 0);
    } catch (e) {
      setError(e.message ?? 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, [page, searchMat, searchSite, filterType, filterSynthetic]);

  // Per-material record counts (for KNN data-sufficiency indicator)
  const fetchCounts = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('gpr_xrf_material_counts').select('*');
      if (error) throw error;
      setCounts(data ?? []);
    } catch (_e) {
      // non-fatal — counts bar just won't render
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [searchMat, searchSite, filterType, filterSynthetic]);

  // ── Delete record ──────────────────────────────────────────────────────────
  async function handleDelete(id) {
    try {
      const { error } = await supabase.from('gpr_xrf_records').delete().eq('id', id);
      if (error) throw error;
      setDeleteId(null);
      fetchRecords();
    } catch (e) {
      setError(e.message);
    }
  }

  // ── Submit new record ──────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    setSubmitMsg('');
    setSubmitError('');

    try {
      if (!form.xrf_material) throw new Error('Material is required');
      if (form.record_type !== 'xrf_only' && !form.depth_m)
        throw new Error('Depth is required for GPR-paired records');

      // Pull gpr_signature from passed detection if available — never set for XRF-only entries
      const gpr_signature = form.record_type === 'xrf_only'
        ? null
        : (passedState?.detections?.[0]?.features
            ? Array.from(passedState.detections[0].features)
            : null);

      const row = {
        record_type:     form.record_type,
        site_id:         form.site_id        || null,
        scan_filename:   form.record_type === 'xrf_only' ? null : (form.scan_filename || passedState?.filename || null),
        depth_m:         form.depth_m ? (parseFloat(form.depth_m) || null) : null,
        size_width_cm:   parseFloat(form.size_width_cm)  || null,
        size_height_cm:  parseFloat(form.size_height_cm) || null,
        xrf_material:    form.xrf_material,
        xrf_elements:    parseXRFElements(form.xrf_elements),
        gps_lat:         parseFloat(form.gps_lat)  || null,
        gps_lng:         parseFloat(form.gps_lng)  || null,
        excavation_date: form.excavation_date || null,
        notes:           form.notes          || null,
        gpr_signature,
        is_synthetic:    form.is_synthetic,
      };

      const { error } = await supabase.from('gpr_xrf_records').insert(row);
      if (error) throw error;

      setSubmitMsg('Record saved successfully ✓');
      setForm(EMPTY_FORM);
      fetchRecords();
      fetchCounts();
      setTimeout(() => { setTab('browse'); setSubmitMsg(''); }, 1500);
    } catch (e) {
      setSubmitError(e.message ?? 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ── §30 — Import CSV ──────────────────────────────────────────────────────
  function handleCsvFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvResult(null);
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvParsed(parseRecordsCsv(ev.target.result));
    reader.onerror = () => setCsvParsed({ rows: [], validCount: 0, invalidCount: 0, parseError: 'Could not read file.' });
    reader.readAsText(file);
  }

  function handleDownloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aig_records_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCsvImport() {
    if (!csvParsed?.validCount) return;
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const validRows = csvParsed.rows.filter((r) => r.row).map((r) => r.row);
      const { error, data } = await supabase.from('gpr_xrf_records').insert(validRows).select('id');
      if (error) throw error;
      setCsvResult({ inserted: data?.length ?? validRows.length, failed: csvParsed.invalidCount, dbError: null });
      setCsvParsed(null);
      setCsvFileName('');
      fetchRecords();
      fetchCounts();
    } catch (e) {
      setCsvResult({ inserted: 0, failed: csvParsed.invalidCount, dbError: e.message ?? 'Import failed' });
    } finally {
      setCsvImporting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-800">GPR+XRF Reference Database</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {total} record{total !== 1 ? 's' : ''} · confirmed excavation data
          </p>
        </div>
        <div className="flex gap-2">
          {['browse', 'add', 'import'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors capitalize
                ${tab === t
                  ? 'bg-[#C9971A] text-white'
                  : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'}`}
            >
              {t === 'browse' ? 'Browse Records' : t === 'add' ? '+ Add Record' : '⇪ Import CSV'}
            </button>
          ))}
        </div>
      </div>

      {/* ── BROWSE TAB ── */}
      {tab === 'browse' && (
        <div className="space-y-4">

          {/* Per-material KNN data-sufficiency bar */}
          {counts.length > 0 && (
            <div className="bg-white border border-[#F0E9B8] rounded-xl px-4 py-3">
              <p className="text-xs text-stone-500 font-semibold mb-2">
                Records per material · KNN reliability (target ≥{MIN_VERIFIED_RECOMMENDED})
              </p>
              <div className="flex flex-wrap gap-2">
                {counts.map((c) => {
                  const sufficient = (c.total_records ?? 0) >= MIN_VERIFIED_RECOMMENDED;
                  return (
                    <span
                      key={`${c.xrf_material}-${c.record_type}`}
                      className={`text-xs font-mono px-2 py-1 rounded capitalize
                        ${sufficient ? 'bg-[#F7F3D0] text-stone-700' : 'bg-red-50 text-red-700'}`}
                      title={c.record_type}
                    >
                      {c.xrf_material ?? 'unlabelled'}: {c.total_records}
                      {!sufficient && ' ⚠'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search + filter */}
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Filter by material…"
              value={searchMat}
              onChange={(e) => setSearchMat(e.target.value)}
              className="flex-1 bg-white border border-[#F0E9B8] text-stone-700 text-sm
                         rounded-lg px-3 py-2 placeholder-stone-400 focus:outline-none
                         focus:border-[#C9971A]"
            />
            <input
              type="text"
              placeholder="Filter by site ID…"
              value={searchSite}
              onChange={(e) => setSearchSite(e.target.value)}
              className="flex-1 bg-white border border-[#F0E9B8] text-stone-700 text-sm
                         rounded-lg px-3 py-2 placeholder-stone-400 focus:outline-none
                         focus:border-[#C9971A]"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-white border border-[#F0E9B8] text-stone-700 text-sm
                         rounded-lg px-3 py-2 focus:outline-none focus:border-[#C9971A]"
            >
              <option value="">All types</option>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={filterSynthetic}
              onChange={(e) => setFilterSynthetic(e.target.value)}
              className="bg-white border border-[#F0E9B8] text-stone-700 text-sm
                         rounded-lg px-3 py-2 focus:outline-none focus:border-[#C9971A]"
              title="§24 — filter by whether a record is real field data or deliberately-tagged synthetic/demo data"
            >
              <option value="">Original + synthetic</option>
              <option value="false">Original only</option>
              <option value="true">Synthetic only</option>
            </select>
            <button
              onClick={() => { fetchRecords(); fetchCounts(); }}
              className="px-4 py-2 bg-[#F7F3D0] hover:bg-[#F0E9B8] text-stone-700
                         text-sm font-semibold rounded-lg transition-colors"
            >
              Refresh
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3
                            text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-8 text-stone-400 text-sm">Loading…</div>
          )}

          {/* Table */}
          {!loading && records.length > 0 && (
            <div className="bg-white border border-[#F0E9B8] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFBF0] text-stone-500 text-xs uppercase tracking-wide">
                  <tr>
                    {['Site', 'Material', 'Type', 'Saved', 'Depth', 'Size', 'Notes', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0E9B8]">
                  {records.map((rec) => (
                    <>
                      <tr
                        key={rec.id}
                        className="hover:bg-[#FDFBF0] transition-colors cursor-pointer"
                        onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                      >
                        <td className="px-4 py-2 text-stone-600 font-mono text-xs">
                          {rec.site_id ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-stone-800 capitalize font-medium">
                            {rec.xrf_material ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full
                            ${rec.is_synthetic
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'}`}>
                            {rec.is_synthetic ? 'Synthetic' : 'Original'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-stone-500 text-xs whitespace-nowrap">
                          {rec.created_at ? new Date(rec.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2 text-stone-600 font-mono">
                          {rec.depth_m != null ? `${rec.depth_m.toFixed(2)}m` : '—'}
                        </td>
                        <td className="px-4 py-2 text-stone-500 font-mono text-xs">
                          {rec.size_width_cm && rec.size_height_cm
                            ? `${rec.size_width_cm}×${rec.size_height_cm}cm`
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-stone-400 text-xs max-w-xs truncate">
                          {rec.notes ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(rec.id); }}
                            className="text-xs text-red-600 hover:text-red-700 transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {expandedId === rec.id && (
                        <tr key={`${rec.id}-exp`}>
                          <td colSpan={8} className="px-6 py-4 bg-[#FDFBF0]">
                            <div className="grid grid-cols-2 gap-6 text-xs">
                              <div className="space-y-2">
                                <p className="text-stone-500 font-semibold mb-1">Details</p>
                                {[
                                  ['Scan file',  rec.scan_filename],
                                  ['GPS',        rec.gps_lat && rec.gps_lng ? `${rec.gps_lat}, ${rec.gps_lng}` : null],
                                  ['Position',   rec.position_m != null ? `${rec.position_m.toFixed(2)}m` : null],
                                  ['Depth ns',   rec.depth_ns != null ? `${rec.depth_ns.toFixed(1)}ns` : null],
                                  ['GPR sig',    rec.gpr_signature?.length ? `${rec.gpr_signature.length}-dim vector` : null],
                                  ['GPR embedding', rec.gpr_features ? '✓ present (128-D)' : null],
                                  ['XRF features',  rec.xrf_features ? '✓ present' : null],
                                  ['Fusion output',  rec.fusion_output && Object.keys(rec.fusion_output).length ? '✓ present' : null],
                                ].map(([label, val]) => val ? (
                                  <div key={label} className="flex gap-2">
                                    <span className="text-stone-400 w-24 flex-shrink-0">{label}</span>
                                    <span className="text-stone-600 font-mono">{val}</span>
                                  </div>
                                ) : null)}
                              </div>
                              <div className="space-y-3">
                                {(rec.ai_prediction || rec.confidence != null) && (
                                  <div>
                                    <p className="text-stone-500 font-semibold mb-1">
                                      AI prediction (§20 — kept separate from ground truth)
                                    </p>
                                    <div className="flex gap-2">
                                      <span className="text-stone-400 w-24 flex-shrink-0">Predicted</span>
                                      <span className="text-stone-600 font-mono capitalize">
                                        {rec.ai_prediction ?? '—'}
                                        {rec.confidence != null ? ` (${(rec.confidence * 100).toFixed(1)}%)` : ''}
                                      </span>
                                    </div>
                                    {rec.ai_prediction && rec.xrf_material && rec.ai_prediction !== rec.xrf_material && (
                                      <p className="text-amber-700 mt-1">
                                        ⚠ AI disagreed with confirmed ground truth ({rec.xrf_material})
                                      </p>
                                    )}
                                  </div>
                                )}
                                {rec.xrf_elements && (
                                  <div>
                                    <p className="text-stone-500 font-semibold mb-1">XRF Elements</p>
                                    <div className="flex flex-wrap gap-2">
                                      {Object.entries(rec.xrf_elements)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([el, pct]) => (
                                          <span
                                            key={el}
                                            className="bg-[#F7F3D0] text-stone-700 px-2 py-1 rounded font-mono"
                                          >
                                            {el}: {typeof pct === 'number' ? pct.toFixed(1) : pct}%
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {!loading && records.length === 0 && (
            <div className="text-center py-12 text-stone-400 text-sm">
              No records found. Add confirmed excavation data via the "Add Record" tab.
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-stone-500">
              <span>Page {page + 1} of {totalPages} · {total} records</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-[#F7F3D0] hover:bg-[#F0E9B8] disabled:opacity-40
                             rounded-lg transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 bg-[#F7F3D0] hover:bg-[#F0E9B8] disabled:opacity-40
                             rounded-lg transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* Delete confirm modal */}
          {deleteId && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
              <div className="bg-white border border-[#F0E9B8] rounded-xl p-6 w-80 space-y-4">
                <p className="text-stone-800 font-semibold">Delete this record?</p>
                <p className="text-stone-500 text-sm">This cannot be undone.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDelete(deleteId)}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white
                               text-sm font-semibold rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeleteId(null)}
                    className="flex-1 py-2 bg-[#F7F3D0] hover:bg-[#F0E9B8] text-stone-700
                               text-sm font-semibold rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ADD TAB ── */}
      {tab === 'add' && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-6 space-y-5">
          <p className="text-sm text-stone-500">
            Add a confirmed record. This data trains future k-NN classification and elemental fusion.
          </p>

          {/* Record type toggle */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">Record Type</label>
            <div className="flex gap-2">
              {RECORD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setField('record_type', t)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors
                    ${form.record_type === t
                      ? 'bg-[#C9971A] text-white'
                      : 'bg-[#F7F3D0] text-stone-500 hover:text-stone-900'}`}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>
            {form.record_type === 'xrf_only' && (
              <p className="text-xs text-stone-400 mt-1">
                No GPR pairing yet — geochemistry-only entry (e.g. surface pXRF soil scan).
                Excluded from KNN hyperbola matching but still contributes to elemental fusion training.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">

            {/* Material — required */}
            <div>
              <label className="text-xs text-stone-500 block mb-1">
                Material <span className="text-red-600">*</span>
              </label>
              <select
                value={form.xrf_material}
                onChange={(e) => setField('xrf_material', e.target.value)}
                className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                           rounded-lg px-3 py-2"
              >
                <option value="">Select material…</option>
                {MATERIALS.map((m) => (
                  <option key={m} value={m} className="capitalize">{m}</option>
                ))}
              </select>
            </div>

            {/* Depth — required unless XRF-only */}
            {form.record_type !== 'xrf_only' && (
              <div>
                <label className="text-xs text-stone-500 block mb-1">
                  Depth (m) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number" step="0.01" placeholder="e.g. 0.85"
                  value={form.depth_m}
                  onChange={(e) => setField('depth_m', e.target.value)}
                  className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                             rounded-lg px-3 py-2 placeholder-stone-400"
                />
              </div>
            )}

            {[
              { key: 'site_id',        label: 'Site ID',          placeholder: 'e.g. PENANG-2024-A' },
              ...(form.record_type !== 'xrf_only'
                ? [{ key: 'scan_filename', label: 'Scan Filename', placeholder: 'e.g. survey_01.DZT' }]
                : []),
              { key: 'size_width_cm',  label: 'Width (cm)',       placeholder: 'e.g. 12.5',  type: 'number' },
              { key: 'size_height_cm', label: 'Height (cm)',      placeholder: 'e.g. 8.0',   type: 'number' },
              { key: 'gps_lat',        label: 'GPS Latitude',     placeholder: 'e.g. 5.4164',type: 'number' },
              { key: 'gps_lng',        label: 'GPS Longitude',    placeholder: 'e.g. 100.33',type: 'number' },
              { key: 'excavation_date',label: 'Excavation Date',  placeholder: '',           type: 'date'   },
            ].map(({ key, label, placeholder, type = 'text' }) => (
              <div key={key}>
                <label className="text-xs text-stone-500 block mb-1">{label}</label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                             rounded-lg px-3 py-2 placeholder-stone-400"
                />
              </div>
            ))}
          </div>

          {/* XRF elements */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">
              XRF Elements
              <span className="ml-2 text-stone-400">Fe:12.3, Ca:8.1, Si:4.2 — or JSON</span>
            </label>
            <input
              type="text"
              placeholder='Fe:12.3, Ca:8.1, Si:4.2'
              value={form.xrf_elements}
              onChange={(e) => setField('xrf_elements', e.target.value)}
              className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                         rounded-lg px-3 py-2 placeholder-stone-400"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">Notes</label>
            <textarea
              rows={3}
              placeholder="Context, soil type, excavation conditions…"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                         rounded-lg px-3 py-2 placeholder-stone-400 resize-none"
            />
          </div>

          {/* §24 — explicit original/synthetic tag, required conscious choice */}
          <label className="flex items-start gap-2 text-xs text-stone-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={form.is_synthetic}
              onChange={(e) => setField('is_synthetic', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              This is <strong>synthetic/demo data</strong>, not a real field reading (e.g. testing
              the pipeline with made-up values). Leave unchecked for real confirmed excavation
              data — synthetic rows are excluded from Stage 2 training queries by default.
            </span>
          </label>

          {/* Submit feedback */}
          {submitMsg   && <p className="text-[#C9971A] text-sm">{submitMsg}</p>}
          {submitError && <p className="text-red-600 text-sm">{submitError}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 bg-[#C9971A] hover:bg-[#a87d12] disabled:bg-stone-200
                       text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Saving…' : 'Save Record'}
          </button>
        </div>
      )}

      {/* ── IMPORT CSV TAB (§30) ── */}
      {tab === 'import' && (
        <div className="bg-white border border-[#F0E9B8] rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-stone-500">
              Bulk-add confirmed records from a CSV file — one row per record. Columns are matched
              case-insensitively (e.g. <code>material</code> or <code>xrf_material</code> both work).
              Required column: <strong>material</strong> (must be one of {MATERIALS.join(', ')}).
              <code>depth_m</code> is required unless <code>record_type</code> is <code>xrf_only</code>.
            </p>
            <button
              onClick={handleDownloadTemplate}
              className="shrink-0 px-3 py-1.5 bg-[#F7F3D0] hover:bg-[#F0E9B8] text-stone-700
                         text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              Download CSV template
            </button>
          </div>

          {/* File picker */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFile}
              className="w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 text-sm
                         rounded-lg px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded-md
                         file:border-0 file:bg-[#C9971A] file:text-white file:text-xs
                         file:font-semibold file:cursor-pointer cursor-pointer"
            />
            {csvFileName && <p className="text-xs text-stone-400 mt-1">Loaded: {csvFileName}</p>}
          </div>

          {/* Parse error (whole file rejected — e.g. no material column) */}
          {csvParsed?.parseError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
              {csvParsed.parseError}
            </div>
          )}

          {/* Preview */}
          {csvParsed && !csvParsed.parseError && (
            <div className="space-y-3">
              <div className="flex gap-4 text-xs font-semibold">
                <span className="text-[#C9971A]">{csvParsed.validCount} row{csvParsed.validCount !== 1 ? 's' : ''} ready to import</span>
                {csvParsed.invalidCount > 0 && (
                  <span className="text-red-600">{csvParsed.invalidCount} row{csvParsed.invalidCount !== 1 ? 's' : ''} will be skipped</span>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto bg-[#FDFBF0] border border-[#F0E9B8] rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0E9B8] text-stone-500 uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Line</th>
                      <th className="px-3 py-2 text-left">Site</th>
                      <th className="px-3 py-2 text-left">Material</th>
                      <th className="px-3 py-2 text-left">Depth</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0E9B8]">
                    {csvParsed.rows.map((r) => (
                      <tr key={r.line}>
                        <td className="px-3 py-1.5 text-stone-400 font-mono">{r.line}</td>
                        <td className="px-3 py-1.5 text-stone-600">{r.row?.site_id ?? '—'}</td>
                        <td className="px-3 py-1.5 text-stone-800 capitalize">{r.row?.xrf_material ?? '—'}</td>
                        <td className="px-3 py-1.5 text-stone-600">{r.row?.depth_m ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          {r.error
                            ? <span className="text-red-600">{r.error}</span>
                            : <span className="text-[#C9971A]">✓ ok</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleCsvImport}
                disabled={csvImporting || csvParsed.validCount === 0}
                className="w-full py-2.5 bg-[#C9971A] hover:bg-[#a87d12] disabled:bg-stone-200
                           text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {csvImporting ? 'Importing…' : `Import ${csvParsed.validCount} record${csvParsed.validCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {/* Result */}
          {csvResult && !csvResult.dbError && (
            <p className="text-[#C9971A] text-sm">
              ✓ Imported {csvResult.inserted} record{csvResult.inserted !== 1 ? 's' : ''}
              {csvResult.failed > 0 ? ` · ${csvResult.failed} skipped (see errors above before importing next time)` : ''}.
            </p>
          )}
          {csvResult?.dbError && (
            <p className="text-red-600 text-sm">Import failed: {csvResult.dbError}</p>
          )}
        </div>
      )}
    </div>
  );
}
