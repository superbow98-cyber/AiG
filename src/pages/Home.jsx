import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Radar,
  Layers,
  Database,
  ScanLine,
  Sparkles,
  ArrowRight,
} from 'lucide-react'

/**
 * Home.jsx — AiG Landing Page
 * Public route ("/"). Shows Google sign-in. Auto-redirects to
 * /dashboard if a session already exists.
 *
 * Visual spec (locked 2026-06-23):
 *  - Background: pastel yellow  #FDFBF0
 *  - Section strip / card bg:   #F7F3D0
 *  - Hero heading: gold gradient
 *      #7C5C10 -> #C9971A -> #E8C14A -> #A87820
 */

const FLOW_STEPS = [
  'Upload',
  'Preprocess',
  'Visualise',
  'Detect',
  'Classify',
  'Cluster',
]

const FEATURES = [
  {
    icon: ScanLine,
    title: 'GPR B-Scan Visualisation',
    desc: 'Render radargrams with adjustable colormaps, gain, and depth scale calibrated to soil velocity.',
  },
  {
    icon: Radar,
    title: 'AI Object Detection',
    desc: 'Hyperbola peak-picking and feature extraction to flag buried anomalies automatically.',
  },
  {
    icon: Database,
    title: 'GPR+XRF Reference Match',
    desc: 'k-NN similarity search against a lab-confirmed XRF database predicts material without excavation.',
  },
  {
    icon: Layers,
    title: 'Anomaly Clustering',
    desc: 'K-Means, DBSCAN, and SOM group detections into coherent site-wide anomaly clusters.',
  },
]

const STATS = [
  { value: '4', label: 'GPR formats supported' },
  { value: '12+', label: 'AI / ML models' },
  { value: '0', label: 'Excavations required' },
]

export default function Home() {
  const { user, loading, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  // Auto-redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, loading, navigate])

  const handleSignIn = async () => {
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign-in failed:', err)
    }
  }

  // Restoring session — avoid flashing the landing page before redirect
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF0] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FDFBF0] text-stone-800 flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-[#F0E9B8] bg-[#FDFBF0]/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-700 text-white font-bold text-sm">
              AiG
            </span>
            <span className="text-sm font-medium text-stone-500 tracking-wide hidden sm:inline">
              AI-GPR Research Platform
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm font-medium text-stone-600">
            <a href="#features" className="hover:text-stone-900 transition-colors">
              Features
            </a>
            <a href="#pipeline" className="hover:text-stone-900 transition-colors">
              Pipeline
            </a>
            <button
              onClick={handleSignIn}
              className="px-4 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
            >
              Sign in
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F7F3D0] border border-[#E8DFA0] text-xs font-medium text-emerald-800 mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            PhD Archaeological Research Tool
          </span>

          <h1 className="text-4xl sm:text-5xl font-bold leading-tight max-w-3xl mx-auto bg-clip-text text-transparent bg-gradient-to-r from-[#7C5C10] via-[#C9971A] via-[#E8C14A] to-[#A87820]">
            Detect buried objects with AI-powered GPR analysis
          </h1>

          <p className="mt-6 text-lg text-stone-600 max-w-2xl mx-auto">
            AiG processes Ground Penetrating Radar B-scans and matches signatures
            against a lab-confirmed GPR+XRF reference database — revealing
            position, depth, size, and predicted material without excavation.
          </p>

          <div className="mt-9 flex items-center justify-center gap-4">
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-stone-900 text-white font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
            >
              <GoogleIcon className="w-4.5 h-4.5" />
              Sign in with Google
            </button>
            <a
              href="#features"
              className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl text-stone-700 font-medium hover:text-stone-900 transition-colors"
            >
              Learn more
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>

        {/* Flow strip */}
        <section id="pipeline" className="bg-[#F7F3D0] border-y border-[#E8DFA0] py-10">
          <div className="max-w-6xl mx-auto px-6">
            <p className="text-center text-xs font-semibold tracking-widest text-stone-500 uppercase mb-6">
              Research Pipeline
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {FLOW_STEPS.map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="px-4 py-2 rounded-full bg-white border border-[#E8DFA0] text-sm font-medium text-stone-700 shadow-sm">
                    {step}
                  </span>
                  {i < FLOW_STEPS.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
            {STATS.map((s) => (
              <div key={s.label}>
                <p className="text-3xl font-bold text-emerald-700">{s.value}</p>
                <p className="mt-1 text-sm text-stone-500">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-6 pb-20">
          <h2 className="text-2xl font-bold text-center text-stone-900 mb-10">
            Built for non-destructive archaeological survey
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="p-6 rounded-2xl bg-white border border-[#F0E9B8] shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-stone-900 mb-1.5">{title}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#F0E9B8] py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <span>© {new Date().getFullYear()} AiG — AI-GPR Research Platform</span>
          <span>Built for PhD archaeological research</span>
        </div>
      </footer>
    </div>
  )
}

function GoogleIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.69-2.26 1.1-3.71 1.1-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.14c-.22-.69-.35-1.42-.35-2.14s.13-1.45.35-2.14V7.02H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.98l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.02l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
