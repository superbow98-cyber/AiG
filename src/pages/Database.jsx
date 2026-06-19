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

// ── Constants ─────────────────────────────────────────────────────────────────

const MATERIALS = ['ceramic', 'metal', 'bone', 'stone', 'void', 'other'];
const PAGE_SIZE = 20;

const EMPTY_FORM = {
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
  const [expandedId,  setExpandedId] = useState(null);
  const [deleteId,    setDeleteId]   = useState(null);

  // Add form
  const [form,        setForm]       = useState(EMPTY_FORM);
  const [submitting,  setSubmitting] = useState(false);
  const [submitMsg,   setSubmitMsg]  = useState('');
  const [submitError, setSubmitError]= useState('');

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

      const { data, error, count } = await query;
      if (error) throw error;
      setRecords(data ?? []);
      setTotal(count ?? 0);
    } catch (e) {
      setError(e.message ?? 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, [page, searchMat, searchSite]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [searchMat, searchSite]);

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
      if (!form.depth_m)      throw new Error('Depth is required');

      // Pull gpr_signature from passed detection if available
      const gpr_signature = passedState?.detections?.[0]?.features
        ? Array.from(passedState.detections[0].features)
        : null;

      const row = {
        site_id:         form.site_id        || null,
        scan_filename:   form.scan_filename  || passedState?.filename || null,
        depth_m:         parseFloat(form.depth_m)        || null,
        size_width_cm:   parseFloat(form.size_width_cm)  || null,
        size_height_cm:  parseFloat(form.size_height_cm) || null,
        xrf_material:    form.xrf_material,
        xrf_elements:    parseXRFElements(form.xrf_elements),
        gps_lat:         parseFloat(form.gps_lat)  || null,
        gps_lng:         parseFloat(form.gps_lng)  || null,
        excavation_date: form.excavation_date || null,
        notes:           form.notes          || null,
        gpr_signature,
      };

      const { error } = await supabase.from('gpr_xrf_records').insert(row);
      if (error) throw error;

      setSubmitMsg('Record saved successfully ✓');
      setForm(EMPTY_FORM);
      fetchRecords();
      setTimeout(() => { setTab('browse'); setSubmitMsg(''); }, 1500);
    } catch (e) {
      setSubmitError(e.message ?? 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ── Render ─────────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">GPR+XRF Reference Database</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {total} record{total !== 1 ? 's' : ''} · confirmed excavation data
          </p>
        </div>
        <div className="flex gap-2">
          {['browse', 'add'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors capitalize
                ${tab === t
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'}`}
            >
              {t === 'browse' ? 'Browse Records' : '+ Add Record'}
            </button>
          ))}
        </div>
      </div>

      {/* ── BROWSE TAB ── */}
      {tab === 'browse' && (
        <div className="space-y-4">

          {/* Search + filter */}
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Filter by material…"
              value={searchMat}
              onChange={(e) => setSearchMat(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm
                         rounded-lg px-3 py-2 placeholder-gray-500 focus:outline-none
                         focus:border-emerald-500"
            />
            <input
              type="text"
              placeholder="Filter by site ID…"
              value={searchSite}
              onChange={(e) => setSearchSite(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm
                         rounded-lg px-3 py-2 placeholder-gray-500 focus:outline-none
                         focus:border-emerald-500"
            />
            <button
              onClick={fetchRecords}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200
                         text-sm font-semibold rounded-lg transition-colors"
            >
              Refresh
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3
                            text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-8 text-gray-500 text-sm">Loading…</div>
          )}

          {/* Table */}
          {!loading && records.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
                  <tr>
                    {['Site', 'Material', 'Depth', 'Size', 'Date', 'Notes', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {records.map((rec) => (
                    <>
                      <tr
                        key={rec.id}
                        className="hover:bg-gray-700/40 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                      >
                        <td className="px-4 py-2 text-gray-300 font-mono text-xs">
                          {rec.site_id ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-white capitalize font-medium">
                            {rec.xrf_material ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-300 font-mono">
                          {rec.depth_m != null ? `${rec.depth_m.toFixed(2)}m` : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-400 font-mono text-xs">
                          {rec.size_width_cm && rec.size_height_cm
                            ? `${rec.size_width_cm}×${rec.size_height_cm}cm`
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-400 text-xs">
                          {rec.excavation_date ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">
                          {rec.notes ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(rec.id); }}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {expandedId === rec.id && (
                        <tr key={`${rec.id}-exp`}>
                          <td colSpan={7} className="px-6 py-4 bg-gray-900">
                            <div className="grid grid-cols-2 gap-6 text-xs">
                              <div className="space-y-2">
                                <p className="text-gray-400 font-semibold mb-1">Details</p>
                                {[
                                  ['Scan file',  rec.scan_filename],
                                  ['GPS',        rec.gps_lat && rec.gps_lng ? `${rec.gps_lat}, ${rec.gps_lng}` : null],
                                  ['Position',   rec.position_m != null ? `${rec.position_m.toFixed(2)}m` : null],
                                  ['Depth ns',   rec.depth_ns != null ? `${rec.depth_ns.toFixed(1)}ns` : null],
                                  ['GPR sig',    rec.gpr_signature?.length ? `${rec.gpr_signature.length}-dim vector` : null],
                                ].map(([label, val]) => val ? (
                                  <div key={label} className="flex gap-2">
                                    <span className="text-gray-500 w-24 flex-shrink-0">{label}</span>
                                    <span className="text-gray-300 font-mono">{val}</span>
                                  </div>
                                ) : null)}
                              </div>
                              {rec.xrf_elements && (
                                <div>
                                  <p className="text-gray-400 font-semibold mb-1">XRF Elements</p>
                                  <div className="flex flex-wrap gap-2">
                                    {Object.entries(rec.xrf_elements)
                                      .sort((a, b) => b[1] - a[1])
                                      .map(([el, pct]) => (
                                        <span
                                          key={el}
                                          className="bg-gray-700 text-gray-200 px-2 py-1 rounded font-mono"
                                        >
                                          {el}: {typeof pct === 'number' ? pct.toFixed(1) : pct}%
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              )}
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
            <div className="text-center py-12 text-gray-500 text-sm">
              No records found. Add confirmed excavation data via the "Add Record" tab.
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>Page {page + 1} of {totalPages} · {total} records</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40
                             rounded-lg transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40
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
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-80 space-y-4">
                <p className="text-white font-semibold">Delete this record?</p>
                <p className="text-gray-400 text-sm">This cannot be undone.</p>
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
                    className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200
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
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-5">
          <p className="text-sm text-gray-400">
            Add a confirmed excavation record. This data trains future k-NN classification.
          </p>

          <div className="grid grid-cols-2 gap-4">

            {/* Material — required */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Material <span className="text-red-400">*</span>
              </label>
              <select
                value={form.xrf_material}
                onChange={(e) => setField('xrf_material', e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm
                           rounded-lg px-3 py-2"
              >
                <option value="">Select material…</option>
                {MATERIALS.map((m) => (
                  <option key={m} value={m} className="capitalize">{m}</option>
                ))}
              </select>
            </div>

            {/* Depth — required */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Depth (m) <span className="text-red-400">*</span>
              </label>
              <input
                type="number" step="0.01" placeholder="e.g. 0.85"
                value={form.depth_m}
                onChange={(e) => setField('depth_m', e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm
                           rounded-lg px-3 py-2 placeholder-gray-500"
              />
            </div>

            {[
              { key: 'site_id',        label: 'Site ID',          placeholder: 'e.g. PENANG-2024-A' },
              { key: 'scan_filename',  label: 'Scan Filename',    placeholder: 'e.g. survey_01.DZT' },
              { key: 'size_width_cm',  label: 'Width (cm)',       placeholder: 'e.g. 12.5',  type: 'number' },
              { key: 'size_height_cm', label: 'Height (cm)',      placeholder: 'e.g. 8.0',   type: 'number' },
              { key: 'gps_lat',        label: 'GPS Latitude',     placeholder: 'e.g. 5.4164',type: 'number' },
              { key: 'gps_lng',        label: 'GPS Longitude',    placeholder: 'e.g. 100.33',type: 'number' },
              { key: 'excavation_date',label: 'Excavation Date',  placeholder: '',           type: 'date'   },
            ].map(({ key, label, placeholder, type = 'text' }) => (
              <div key={key}>
                <label className="text-xs text-gray-400 block mb-1">{label}</label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm
                             rounded-lg px-3 py-2 placeholder-gray-500"
                />
              </div>
            ))}
          </div>

          {/* XRF elements */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              XRF Elements
              <span className="ml-2 text-gray-600">Fe:12.3, Ca:8.1, Si:4.2 — or JSON</span>
            </label>
            <input
              type="text"
              placeholder='Fe:12.3, Ca:8.1, Si:4.2'
              value={form.xrf_elements}
              onChange={(e) => setField('xrf_elements', e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm
                         rounded-lg px-3 py-2 placeholder-gray-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Notes</label>
            <textarea
              rows={3}
              placeholder="Context, soil type, excavation conditions…"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm
                         rounded-lg px-3 py-2 placeholder-gray-500 resize-none"
            />
          </div>

          {/* Submit feedback */}
          {submitMsg   && <p className="text-emerald-400 text-sm">{submitMsg}</p>}
          {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-600
                       text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Saving…' : 'Save Record'}
          </button>
        </div>
      )}
    </div>
  );
}
