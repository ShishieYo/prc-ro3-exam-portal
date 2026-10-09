import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Alert, Button } from '@/components/ui/ui'
import { Checkbox, TextInput } from '@/components/ui/form'
import { supabase } from '@/lib/supabase'
import { AuthShell } from './AuthShell'

export const passwordRule = z.string()
  .min(10, 'Use at least 10 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number')

const schema = z.object({
  first_name: z.string().trim().min(1, 'Required'),
  last_name: z.string().trim().min(1, 'Required'),
  email: z.string().email('Enter a valid email address'),
  password: passwordRule,
  confirm: z.string(),
  terms: z.literal(true, { error: 'You must acknowledge the Privacy Notice and Terms to register' }),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
type Values = z.infer<typeof schema>

export function Register() {
  const nav = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = async (v: Values) => {
    setError(null)
    const { error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}sign-in`,
        // The role is never taken from this metadata; the database assigns the volunteer role.
        data: { first_name: v.first_name, last_name: v.last_name, terms_accepted: true },
      },
    })
    if (error) { setError(error.message); return }
    nav(`/verify-email?email=${encodeURIComponent(v.email)}`, { replace: true })
  }

  return (
    <AuthShell title="Register as volunteer" subtitle="Create your account first. You will complete your profile after verifying your email."
      footer={<>Already registered? <Link to="/sign-in" className="font-medium text-prc-600 hover:underline">Sign in</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="First name" autoComplete="given-name" required error={errors.first_name?.message} {...register('first_name')} />
          <TextInput label="Last name" autoComplete="family-name" required error={errors.last_name?.message} {...register('last_name')} />
        </div>
        <TextInput label="Email address" type="email" autoComplete="email" required error={errors.email?.message} {...register('email')} />
        <TextInput label="Password" type="password" autoComplete="new-password" required hint="At least 10 characters with upper and lower case letters and a number." error={errors.password?.message} {...register('password')} />
        <TextInput label="Confirm password" type="password" autoComplete="new-password" required error={errors.confirm?.message} {...register('confirm')} />
        <div>
          <Checkbox label={<>I have read and acknowledge the <Link to="/privacy" target="_blank" className="font-medium text-prc-600 underline">Privacy Notice and Terms</Link>.</>} {...register('terms')} />
          {errors.terms && <p className="mt-1 text-xs text-red-700">{errors.terms.message}</p>}
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  )
}
