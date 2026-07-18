// AiG — Navbar.jsx  (LOCKED SPEC §6ao — pastel/gold theme)
// Fixed top bar: AiG logo (left) · current scan filename (centre) · user + sign-out (right)
import { useLocation } from 'react-router-dom'
import { LogOut, FileText, Menu } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

function initials(email) {
  if (!email) return '?'
  const name = email.split('@')[0]
  return name.slice(0, 2).toUpperCase()
}

export default function Navbar({ onMenuClick = () => {} }) {
  const { user, isGuest, signOut } = useAuth()
  const location = useLocation()
  const filename = location.state?.filename ?? null

  return (
    <header
      className="fixed top-0 left-0 right-0 h-14 z-40 flex items-center justify-between px-4
                 bg-[#FDFBF0] border-b border-[#F0E9B8]"
    >
      {/* Left — hamburger (mobile only) + logo */}
      <div className="flex items-center gap-2 shrink-0 lg:w-56">
        <button
          onClick={onMenuClick}
          className="lg:hidden -ml-1 p-1.5 rounded-lg text-stone-600 hover:bg-[#F0E9B8]"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-700 text-white font-bold text-sm">
          AiG
        </span>
        <span className="font-semibold text-stone-800 tracking-tight hidden sm:inline">
          AI-GPR
        </span>
      </div>

      {/* Centre — current scan */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F7F3D0] border border-[#E8DFA0] max-w-full">
          <FileText className="w-3.5 h-3.5 text-[#C9971A] shrink-0" />
          <span className="text-xs font-medium text-stone-600 truncate">
            {filename || 'No scan loaded'}
          </span>
        </div>
      </div>

      {/* Right — user + sign out */}
      <div className="flex items-center gap-3 justify-end w-56 shrink-0">
        {isGuest && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full hidden sm:inline">
            Guest
          </span>
        )}
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#C9971A] text-white text-xs font-bold"
            title={user?.email ?? ''}
          >
            {isGuest ? 'G' : initials(user?.email)}
          </span>
          <span className="text-xs text-stone-500 max-w-[140px] truncate hidden md:inline">
            {user?.email ?? ''}
          </span>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     text-stone-600 hover:text-white hover:bg-[#C9971A] border border-[#E8DFA0]
                     transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  )
}
