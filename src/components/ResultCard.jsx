// AiG — ResultCard.jsx
// Single detected object summary card.
//
// Props:
//   object — ClassificationResult (see BRAIN §6 Detection + Classification shape)
//   index  — display number (1-based)
//   onSaveToDb — optional callback () => void, shows "Save to DB" button if provided
//
// Consumed by: Results.jsx, Classify.jsx

import { useState } from 'react';
import ConfidenceBar from './ConfidenceBar';

const MATERIAL_COLORS = {
  ceramic: '#34d399', metal: '#f87171', bone: '#fbbf24',
  stone:   '#a78bfa', void: '#38bdf8',  unknown: '#94a3b8',
};
function matColor(label) {
  return MATERIAL_COLORS[label?.toLowerCase()] ?? MATERIAL_COLORS.unknown;
}

export default function ResultCard({ object: obj, index = 1, onSaveToDb }) {
  const [expanded, setExpanded] = useState(false);
  const [saved,    setSaved]    = useState(false);

  if (!obj) return null;

  const material   = obj.material ?? obj.label ?? 'unknown';
  const confidence = obj.confidence ?? 0;
  const color      = matColor(material);

  async function handleSave() {
    if (!onSaveToDb) return;
    await onSaveToDb(obj);
    setSaved(true);
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center
                       text-xs font-bold text-black flex-shrink-0"
            style={{ backgroundColor: color }}
          >
            {index}
          </div>
          <div>
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              Object {index}
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full capitalize"
                style={{ backgroundColor: color + '33', color }}
              >
                {material}
              </span>
            </p>
            <p className="text-gray-400 text-xs mt-0.5">
              {obj.position_m?.toFixed(2)}m along survey
            </p>
          </div>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? 'Less ▲' : 'Details ▼'}
        </button>
      </div>

      {/* ── Confidence bar ── */}
      <div className="px-5 pb-4">
        <ConfidenceBar label={material} confidence={confidence} color={color} />
      </div>

      {/* ── Key metrics row ── */}
      <div className="grid grid-cols-3 border-t border-gray-700 divide-x divide-gray-700">
        {[
          { label: 'Depth',  value: `${obj.depth_m?.toFixed(2) ?? '—'}m` },
          { label: 'Size',   value: `${obj.size_width_cm ?? '?'}×${obj.size_height_cm ?? '?'}cm` },
          { label: 'Travel', value: `${obj.depth_ns?.toFixed(1) ?? '—'}ns` },
        ].map(({ label, value }) => (
          <div key={label} className="py-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">{label}</p>
            <p className="text-sm font-mono font-bold text-gray-200">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-gray-700 px-5 py-4 space-y-4">

          {/* Top DB matches */}
          {obj.top_matches?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 mb-2">Top DB Matches</p>
              <div className="space-y-1.5">
                {obj.top_matches.map((m, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: matColor(m.material) }}
                    />
                    <span className="text-xs text-gray-300 capitalize w-20">{m.material}</span>
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(1, m.similarity)) * 100}%`,
                          backgroundColor: matColor(m.material),
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 font-mono w-10 text-right">
                      {(m.similarity * 100).toFixed(0)}%
                    </span>
                    {m.site_id && (
                      <span className="text-xs text-gray-600 font-mono">{m.site_id}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* XRF elements */}
          {obj.xrf_elements && Object.keys(obj.xrf_elements).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 mb-2">XRF Elements</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(obj.xrf_elements)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([el, pct]) => (
                    <span
                      key={el}
                      className="text-xs font-mono bg-gray-700 text-gray-200 px-2 py-1 rounded"
                    >
                      {el}: {typeof pct === 'number' ? pct.toFixed(1) : pct}%
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Hyperbola shape */}
          {obj.hyperbola && (
            <div>
              <p className="text-xs font-semibold text-gray-400 mb-2">Hyperbola Shape</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Amplitude',  value: obj.hyperbola.amplitude?.toFixed(1) },
                  { label: 'Width',      value: `${obj.hyperbola.width_traces ?? '—'} tr` },
                  { label: 'Curvature', value: obj.hyperbola.curvature?.toFixed(3) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-900 rounded-lg p-2 text-center">
                    <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                    <p className="text-xs font-mono font-bold text-gray-300">{value ?? '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save to DB button */}
          {onSaveToDb && (
            <button
              onClick={handleSave}
              disabled={saved}
              className="w-full py-2 text-sm font-semibold rounded-lg transition-colors
                         disabled:bg-gray-700 disabled:text-gray-500
                         bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {saved ? '✓ Saved to Database' : 'Save to Database'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
