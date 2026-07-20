import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Link } from 'react-router-dom'
import BScanViewer from '../components/BScanViewer'
import DepthScale from '../components/DepthScale'
import StatusBar from '../components/StatusBar'
import { usePreprocessing, STEP_DEFS } from '../hooks/usePreprocessing'
import { getMatrixRange } from '../utils/colormap'

const STEP_KEYS = ['backgroundRemoval', 'dewow', 'linearGain', 'agc', 'bandpass', 'pca', 'ica']

const PARAM_DEFAULTS = {
  linearGain: { factor: 2 },
  agc: { windowSize: 32 },
  bandpass: { lowMHz: 200, highMHz: 800 },
  pca: { nComponents: 2 },
  ica: { nComponents: 3 },
}

// Short practical guidance shown under each slider — how to pick a value,
// not just what the parameter does (that's already in STEP_DEFS description).
const PARAM_GUIDANCE = {
  linearGain: {
    factor: 'Higher = deeper reflections boosted more. Start at 2. Push to 3–4 if deep targets look faint; drop to 1–1.5 if shallow signal is already saturated/clipping.',
  },
  agc: {
    windowSize: 'Samples per averaging window. Smaller (16–24) = more aggressive, can amplify noise. Larger (48–64) = gentler, keeps more true amplitude contrast. 32 is a safe middle ground for most antennas.',
  },
  bandpass: {
    lowMHz: 'Set to roughly half your antenna\'s centre frequency (e.g. 100 MHz antenna → ~50 MHz low cut) to remove slow DC drift without cutting real signal.',
    highMHz: 'Set to roughly 2–3× your antenna\'s centre frequency (e.g. 100 MHz antenna → ~250–300 MHz high cut) to suppress high-frequency noise above what the antenna can actually resolve.',
  },
  pca: {
    nComponents: 'Number of dominant horizontal-banding components to strip out. Start at 2. Raise only if banding/clutter persists after — going too high starts removing real shallow reflections, not just clutter.',
  },
  ica: {
    nComponents: 'Number of independent noise sources to separate out. Start at 3. Best used after PCA if clutter is still messy/non-uniform (PCA alone handles simple coherent banding; ICA handles more irregular interference).',
  },
}

