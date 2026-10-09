import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, Button } from '@/components/ui/ui'
import { TextInput } from '@/components/ui/form'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'
import { passwordRule } from './Register'

export function VerifyEmail() {
  const { profile, signOut, refresh } = useAuth()
  const [params] = useSearchParams()
  const email = params.get('email') ?? profile?.email ?? ''
  const [msg, setMsg] = useState<string | null>(null)
  const resend = async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}sign-in` } })
    setMsg(error ? error.message : 'A new verification email has been requested. Delivery depends on the configured email provider.')
  }
  return (
    <AuthShell title="Verify your email address">
      <div className="space-y-4 text-sm">
        <MailCheck className="h-8 w-8 text-prc-600" aria-hidden />
        <p>We sent a confirmation link to <strong>{email || 'your email address'}</strong>. Open the link to activate sign-in, then return here.</p>
        {msg && <Alert tone="info">{msg}</Alert>}
        <div className="flex flex-wrap gap-2">
          {email && <Button variant="secondary" onClick={resend}>Resend email</Button>}
          {profile && <Button variant="secondary" onClick={() => refresh()}>I have verified</Button>}
          {profile ? <Button variant="ghost" onClick={() => signOut()}>Sign out</Button> : <Link to="/sign-in" className="px-3 py-2 text-sm font-medium text-prc-600 hover:underline">Go to sign in</Link>}
        </div>
      </div>
    </AuthShell>
  )
}

export function AccountBlocked() {
  const { profile, signOut } = useAuth()
  return (
    <AuthShell title={profile?.account_status === 'rejected' ? 'Registration not approved' : 'Account suspended'}>
      <p className="text-sm text-muted">Your account cannot be used at this time. Please contact PRC Regional Office III for assistance.</p>
      <Button className="mt-4" variant="secondary" onClick={() => signOut()}>Sign out</Button>
    </AuthShell>
  )
}

const emailSchema = z.object({ email: z.string().email('Enter a valid email address') })
export function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(emailSchema) })
  const onSubmit = async ({ email }: { email: string }) => {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}reset-password` })
    setSent(true) // same response whether or not the account exists
  }
  return (
    <AuthShell title="Reset your password" footer={<Link to="/sign-in" className="font-medium text-prc-600 hover:underline">Back to sign in</Link>}>
      {sent ? <Alert tone="success">If an account exists for that address, a password reset link has been sent.</Alert> : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <TextInput label="Email address" type="email" required error={errors.email?.message} {...register('email')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  )
}

const resetSchema = z.object({ password: passwordRule, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
export function ResetPassword() {
  const nav = useNavigate()
  const { session, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) })
  const onSubmit = async (v: z.infer<typeof resetSchema>) => {
    const { error } = await supabase.auth.updateUser({ password: v.password })
    if (error) { setError(error.message); return }
    nav('/', { replace: true })
  }
  return (
    <AuthShell title="Choose a new password">
      {!loading && !session ? <Alert tone="warning">This reset link is invalid or has expired. <Link to="/forgot-password" className="underline">Request a new one.</Link></Alert> : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextInput label="New password" type="password" autoComplete="new-password" required error={errors.password?.message} {...register('password')} />
          <TextInput label="Confirm new password" type="password" autoComplete="new-password" required error={errors.confirm?.message} {...register('confirm')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Update password</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ConfigError() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold text-navy-900">Portal is not configured</h1>
      <p className="mt-3 text-sm text-muted">The Supabase connection settings are missing. Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server (or rebuild). See <code>docs/SETUP.md</code>.</p>
    </div>
  )
}
