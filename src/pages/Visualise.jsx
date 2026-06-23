import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import BScanViewer from '../components/BScanViewer'
import DepthScale from '../components/DepthScale'
import { getColormapNames, getMatrixRange } from '../utils/colormap'

export default function Visualise() {
  const { state } = useLocation()
  const navigate = useNavigate()

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

  const { matrix, metadata, filename, format, velocity, scanId, preprocessed, preprocessSteps } = state

  const [colormap, setColormap] = useState('seismic')
  const [hoverInfo, setHoverInfo] = useState(null)

  const { min: defaultMin, max: defaultMax } = getMatrixRange(matrix)
  const [minVal, setMinVal] = useState(defaultMin)
  const [maxVal, setMaxVal] = useState(defaultMax)

  const colormapNames = getColormapNames()

  function handleRunDetection() {
    navigate('/detect', { state })
  }

  return (
    <div className="min-h-full p-6 flex flex-col" style={{ background: '#FDFBF0' }}>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Visualise B-scan</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-stone-500 text-sm truncate max-w-xs">{filename ?? 'Untitled'}</span>
            {preprocessed && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                style={{ color: '#C9971A', borderColor: '#C9971A', background: '#FDFBF0' }}
              >
                Preprocessed
              </span>
            )}
          </div>
          {preprocessed && preprocessSteps?.length > 0 && (
            <p className="text-xs text-stone-400 mt-0.5">
              Steps: {preprocessSteps.join(' → ')}
            </p>
          )}
        </div>
        <button
          onClick={handleRunDetection}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: '#C9971A' }}
        >
          Run Detection →
        </button>
      </div>

      {/* Controls bar */}
      <div
        className="rounded-2xl border p-4 mb-5 flex flex-wrap items-center gap-6"
        style={{ background: '#F7F3D0', borderColor: '#F0E9B8' }}
      >
        {/* Colormap */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-stone-600 whitespace-nowrap">Colormap</label>
          <select
            value={colormap}
            onChange={e => setColormap(e.target.value)}
            className="text-sm rounded-lg border px-2 py-1.5 text-stone-700 focus:outline-none"
            style={{ borderColor: '#E8DFA0', background: '#FDFBF0' }}
          >
            {colormapNames.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Min amplitude */}
        <div className="flex items-center gap-2 flex-1 min-w-36">
          <label className="text-xs font-medium text-stone-600 whitespace-nowrap">Min amp</label>
          <input
            type="range"
            min={defaultMin}
            max={defaultMax}
            step={(defaultMax - defaultMin) / 200}
            value={minVal}
            onChange={e => setMinVal(Number(e.target.value))}
            className="flex-1 accent-amber-500"
          />
          <span className="text-xs text-stone-500 w-12 text-right">{minVal.toFixed(1)}</span>
        </div>

        {/* Max amplitude */}
        <div className="flex items-center gap-2 flex-1 min-w-36">
          <label className="text-xs font-medium text-stone-600 whitespace-nowrap">Max amp</label>
          <input
            type="range"
            min={defaultMin}
            max={defaultMax}
            step={(defaultMax - defaultMin) / 200}
            value={maxVal}
            onChange={e => setMaxVal(Number(e.target.value))}
            className="flex-1 accent-amber-500"
          />
          <span className="text-xs text-stone-500 w-12 text-right">{maxVal.toFixed(1)}</span>
        </div>

        {/* Reset range */}
        <button
          onClick={() => { setMinVal(defaultMin); setMaxVal(defaultMax) }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
          style={{ borderColor: '#E8DFA0', color: '#92692A', background: '#FDFBF0' }}
        >
          Reset
        </button>
      </div>

      {/* Hover info bar */}
      <div
        className="rounded-xl border px-4 py-2 mb-4 flex flex-wrap gap-6 text-xs font-mono"
        style={{
          background: '#F7F3D0',
          borderColor: '#F0E9B8',
          minHeight: 36,
          color: hoverInfo ? '#44403C' : '#A8A29E',
        }}
      >
        {hoverInfo ? (
          <>
            <span>Trace: <strong>{hoverInfo.trace}</strong></span>
            <span>Sample: <strong>{hoverInfo.sample}</strong></span>
            <span>Depth: <strong>{hoverInfo.depth_m.toFixed(3)} m</strong></span>
            <span>Amplitude: <strong>{hoverInfo.amplitude.toFixed(4)}</strong></span>
          </>
        ) : (
          <span>Hover over the B-scan to inspect values</span>
        )}
      </div>

      {/* B-scan viewer */}
      <div
        className="flex-1 rounded-2xl border overflow-hidden"
        style={{ background: '#F7F3D0', borderColor: '#F0E9B8', minHeight: 400 }}
      >
        <div className="flex h-full" style={{ minHeight: 400 }}>
          <DepthScale
            samples={metadata.samples}
            dt_ns={metadata.dt_ns}
            velocity={velocity ?? 0.1}
            height_px={480}
          />
          <div className="flex-1 min-w-0">
            <BScanViewer
              matrix={matrix}
              colormap={colormap}
              minVal={minVal}
              maxVal={maxVal}
              height={480}
              velocity={velocity ?? 0.1}
              dt_ns={metadata.dt_ns}
              onPixelHover={setHoverInfo}
            />
          </div>
        </div>
      </div>

      {/* Scan info footer */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-stone-500">
        <span>{metadata.traces} traces × {metadata.samples} samples</span>
        <span>dt = {metadata.dt_ns} ns</span>
        <span>v = {(velocity ?? 0.1).toFixed(3)} m/ns</span>
        <span>Format: {format?.toUpperCase()}</span>
      </div>
    </div>
  )
}
