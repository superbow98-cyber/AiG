import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import FileLoader from '../components/FileLoader'
import useGPRData from '../hooks/useGPRData'

export default function Upload() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { scan, setScan, loadDemo } = useGPRData()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedId, setSavedId] = useState(null)

  async function handleSaveToDb() {
    if (!scan.matrix || !scan.metadata) return
    setSaving(true)
    setSaveError(null)
    const { data, error } = await supabase.from('gpr_scans').insert({
      user_id: user.id,
      filename: scan.filename,
      format: scan.format,
      traces: scan.metadata.traces,
      samples: scan.metadata.samples,
      dt_ns: scan.metadata.dt_ns,
      dx_m: scan.metadata.dx_m ?? 0.02,
    }).select('id').single()
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    setSavedId(data.id)
  }

  function handleProceed() {
    navigate('/preprocess', {
      state: {
        matrix: scan.matrix,
        metadata: scan.metadata,
        filename: scan.filename,
        format: scan.format,
        velocity: scan.velocity,
        scanId: savedId ?? null,
      }
    })
  }

  const meta = scan.metadata

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Upload GPR Scan</h1>
        <p className="text-stone-500 text-sm mt-1">
          Supported formats: .DZT, .dt2/.rd3 (Mala), .sgy, .csv
        </p>
      </div>

      {/* File loader card */}
      <div
        className="rounded-2xl p-6 mb-6 border"
        style={{ background: '#F7F3D0', borderColor: '#F0E9B8' }}
      >
        <FileLoader setScan={setScan} loadDemo={loadDemo} scan={scan} />
      </div>

      {/* Metadata summary */}
      {meta && (
        <div
          className="rounded-2xl p-6 mb-6 border"
          style={{ background: '#F7F3D0', borderColor: '#F0E9B8' }}
        >
          <h2 className="text-base font-semibold text-stone-700 mb-4">Scan Metadata</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Traces', value: meta.traces?.toLocaleString() ?? '—' },
              { label: 'Samples', value: meta.samples?.toLocaleString() ?? '—' },
              { label: 'Time step (dt)', value: meta.dt_ns != null ? `${meta.dt_ns} ns` : '—' },
              { label: 'Trace spacing', value: meta.dx_m != null ? `${meta.dx_m} m` : '—' },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-xl p-4 text-center border"
                style={{ background: '#FDFBF0', borderColor: '#E8DFA0' }}
              >
                <div className="text-xs text-stone-500 mb-1">{label}</div>
                <div className="text-lg font-bold text-stone-800">{value}</div>
              </div>
            ))}
          </div>

          {/* Format badge */}
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-stone-500">Format:</span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full border"
              style={{ color: '#C9971A', borderColor: '#C9971A', background: '#FDFBF0' }}
            >
              {scan.format?.toUpperCase() ?? '—'}
            </span>
            <span className="text-xs text-stone-500 ml-2 truncate max-w-xs">{scan.filename}</span>
          </div>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="mb-4 rounded-xl p-3 border border-red-200 bg-red-50 text-red-700 text-sm">
          {saveError}
        </div>
      )}

      {/* Action row */}
      {scan.matrix && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Save to DB */}
          {!savedId ? (
            <button
              onClick={handleSaveToDb}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50"
              style={{
                borderColor: '#C9971A',
                color: '#C9971A',
                background: '#FDFBF0',
              }}
            >
              {saving ? 'Saving…' : 'Save to Database'}
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium"
              style={{ borderColor: '#E8DFA0', background: '#F7F3D0', color: '#92692A' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved to Database
            </div>
          )}

          {/* Proceed */}
          <button
            onClick={handleProceed}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: '#C9971A' }}
          >
            Proceed to Preprocess →
          </button>

          {/* Skip */}
          <button
            onClick={() => navigate('/visualise', {
              state: {
                matrix: scan.matrix,
                metadata: scan.metadata,
                filename: scan.filename,
                format: scan.format,
                velocity: scan.velocity,
                scanId: savedId ?? null,
              }
            })}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-stone-500 hover:text-stone-700 transition-colors"
          >
            Skip to Visualise
          </button>
        </div>
      )}
    </div>
  )
}
