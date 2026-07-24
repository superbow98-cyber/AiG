// AiG — recordsCsv.js
// Parses a CSV of gpr_xrf_records rows for bulk import via Database.jsx's
// "Import CSV" tab. Column headers are matched case-insensitively against
// the same field set EMPTY_FORM/handleSubmit already use for a single manual
// "Add Record" entry, so a CSV built from that form's fields (or from the
// downloadable template) round-trips cleanly.
//
// §40: bulk CSV import can now carry a real `gpr_signature` (the 18-value
// feature vector knn.js's extractFeatures() produces — see CANONICAL ORDER
// note on parseGprSignature below). Previously every CSV-imported row got
// gpr_signature hardcoded to null, which meant knnSearch()'s
// `Array.isArray(row.gpr_signature) && row.gpr_signature.length > 0` filter
// silently excluded EVERY bulk-imported row from actually being matched —
// they only ever padded classSampleCount (the low-sample badge's count),
// never contributed a real neighbour. A CSV without this column still
// imports fine (gpr_signature stays null, same as before — fully backward
// compatible); rows that do have it are now real, matchable reference data.
//
// Consumed by: pages/Database.jsx

import Papa from 'papaparse';

export const MATERIALS = ['ceramic', 'metal', 'bone', 'stone', 'void', 'other'];
export const RECORD_TYPES = ['gpr_xrf', 'xrf_only', 'gpr_only'];

// Canonical column -> accepted header aliases (case-insensitive match).
const COLUMN_ALIASES = {
  record_type:     ['record_type', 'type'],
  site_id:         ['site_id', 'site'],
  scan_filename:   ['scan_filename', 'filename', 'scan'],
  depth_m:         ['depth_m', 'depth'],
  size_width_cm:   ['size_width_cm', 'width_cm', 'width'],
  size_height_cm:  ['size_height_cm', 'height_cm', 'height'],
  xrf_material:    ['xrf_material', 'material'],
  xrf_elements:    ['xrf_elements', 'elements'],
  gpr_signature:   ['gpr_signature', 'signature', 'feature_vector'],
  gps_lat:         ['gps_lat', 'lat', 'latitude'],
  gps_lng:         ['gps_lng', 'lng', 'lon', 'longitude'],
  excavation_date: ['excavation_date', 'date'],
  notes:           ['notes', 'note'],
  is_synthetic:    ['is_synthetic', 'synthetic'],
};

const TEMPLATE_HEADERS = Object.keys(COLUMN_ALIASES);

// Same "Fe:12.3, Ca:8.1" / raw-JSON parser used by Database.jsx's single-record form —
// duplicated here (not imported) so this file has no dependency on the page module.
function parseXRFElements(raw) {
  if (!raw || !String(raw).trim()) return null;
  const str = String(raw).trim();
  try { return JSON.parse(str); } catch (_) {}
  const obj = {};
  str.split(',').forEach((pair) => {
    const [k, v] = pair.split(':').map((s) => s?.trim());
    if (k && v !== undefined) obj[k] = parseFloat(v) || v;
  });
  return Object.keys(obj).length ? obj : null;
}

