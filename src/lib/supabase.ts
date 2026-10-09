import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

// Only the public URL and anon key are used in the browser. Never put a service-role key here.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing', {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Throw on error so callers (React Query) surface failures instead of silently continuing. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** Friendly message for database-raised errors (strips internal prefixes). */
export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/row-level security|permission denied/i.test(m)) return 'You are not authorised to perform this action.'
  if (/duplicate key/i.test(m)) return 'A matching record already exists.'
  return m
}
