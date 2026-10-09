import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Spinner } from '@/components/ui/ui'
import { useAuth } from './AuthProvider'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner label="Checking your session…" />
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(loc.pathname)}`} replace />
  if (!profile) return <Spinner label="Loading your account…" />
  if (!profile.email_verified_at) return <Navigate to="/verify-email" replace />
  if (profile.account_status === 'suspended' || profile.account_status === 'rejected') return <Navigate to="/account-blocked" replace />
  return <>{children}</>
}

export function AccessDenied() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-navy-900">Access denied</h1>
      <p className="mt-2 text-sm text-muted">Your account does not have permission to open this page. If you believe this is a mistake, contact your PRC administrator.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-prc-600 hover:underline">Back to my dashboard</Link>
    </div>
  )
}

/** Route guard: the user needs at least one of `any`. Real enforcement is in the database (RLS). */
export function RequirePermission({ any, children }: { any: string[]; children: ReactNode }) {
  const { canAny } = useAuth()
  return canAny(any) ? <>{children}</> : <AccessDenied />
}
