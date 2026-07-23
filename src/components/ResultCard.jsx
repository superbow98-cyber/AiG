import { useState } from 'react'
import ConfidenceBar from './ConfidenceBar'

const MATERIAL_COLORS = {
  ceramic: '#34d399',
  metal:   '#f87171',
  bone:    '#fbbf24',
  stone:   '#a78bfa',
  void:    '#38bdf8',
  unknown: '#94a3b8',
}

function color(material) {
  return MATERIAL_COLORS[material?.toLowerCase()] ?? MATERIAL_COLORS.unknown
}

export default function ResultCard({ object, index, onSaveToDb }) {
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(false)

  const mat = object.material ?? object.label ?? 'unknown'
  const conf = object.confidence ?? 0
  const matColor = color(mat)

  async function handleSave() {
    if (saved || !onSaveToDb) return
    await onSaveToDb()
    setSaved(true)
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-shadow hover:shadow-md"
      style={{ background: '#F7F3D0', borderColor: '#F0E9B8' }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-5 py-4 flex items-center gap-4"
      >
        {/* Numbered circle */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold shadow"
          style={{ background: matColor }}
        >
          {index}
        </div>

        {/* Material + position */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-stone-800 capitalize">{mat}</span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full border"
              style={{ color: matColor, borderColor: matColor, background: '#FDFBF0' }}
            >
              {(conf * 100).toFixed(0)}% conf
            </span>
            {/* §41 — warn when this label isn't backed by enough confirmed
                reference records (< MIN_SAMPLES_PER_CLASS). Previously
                predictMaterial() computed this but Classify.jsx dropped it
                before it ever reached the UI. */}
            {object.insufficientData && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1"
                style={{ color: '#b45309', borderColor: '#fbbf24', background: '#fffbeb' }}
                title={`Only ${object.classSampleCount ?? 0} confirmed "${mat}" record(s) in the reference database — this label is a thin/low-confidence match, not yet data-sufficient.`}
              >
                ⚠ low sample ({object.classSampleCount ?? 0})
              </span>
            )}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            Position: {object.position_m?.toFixed(2) ?? '—'} m along survey
          </div>
        </div>

        {/* Chevron */}
        <svg
          className="w-4 h-4 text-stone-400 shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Confidence bar */}
      <div className="px-5 pb-3">
        <ConfidenceBar
          label={mat}
          confidence={conf}
          color={matColor}
          showLabel={false}
          showPct={false}
          height={6}
        />
      </div>

      {/* Metrics row */}
      <div
        className="grid grid-cols-3 divide-x border-t border-b text-center"
        style={{ borderColor: '#E8DFA0', divideColor: '#E8DFA0' }}
      >
        {[
          { label: 'Depth', value: object.depth_m != null ? `${object.depth_m.toFixed(2)} m` : '—' },
          { label: 'Size', value: object.size_width_cm != null ? `${object.size_width_cm.toFixed(1)} cm` : '—' },
          { label: 'Travel', value: object.depth_ns != null ? `${object.depth_ns.toFixed(1)} ns` : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="py-3 px-2" style={{ borderColor: '#E8DFA0' }}>
            <div className="text-xs text-stone-500 mb-0.5">{label}</div>
            <div className="text-sm font-bold text-stone-800">{value}</div>
          </div>
        ))}
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-5 py-4 space-y-4 border-t" style={{ borderColor: '#E8DFA0' }}>

          {/* Top DB matches */}
          {object.top_matches?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-stone-500 mb-2 uppercase tracking-wide">
                Top Database Matches
              </div>
              <div className="space-y-2">
                {object.top_matches.slice(0, 3).map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-16 text-xs text-stone-600 capitalize truncate">{m.material}</div>
                    <div className="flex-1 rounded-full overflow-hidden h-2" style={{ background: '#E8DFA0' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(m.similarity * 100).toFixed(0)}%`, background: color(m.material) }}
                      />
                    </div>
                    <div className="text-xs font-mono text-stone-500 w-8 text-right">
                      {(m.similarity * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* XRF elements */}
          {object.xrf_elements && Object.keys(object.xrf_elements).length > 0 && (
            <div>
              <div className="text-xs font-semibold text-stone-500 mb-2 uppercase tracking-wide">
                XRF Elements (best match)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(object.xrf_elements).map(([el, val]) => (
                  <span
                    key={el}
                    className="text-xs font-mono px-2 py-0.5 rounded-full border"
                    style={{ borderColor: '#E8DFA0', background: '#FDFBF0', color: '#44403C' }}
                  >
                    {el}: {typeof val === 'number' ? val.toFixed(1) : val}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Hyperbola shape */}
          {object.hyperbola && (
            <div>
              <div className="text-xs font-semibold text-stone-500 mb-2 uppercase tracking-wide">
                Hyperbola Shape
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Amplitude', value: object.hyperbola.amplitude?.toFixed(3) ?? '—' },
                  { label: 'Width (tr)', value: object.hyperbola.width_traces?.toFixed(0) ?? '—' },
                  { label: 'Curvature', value: object.hyperbola.curvature?.toFixed(3) ?? '—' },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="text-center rounded-xl border py-2 px-1"
                    style={{ background: '#FDFBF0', borderColor: '#E8DFA0' }}
                  >
                    <div className="text-xs text-stone-500 mb-0.5">{label}</div>
                    <div className="text-sm font-bold font-mono text-stone-700">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save to DB button */}
          {onSaveToDb && (
            <div className="pt-1">
              <button
                onClick={handleSave}
                disabled={saved}
                className="w-full py-2.5 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-60"
                style={saved
                  ? { background: '#F0FDF4', borderColor: '#86EFAC', color: '#166534' }
                  : { background: '#FDFBF0', borderColor: '#C9971A', color: '#C9971A' }
                }
              >
                {saved ? '✓ Saved to Database' : 'Save to Database'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
