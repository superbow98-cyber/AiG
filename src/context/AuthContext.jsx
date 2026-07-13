import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ensureProfile } from '../lib/db'

const AuthContext = createContext({})

// Guest / demo mode — lets researchers explore the full analysis pipeline
// (upload demo scan → preprocess → visualise → detect → classify → cluster)
// without configuring Supabase or signing in. Cloud-DB features (saving scans
// and GPR+XRF records) are disabled for guests and fail gracefully.
const GUEST_KEY = 'aig_guest_mode'
const GUEST_USER = {
  id: 'guest',
  email: 'guest@aig.local',
  user_metadata: { full_name: 'Guest Researcher' },
  isGuest: true,
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [isGuest, setIsGuest] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Restore an existing Supabase session, or fall back to guest mode.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return
        if (session) {
          setSession(session)
          setUser(session.user)
          setIsGuest(false)
          ensureProfile(session.user)
        } else if (localStorage.getItem(GUEST_KEY) === '1') {
          setUser(GUEST_USER)
          setIsGuest(true)
        }
        setLoading(false)
      })
      .catch(() => {
        // Supabase not reachable / not configured — still allow guest mode.
        if (!mounted) return
        if (localStorage.getItem(GUEST_KEY) === '1') {
          setUser(GUEST_USER)
          setIsGuest(true)
        }
        setLoading(false)
      })

    // React to real auth changes (Google login / logout / token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          localStorage.removeItem(GUEST_KEY)
          setSession(session)
          setUser(session.user)
          setIsGuest(false)
          ensureProfile(session.user)
        } else if (localStorage.getItem(GUEST_KEY) === '1') {
          setSession(null)
          setUser(GUEST_USER)
          setIsGuest(true)
        } else {
          setSession(null)
          setUser(null)
          setIsGuest(false)
        }
        setLoading(false)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = () => {
    localStorage.removeItem(GUEST_KEY)
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard',
      },
    })
  }

  const signInAsGuest = () => {
    localStorage.setItem(GUEST_KEY, '1')
    setUser(GUEST_USER)
    setIsGuest(true)
    setSession(null)
    setLoading(false)
  }

  const signOut = async () => {
    localStorage.removeItem(GUEST_KEY)
    setIsGuest(false)
    setUser(null)
    setSession(null)
    try {
      await supabase.auth.signOut()
    } catch (_) {
      // ignore — guest sign-out has no Supabase session to clear
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, session, isGuest, loading, signInWithGoogle, signInAsGuest, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