export default function Preprocess() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [splitView, setSplitView] = useState(true)
  const [paramState, setParamState] = useState(PARAM_DEFAULTS)

  const { processedMatrix, steps, applyStep, removeStep, reset, processing, error } =
    usePreprocessing(state?.matrix ?? null, state?.metadata ?? null)

  if (!state?.matrix) {
    return (
      <div className="min-h-full flex items-center justify-center" style={{ background: '#FDFBF0' }}>
        <div className="text-center">
          <p className="text-stone-500 mb-4">No scan loaded.</p>
          <Link to="/upload" className="text-sm font-medium" style={{ color: '#C9971A' }}>
            ← Go to Upload
          </Link>
        </div>
      </div>
    )
  }

  const { matrix: rawMatrix, metadata, filename, format, velocity, scanId } = state
  const largeScan = metadata?.traces > 1500

  // BScanViewer needs a real amplitude range — passing null/null silently
  // becomes range=0 in normaliseValue() and paints every pixel black.
  // Before/After have different ranges (e.g. AGC/gain steps change scale),
  // so compute each independently and recompute AFTER whenever it changes.
  const { min: beforeMin, max: beforeMax } = getMatrixRange(rawMatrix)
  const afterMatrix = processedMatrix ?? rawMatrix
  const { min: afterMin, max: afterMax } = getMatrixRange(afterMatrix)

  function handleAdd(key) {
    applyStep(key, paramState[key])
  }

  function handleApply() {
    navigate('/visualise', {
      state: {
        matrix: processedMatrix ?? rawMatrix,
        metadata,
        filename,
        format,
        velocity,
        scanId,
        preprocessed: steps.length > 0,
        preprocessSteps: steps.map(s => STEP_DEFS[s.name]?.label ?? s.name),
      }
    })
  }

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Preprocess</h1>
          <p className="text-stone-500 text-sm mt-1 truncate max-w-md">
            {filename ?? 'Untitled scan'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSplitView(v => !v)}
            className="px-4 py-2 rounded-xl text-sm border font-medium transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            {splitView ? 'Single view' : 'Split view'}
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-xl text-sm border font-medium transition-colors"
            style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#F7F3D0' }}
          >
            Reset all
          </button>
        </div>
      </div>

      {/* Large scan warning */}
      {largeScan && (
        <div
          className="mb-4 rounded-xl p-3 border text-sm"
          style={{ background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }}
        >
          ⚠ Scan has {metadata.traces} traces — PCA/ICA may be slow in-browser.
        </div>
      )}

      {/* StatusBar */}
      <StatusBar step="Processing…" progress={processing ? 60 : 100} visible={processing} />

      {/* B-scan viewers */}
      <div className={`mb-6 rounded-2xl border overflow-hidden ${splitView ? 'grid grid-cols-2' : ''}`}
        style={{ borderColor: '#F0E9B8', background: '#F7F3D0' }}>

        {/* Before */}
        <div className="p-3 border-r" style={{ borderColor: '#F0E9B8' }}>
          <div className="text-xs font-semibold text-stone-500 mb-2 px-1">BEFORE</div>
          <div className="flex" style={{ height: 320 }}>
            <DepthScale
              samples={metadata.samples}
              dt_ns={metadata.dt_ns}
              velocity={velocity}
              height_px={320}
            />
            <div className="flex-1 min-w-0">
              <BScanViewer
                matrix={rawMatrix}
                colormap="grey"
                minVal={beforeMin}
                maxVal={beforeMax}
                height={320}
                velocity={velocity}
                dt_ns={metadata.dt_ns}
              />
            </div>
          </div>
        </div>

        {/* After */}
        {splitView && (
          <div className="p-3">
            <div className="text-xs font-semibold mb-2 px-1" style={{ color: '#C9971A' }}>
              AFTER
            </div>
            <div className="flex" style={{ height: 320 }}>
              <DepthScale
                samples={metadata.samples}
                dt_ns={metadata.dt_ns}
                velocity={velocity}
                height_px={320}
              />
              <div className="flex-1 min-w-0">
                <BScanViewer
                  matrix={afterMatrix}
                  colormap="grey"
                  minVal={afterMin}
                  maxVal={afterMax}
                  height={320}
                  velocity={velocity}
                  dt_ns={metadata.dt_ns}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl p-3 border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Step builder */}
        <div className="rounded-2xl border p-5" style={{ background: '#F7F3D0', borderColor: '#F0E9B8' }}>
          <h2 className="text-base font-semibold text-stone-700 mb-4">Add Processing Steps</h2>
          <div className="space-y-3">
            {STEP_KEYS.filter(key => STEP_DEFS[key]).map(key => {
              const def = STEP_DEFS[key]
              const params = paramState[key]
              return (
                <div key={key} className="rounded-xl border p-3" style={{ borderColor: '#E8DFA0', background: '#FDFBF0' }}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <div className="text-sm font-semibold text-stone-700">{def.label}</div>
                      <div className="text-xs text-stone-500">{def.description}</div>
                    </div>
                    <button
                      onClick={() => handleAdd(key)}
                      disabled={processing}
                      className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                      style={{ background: '#C9971A' }}
                    >
                      + Add
                    </button>
                  </div>

                  {/* Param sliders */}
                  {params && Object.entries(params).map(([p, val]) => (
                    <div key={p} className="mt-2">
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-stone-500 w-28 shrink-0">{p}</label>
                        <input
                          type="range"
                          min={p === 'nComponents' ? 1 : p === 'factor' ? 0.5 : p === 'windowSize' ? 8 : p === 'lowMHz' ? 50 : p === 'highMHz' ? 200 : 0}
                          max={p === 'nComponents' ? 8 : p === 'factor' ? 10 : p === 'windowSize' ? 128 : p === 'lowMHz' ? 500 : p === 'highMHz' ? 1200 : 10}
                          step={p === 'factor' ? 0.5 : 1}
                          value={val}
                          onChange={e =>
                            setParamState(prev => ({
                              ...prev,
                              [key]: { ...prev[key], [p]: Number(e.target.value) }
                            }))
                          }
                          className="flex-1 accent-amber-500"
                        />
                        <span className="text-xs text-stone-600 w-10 text-right">{val}{p.includes('MHz') ? ' MHz' : ''}</span>
                      </div>
                      {PARAM_GUIDANCE[key]?.[p] && (
                        <p className="text-[11px] text-stone-400 leading-snug mt-1 pl-[7.5rem] pr-1">
                          {PARAM_GUIDANCE[key][p]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Pipeline */}
        <div className="rounded-2xl border p-5" style={{ background: '#F7F3D0', borderColor: '#F0E9B8' }}>
          <h2 className="text-base font-semibold text-stone-700 mb-4">
            Pipeline{steps.length > 0 && <span className="ml-2 text-xs font-normal text-stone-500">({steps.length} step{steps.length > 1 ? 's' : ''})</span>}
          </h2>

          {steps.length === 0 ? (
            <p className="text-sm text-stone-400 py-8 text-center">No steps added yet.</p>
          ) : (
            <ol className="space-y-2 mb-4">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center justify-between rounded-xl px-4 py-3 border"
                  style={{ background: '#FDFBF0', borderColor: '#E8DFA0' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center text-white"
                      style={{ background: '#C9971A' }}>
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-stone-700">
                      {STEP_DEFS[s.name]?.label ?? s.name}
                    </span>
                  </div>
                  <button
                    onClick={() => removeStep(i)}
                    className="text-stone-400 hover:text-red-500 transition-colors text-lg leading-none"
                    title="Remove step"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* Proceed buttons */}
          <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: '#E8DFA0' }}>
            <button
              onClick={handleApply}
              disabled={processing}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#C9971A' }}
            >
              {steps.length > 0 ? 'Apply & Visualise →' : 'Skip to Visualise →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
