// AiG — exportResults.js
// Export classification results as a PDF report, CSV, or JSON.
//
// Contract (BRAIN §6i) — consumed by Results.jsx:
//   generatePDFReport(results, meta)   // builds + auto-downloads a jsPDF report, returns the doc
//   exportCSV(results, filename)       // flattens results → CSV, triggers download
//   exportJSON(results, filename)      // JSON.stringify results, triggers download
//
// `results` are ClassificationResult[] (see BRAIN §5):
//   { id, trace, position_m, depth_ns, depth_m, size_width_cm, size_height_cm,
//     material, confidence, top_matches[], xrf_elements, hyperbola, features }
//
// `meta` is the object Results.jsx passes:
//   { filename, metadata, velocity, scanLengthM }

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';

// ── small helpers ───────────────────────────────────────────────────────────
function safeName(filename, ext) {
  const base = (filename || 'aig_results').replace(/\.[^/.]+$/, '');
  return `${base}_aig.${ext}`;
}

function triggerDownload(blob, downloadName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmt(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return typeof v === 'number' ? v.toFixed(digits) : String(v);
}

// Flatten one ClassificationResult into a plain row for CSV / table output.
function flattenResult(d, i) {
  const topMatch = Array.isArray(d.top_matches) && d.top_matches.length ? d.top_matches[0] : null;
  return {
    index: i + 1,
    id: d.id ?? '',
    material: d.material ?? d.label ?? 'unknown',
    confidence_pct: d.confidence != null ? Math.round(d.confidence * 100) : '',
    trace: d.trace ?? '',
    position_m: d.position_m != null ? +d.position_m.toFixed(3) : '',
    depth_m: d.depth_m != null ? +d.depth_m.toFixed(3) : '',
    depth_ns: d.depth_ns != null ? +d.depth_ns.toFixed(2) : '',
    size_width_cm: d.size_width_cm != null ? +d.size_width_cm.toFixed(1) : '',
    size_height_cm: d.size_height_cm != null ? +d.size_height_cm.toFixed(1) : '',
    top_match: topMatch ? topMatch.material : '',
    top_similarity: topMatch && topMatch.similarity != null ? +topMatch.similarity.toFixed(3) : '',
  };
}

// ── PDF report ──────────────────────────────────────────────────────────────
export async function generatePDFReport(results, meta = {}) {
  const { filename = 'scan', metadata = {}, velocity = 0.1, scanLengthM = 0 } = meta;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  // ── Header band ──
  doc.setFillColor(124, 92, 16); // #7C5C10 gold-brown
  doc.rect(0, 0, pageW, 64, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('AiG — Subsurface Identification Report', margin, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('AI-GPR · Non-destructive material prediction (GPR + XRF reference match)', margin, 48);

  // ── Scan metadata table ──
  doc.setTextColor(60, 50, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Scan Metadata', margin, 92);

  const generated = new Date().toLocaleString();
  autoTable(doc, {
    startY: 100,
    theme: 'grid',
    head: [['Property', 'Value']],
    headStyles: { fillColor: [201, 151, 26], textColor: 255 }, // #C9971A
    styles: { fontSize: 9, cellPadding: 4 },
    body: [
      ['File', filename],
      ['Format', metadata.format ?? '—'],
      ['Traces', String(metadata.traces ?? '—')],
      ['Samples', String(metadata.samples ?? '—')],
      ['Sample interval (dt)', metadata.dt_ns != null ? `${metadata.dt_ns} ns` : '—'],
      ['Trace spacing (dx)', metadata.dx_m != null ? `${metadata.dx_m} m` : '—'],
      ['Velocity assumption', `${velocity} m/ns`],
      ['Survey length', `${fmt(scanLengthM, 1)} m`],
      ['Objects detected', String(results.length)],
      ['Generated', generated],
    ],
    margin: { left: margin, right: margin },
  });

  // ── Detected objects table ──
  const afterMetaY = doc.lastAutoTable.finalY + 24;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(60, 50, 30);
  doc.text('Detected Objects', margin, afterMetaY);

  const rows = results.map((d, i) => {
    const f = flattenResult(d, i);
    return [
      f.index,
      f.material,
      f.confidence_pct !== '' ? `${f.confidence_pct}%` : '—',
      f.position_m !== '' ? `${f.position_m}` : '—',
      f.depth_m !== '' ? `${f.depth_m}` : '—',
      f.size_width_cm !== '' && f.size_height_cm !== ''
        ? `${f.size_width_cm}×${f.size_height_cm}`
        : '—',
      f.top_match || '—',
    ];
  });

  autoTable(doc, {
    startY: afterMetaY + 8,
    theme: 'striped',
    head: [['#', 'Material', 'Conf.', 'Pos (m)', 'Depth (m)', 'Size (cm)', 'Top match']],
    headStyles: { fillColor: [124, 92, 16], textColor: 255 },
    alternateRowStyles: { fillColor: [247, 243, 208] }, // #F7F3D0
    styles: { fontSize: 8.5, cellPadding: 4 },
    margin: { left: margin, right: margin },
    body: rows,
  });

  // ── Footer on every page ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150, 140, 110);
    const h = doc.internal.pageSize.getHeight();
    doc.text(
      `AiG AI-GPR Research Platform · Page ${p} of ${pageCount}`,
      margin,
      h - 20,
    );
  }

  doc.save(safeName(filename, 'pdf'));
  return doc;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
export function exportCSV(results, filename) {
  const flat = results.map((d, i) => flattenResult(d, i));
  const csv = Papa.unparse(flat);
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), safeName(filename, 'csv'));
}

// ── JSON ────────────────────────────────────────────────────────────────────
export function exportJSON(results, filename) {
  // Float32Array features won't JSON-serialise cleanly — convert to plain arrays.
  const serialisable = results.map((d) => ({
    ...d,
    features: d.features ? Array.from(d.features) : undefined,
  }));
  const json = JSON.stringify(serialisable, null, 2);
  triggerDownload(
    new Blob([json], { type: 'application/json;charset=utf-8;' }),
    safeName(filename, 'json'),
  );
}
