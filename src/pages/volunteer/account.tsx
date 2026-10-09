import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/ui'
import { Checkbox, TextInput } from '@/components/ui/form'
import { toast } from '@/components/ui/Toast'
import { fmtDateTime } from '@/lib/format'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { NotificationRow } from '@/types/db'
import { passwordRule } from '../public/Register'

export function Notifications() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: async () => unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as NotificationRow[] })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['notifications'] }) }
  const markAll = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); if (error) throw new Error(error.message) },
    onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)),
  })
  const open = async (n: NotificationRow) => {
    if (!n.read_at) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); refresh() }
    if (n.link) nav(n.link)
  }
  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorState error={q.error} />
  return (
    <div>
      <PageHeader title="Notifications" actions={<Button variant="secondary" onClick={() => markAll.mutate()} disabled={!q.data?.some((n) => !n.read_at)}>Mark all as read</Button>} />
      <Card padded={false}>
        {q.data?.length === 0 ? <EmptyState title="No notifications" /> : (
          <ul className="divide-y divide-line">
            {q.data?.map((n) => (
              <li key={n.id}>
                <button onClick={() => open(n)} className={`flex w-full items-start gap-3 p-4 text-left hover:bg-prc-50 ${n.read_at ? '' : 'bg-prc-50/60'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-prc-600'}`} aria-label={n.read_at ? 'Read' : 'Unread'} />
                  <span className="flex-1"><span className="block text-sm font-medium">{n.title}</span>{n.body && <span className="block text-sm text-muted">{n.body}</span>}<span className="mt-1 block text-xs text-muted">{fmtDateTime(n.created_at)}</span></span>
                </button>
              </li>))}
          </ul>)}
      </Card>
    </div>
  )
}

const CATEGORIES: [string, string][] = [['assignments', 'Assignment offers and changes'], ['preferences', 'Preference updates'], ['documents', 'Document reviews'], ['allowances', 'Allowance status'], ['cpd', 'CPD records'], ['announcements', 'Announcements']]
const pwSchema = z.object({ password: passwordRule, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

export function AccountSettings() {
  const { profile, session } = useAuth()
  const qc = useQueryClient()
  const prefs = useQuery({ queryKey: ['notif-prefs'], queryFn: async () => unwrap(await supabase.from('notification_preferences').select('*')) as { category: string; in_app: boolean; email: boolean }[] })
  const toggle = useMutation({
    mutationFn: async (v: { category: string; in_app: boolean }) => { unwrap(await supabase.from('notification_preferences').upsert({ user_id: session!.user.id, category: v.category, in_app: v.in_app }).select('category').single()) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-prefs'] }), onError: (e) => toast.error(errorMessage(e)),
  })
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) })
  const changePw = async (v: z.infer<typeof pwSchema>) => {
    const { error } = await supabase.auth.updateUser({ password: v.password })
    if (error) toast.error(error.message); else { toast.success('Password updated'); reset() }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Account Settings" />
      <Card title="Account"><dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted">Email</dt><dd>{profile?.email}</dd></div>
        <div><dt className="text-xs text-muted">Status</dt><dd className="capitalize">{profile?.account_status}</dd></div>
        <div><dt className="text-xs text-muted">Terms acknowledged</dt><dd>{fmtDateTime(profile?.terms_accepted_at)}</dd></div></dl></Card>
      <Card title="Change password">
        <form onSubmit={handleSubmit(changePw)} noValidate className="grid max-w-xl gap-4 sm:grid-cols-2">
          <TextInput label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <TextInput label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
          <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting}>Update password</Button></div>
        </form>
      </Card>
      <Card title="Notification preferences">
        <Alert tone="info">In-app notifications are always available. Email delivery requires an email provider to be configured by PRC; until then, only in-app notifications are sent.</Alert>
        <div className="mt-4 space-y-3">
          {CATEGORIES.map(([key, label]) => {
            const p = prefs.data?.find((x) => x.category === key)
            return <Checkbox key={key} label={label} checked={p ? p.in_app : true} onChange={(e) => toggle.mutate({ category: key, in_app: e.target.checked })} />
          })}
        </div>
      </Card>
    </div>
  )
}