function parseBool(raw) {
  if (raw === undefined || raw === null || raw === '') return false;
  const s = String(raw).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function numOrNull(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// Accepts either a JSON array ("[182.4,24.1,...]") or a semicolon/pipe
// separated list ("182.4;24.1;..." — easier to type by hand than JSON, and
// avoids clashing with the outer CSV comma delimiter without needing to
// quote the cell). Returns null if empty/unparseable rather than throwing —
// a bad signature should not fail the whole row, it should just fall back
// to "not matchable by knnSearch," same as any other row missing it.
// CANONICAL ORDER (must match knn.js's extractFeatures() — 18 values):
//   [peak, mean, rms, std, skew, kurt, apexNormRow, apexNormCol, energy,
//    zcr, curvature, leftSlope, rightSlope, widthHM, asymmetry,
//    domFreqEst, decayRate, scr]
function parseGprSignature(raw) {
  if (!raw || !String(raw).trim()) return null;
  const str = String(raw).trim();
  try {
    const arr = JSON.parse(str);
    if (Array.isArray(arr) && arr.length && arr.every((v) => Number.isFinite(Number(v)))) {
      return arr.map(Number);
    }
  } catch (_) {}
  const parts = str
    .split(/[;|]/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !Number.isNaN(n));
  return parts.length ? parts : null;
}

/**
 * @param {string} csvText
 * @returns {{
 *   rows: Array<{ line: number, row: object|null, error: string|null }>,
 *   validCount: number,
 *   invalidCount: number,
 *   parseError: string|null
 * }}
 */
export function parseRecordsCsv(csvText) {
  const parsed = Papa.parse(String(csvText).trim(), { header: true, skipEmptyLines: true });

  if (parsed.errors?.length) {
    const first = parsed.errors[0];
    return { rows: [], validCount: 0, invalidCount: 0, parseError: `Could not parse CSV: ${first.message} (row ${first.row ?? '?'})` };
  }
  if (!parsed.data.length) {
    return { rows: [], validCount: 0, invalidCount: 0, parseError: 'CSV has no data rows.' };
  }

  const headers = parsed.meta.fields ?? [];
  const lowerToOriginal = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));

  // Resolve each canonical field to whichever alias header is actually present.
  const colFor = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = aliases.map((a) => lowerToOriginal.get(a)).find(Boolean);
    if (match) colFor[field] = match;
  }

  if (!colFor.xrf_material) {
    return {
      rows: [], validCount: 0, invalidCount: 0,
      parseError: `No "material" column found. Expected one of: ${COLUMN_ALIASES.xrf_material.join(', ')}. Found columns: ${headers.join(', ') || '(none)'}.`,
    };
  }

  let validCount = 0, invalidCount = 0;

  const rows = parsed.data.map((raw, i) => {
    const line = i + 2; // +1 header row, +1 for 1-indexing
    const get = (field) => (colFor[field] ? raw[colFor[field]] : undefined);

    const materialRaw = (get('xrf_material') || '').toString().trim().toLowerCase();
    const recordTypeRaw = (get('record_type') || 'gpr_xrf').toString().trim().toLowerCase();

    if (!materialRaw) {
      invalidCount++;
      return { line, row: null, error: 'Missing material' };
    }
    if (!MATERIALS.includes(materialRaw)) {
      invalidCount++;
      return { line, row: null, error: `Unrecognised material "${materialRaw}" — expected one of: ${MATERIALS.join(', ')}` };
    }
    const record_type = RECORD_TYPES.includes(recordTypeRaw) ? recordTypeRaw : 'gpr_xrf';

    const depth_m = numOrNull(get('depth_m'));
    if (record_type !== 'xrf_only' && depth_m === null) {
      invalidCount++;
      return { line, row: null, error: 'Missing depth_m (required unless record_type is xrf_only)' };
    }

    const row = {
      record_type,
      site_id:         get('site_id') || null,
      scan_filename:   record_type === 'xrf_only' ? null : (get('scan_filename') || null),
      depth_m,
      size_width_cm:   numOrNull(get('size_width_cm')),
      size_height_cm:  numOrNull(get('size_height_cm')),
      xrf_material:    materialRaw,
      xrf_elements:    parseXRFElements(get('xrf_elements')),
      gps_lat:         numOrNull(get('gps_lat')),
      gps_lng:         numOrNull(get('gps_lng')),
      excavation_date: get('excavation_date') || null,
      notes:           get('notes') || null,
      // §40 — real feature vector when the CSV supplies one; null (same as
      // before) when it doesn't, so old CSVs without this column still work.
      gpr_signature:   parseGprSignature(get('gpr_signature')),
      is_synthetic:    parseBool(get('is_synthetic')),
    };

    validCount++;
    return { line, row, error: null };
  });

  return { rows, validCount, invalidCount, parseError: null };
}

/** Builds a starter CSV (headers + 3 example rows) for the "Download template" button. */
export function buildTemplateCsv() {
  const example = [
    { record_type: 'gpr_xrf', site_id: 'SB2A', scan_filename: 'SB2A_metal_001.dzt', depth_m: 1.1, size_width_cm: 18, size_height_cm: 20, xrf_material: 'metal', xrf_elements: 'Fe:55.2, Ti:1.1', gpr_signature: '[188.2,24.6,54.1,47.3,1.79,4.41,0.31,0.52,93400,0.16,0.84,0.74,0.76,6,0.05,8,0.16,11.8]', gps_lat: 5.612, gps_lng: 100.398, excavation_date: '2024-06-12', notes: 'example row — replace with real data', is_synthetic: 'FALSE' },
    { record_type: 'gpr_xrf', site_id: 'SB1B', scan_filename: 'SB1B_ceramic_002.dzt', depth_m: 0.8, size_width_cm: 22, size_height_cm: 16, xrf_material: 'ceramic', xrf_elements: 'Si:27.4, Al:11.2', gpr_signature: '', gps_lat: 5.613, gps_lng: 100.397, excavation_date: '2024-06-13', notes: 'example row — replace with real data. gpr_signature left blank here on purpose: optional, only fill it in if you have a real 18-value feature vector (see knn.js extractFeatures order) — otherwise leave blank and the row still imports fine, just won'+"'"+'t be matchable by knnSearch.', is_synthetic: 'FALSE' },
    { record_type: 'xrf_only', site_id: '', scan_filename: '', depth_m: '', size_width_cm: '', size_height_cm: '', xrf_material: 'bone', xrf_elements: 'Ca:31.0, P:14.2', gpr_signature: '', gps_lat: '', gps_lng: '', excavation_date: '', notes: 'xrf_only rows skip depth/scan/size/signature', is_synthetic: 'TRUE' },
  ];
  return Papa.unparse({ fields: TEMPLATE_HEADERS, data: example.map((r) => TEMPLATE_HEADERS.map((h) => r[h])) });
}
