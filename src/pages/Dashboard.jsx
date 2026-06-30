// AiG — Dashboard.jsx  (LOCKED SPEC §6aq — pastel/gold theme + live Supabase)
// Main hub after login. Live counts from Supabase + recent scans table.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ScanLine,
  Database as DatabaseIcon,
  Layers,
  Clock,
  Upload as UploadIcon,
  ArrowRight,
  Info,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function relativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (Number.isNaN(diff)) return '—'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const FORMAT_COLORS = {
  dzt: 'bg-amber-100 text-amber-800',
  rd3: 'bg-emerald-100 text-emerald-800',
  dt2: 'bg-emerald-100 text-emerald-800',
  sgy: 'bg-sky-100 text-sky-800',
  csv: 'bg-stone-200 text-stone-700',
  synthetic: 'bg-violet-100 text-violet-800',
}

function StatCard({ Icon, label, value, sub }) {
  return (
    <div className="bg-white border border-[#F0E9B8] rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-stone-500">{label}</p>
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#F7F3D0] text-[#C9971A]">
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold text-stone-800 capitalize">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { user, isGuest } = useAuth()
  const [loading, setLoading] = useState(true)
  const [scanCount, setScanCount] = useState(0)
  const [xrfCount, setXrfCount] = useState(0)
  const [topMaterial, setTopMaterial] = useState('—')
  const [recentScans, setRecentScans] = useState([])
  const [latest, setLatest] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const { data: scans, count: sCount } = await supabase
          .from('gpr_scans')
          .select('id, filename, format, created_at', { count: 'exact' })
          .order('created_at', { ascending: false })
          .limit(8)

        const { data: xrfRows, count: xCount } = await supabase
          .from('gpr_xrf_records')
          .select('xrf_material', { count: 'exact' })

        if (!active) return

        setScanCount(sCount ?? 0)
        setRecentScans(scans ?? [])
        setLatest(scans && scans.length ? scans[0].created_at : null)
        setXrfCount(xCount ?? 0)

        if (xrfRows && xrfRows.length) {
          const freq = {}
          for (const r of xrfRows) {
            const m = r.xrf_material || 'unknown'
            freq[m] = (freq[m] ?? 0) + 1
          }
          const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
          setTopMaterial(top ? top[0] : '—')
        } else {
          setTopMaterial('—')
        }
      } catch (_) {
        // Supabase unavailable (e.g. guest / not configured) — show empty state.
        if (active) {
          setScanCount(0)
          setXrfCount(0)
          setRecentScans([])
          setTopMaterial('—')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  const firstName =
    user?.user_metadata?.full_name?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'Researcher'

  return (
    <div className="min-h-full p-6" style={{ background: '#FDFBF0' }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">
            Welcome back, <span className="capitalize">{firstName}</span>
          </h1>
          <p className="text-stone-500 text-sm mt-1">
            Upload a GPR scan and run the AI pipeline — position, depth, size, and material.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C9971A] hover:bg-[#a87d12]
                     text-white text-sm font-semibold shadow-sm transition-colors"
        >
          <UploadIcon className="w-4 h-4" />
          New scan
        </Link>
      </div>

      {/* Guest banner */}
      {isGuest && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            You're in <strong>guest mode</strong>. The full analysis pipeline works offline, but
            saving scans and GPR+XRF records to the cloud database needs a Google sign-in.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard Icon={ScanLine}     label="Total GPR Scans"      value={loading ? '…' : scanCount} />
        <StatCard Icon={DatabaseIcon} label="XRF Database Records"  value={loading ? '…' : xrfCount} />
        <StatCard Icon={Layers}       label="Top Predicted Material" value={loading ? '…' : topMaterial} />
        <StatCard Icon={Clock}        label="Latest Scan"          value={loading ? '…' : relativeTime(latest)} />
      </div>

      {/* Recent scans */}
      <div className="bg-white border border-[#F0E9B8] rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#F0E9B8] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">Recent Scans</h2>
          <Link to="/upload" className="text-xs font-medium text-[#C9971A] hover:underline inline-flex items-center gap-1">
            Upload more <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-stone-400">Loading…</div>
        ) : recentScans.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-stone-500 mb-3">No scans yet.</p>
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F7F3D0] border border-[#E8DFA0]
                         text-sm font-medium text-stone-700 hover:bg-[#F0E9B8] transition-colors"
            >
              <UploadIcon className="w-4 h-4" /> Upload your first scan
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF0] text-stone-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">Filename</th>
                <th className="px-5 py-2.5 text-left font-medium">Format</th>
                <th className="px-5 py-2.5 text-left font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0E9B8]">
              {recentScans.map((row) => (
                <tr key={row.id} className="hover:bg-[#FDFBF0] transition-colors">
                  <td className="px-5 py-3 text-stone-700 font-medium truncate max-w-xs">
                    <Link to="/upload" className="hover:text-[#C9971A]">{row.filename}</Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${FORMAT_COLORS[row.format] ?? 'bg-stone-200 text-stone-700'}`}>
                      {row.format}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-stone-500">{relativeTime(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
