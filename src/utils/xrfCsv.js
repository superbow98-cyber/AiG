// AiG — xrfCsv.js
// Parses a CSV of XRF elemental readings (one row = one reading) into rows
// usable by XRFWorkspace.jsx's "Load from CSV" dropdown. Column headers are
// matched case-insensitively against models/xrfMLP.js's XRF_ELEMENTS list
// (Fe, Cu, Pb, Ca, Si, Al, Ti, Zn); any of a few common label-ish columns
// (site_id, material, label, name, sample, id) is picked up for display,
// falling back to "Row N".
//
// Consumed by: pages/XRFWorkspace.jsx

import Papa from 'papaparse';
import { XRF_ELEMENTS } from '../models/xrfMLP';

const LABEL_COLUMN_CANDIDATES = ['site_id', 'material', 'label', 'name', 'sample', 'sample_id', 'id'];

/**
 * @param {string} csvText
 * @returns {{ rows: Array<{ id: string, label: string, elements: Record<string, number>, missing: string[] }>, error: string|null }}
 */
export function parseXRFCsv(csvText) {
  const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });

  if (parsed.errors?.length) {
    const first = parsed.errors[0];
    return { rows: [], error: `Could not parse CSV: ${first.message} (row ${first.row ?? '?'})` };
  }
  if (!parsed.data.length) {
    return { rows: [], error: 'CSV has no data rows.' };
  }

  const headers = parsed.meta.fields ?? [];
  const lowerToOriginal = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));

  // Map each canonical element symbol → the actual CSV header that matches it,
  // case-insensitively (e.g. "fe" or "FE" both match "Fe").
  const elementColumns = {};
  for (const el of XRF_ELEMENTS) {
    const match = lowerToOriginal.get(el.toLowerCase());
    if (match) elementColumns[el] = match;
  }

  if (Object.keys(elementColumns).length === 0) {
    return {
      rows: [],
      error: `No recognised element columns found. Expected header names matching: ${XRF_ELEMENTS.join(', ')} (case-insensitive). Found columns: ${headers.join(', ') || '(none)'}.`,
    };
  }

  const labelColumn = LABEL_COLUMN_CANDIDATES
    .map((c) => lowerToOriginal.get(c))
    .find(Boolean);

  const rows = parsed.data.map((rawRow, i) => {
    const elements = {};
    const missing = [];
    for (const el of XRF_ELEMENTS) {
      const col = elementColumns[el];
      const raw = col ? rawRow[col] : undefined;
      const num = raw === undefined || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(num)) {
        elements[el] = num;
      } else {
        missing.push(el);
      }
    }
    const label = labelColumn && rawRow[labelColumn] ? String(rawRow[labelColumn]) : `Row ${i + 1}`;
    return { id: `csv-row-${i}`, label, elements, missing };
  });

  return { rows, error: null };
}
