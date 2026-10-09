import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, unwrap } from '@/lib/supabase'

export interface AccountProfile {
  id: string
  email: string
  account_status: 'pending' | 'active' | 'suspended' | 'rejected'
  email_verified_at: string | null
  terms_accepted_at: string | null
}

interface AuthState {
  loading: boolean
  session: Session | null
  profile: AccountProfile | null
  permissions: string[]
  can: (p: string) => boolean
  canAny: (ps: string[]) => boolean
  isStaff: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setPermissions([]); return }
    const [p, perms] = await Promise.all([
      supabase.from('profiles').select('id,email,account_status,email_verified_at,terms_accepted_at').eq('id', s.user.id).single(),
      supabase.rpc('my_permissions'),
    ])
    setProfile(unwrap(p) as AccountProfile)
    setPermissions((unwrap(perms) as string[]) ?? [])
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      try { await load(data.session) } finally { if (alive) setLoading(false) }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // defer: calling supabase inside the callback can deadlock the auth lock
      setTimeout(() => { load(s).catch(() => undefined) }, 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [load])

  const value = useMemo<AuthState>(() => ({
    loading, session, profile, permissions,
    can: (p) => permissions.includes(p),
    canAny: (ps) => ps.some((p) => permissions.includes(p)),
    isStaff: permissions.length > 0,
    refresh: () => load(session),
    signOut: async () => { await supabase.auth.signOut() },
  }), [loading, session, profile, permissions, load])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
