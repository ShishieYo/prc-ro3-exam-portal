import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Alert, Button } from '@/components/ui/ui'
import { TextInput } from '@/components/ui/form'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'

const schema = z.object({ email: z.string().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') })
type Values = z.infer<typeof schema>

export function SignIn() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = async (v: Values) => {
    setError(null)
    const { error } = await supabase.auth.signInWithPassword(v)
    if (error) {
      setError(/not confirmed/i.test(error.message) ? 'Please verify your email address first. Check your inbox for the confirmation link.' : 'Invalid email or password.')
      return
    }
    const next = params.get('next')
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true })
  }

  return (
    <AuthShell title="Sign in" subtitle="Use the email address you registered with."
      footer={<>New volunteer? <Link to="/register" className="font-medium text-prc-600 hover:underline">Create an account</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextInput label="Email address" type="email" autoComplete="email" required error={errors.email?.message} {...register('email')} />
        <TextInput label="Password" type="password" autoComplete="current-password" required error={errors.password?.message} {...register('password')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Sign in</Button>
        <p className="text-center text-sm"><Link to="/forgot-password" className="text-prc-600 hover:underline">Forgot your password?</Link></p>
      </form>
    </AuthShell>
  )
}
