import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Alert, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Spinner, StatCard, StatusBadge } from '@/components/ui/ui'
import { useAuth } from '@/auth/AuthProvider'
import { useMyVolunteer } from '@/hooks/useMyVolunteer'
import { fmtDate, fmtTime, peso } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'
import type { AllowanceRow, NotificationRow, RosterRow } from '@/types/db'
import { useCompleteness } from './profile'
import { useMyPreferences } from './opportunities'

export function VolunteerDashboard() {
  const { profile } = useAuth()
  const { data: vol } = useMyVolunteer()
  const comp = useCompleteness()
  const prefs = useMyPreferences()
  const open = useQuery({ queryKey: ['open-count'], queryFn: async () => (await supabase.from('examination_events').select('id', { count: 'exact', head: true }).eq('status', 'open_for_registration')).count ?? 0 })
  const asg = useQuery({ queryKey: ['assignments-home'], queryFn: async () => unwrap(await supabase.from('assignment_roster').select('*').in('status', ['awaiting_volunteer_confirmation', 'confirmed']).order('exam_date')) as RosterRow[] })
  const allowances = useQuery({ queryKey: ['my-allowances'], queryFn: async () => unwrap(await supabase.rpc('my_allowances')) as AllowanceRow[] })
  const cpd = useQuery({ queryKey: ['my-cpd-totals'], enabled: !!vol, queryFn: async () => unwrap(await supabase.from('cpd_volunteer_totals').select('*').eq('volunteer_id', vol!.id).maybeSingle()) as { approved_units: number; pending_units: number } | null })
  const notes = useQuery({ queryKey: ['notifications', 'recent'], queryFn: async () => unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5)) as NotificationRow[] })

  if (!vol) return <Spinner />
  if (asg.isError) return <ErrorState error={asg.error} />
  const pending = asg.data?.filter((a) => a.status === 'awaiting_volunteer_confirmation') ?? []
  const upcoming = asg.data?.filter((a) => a.status === 'confirmed') ?? []
  const outstanding = allowances.data?.reduce((s, r) => s + (r.processing_status === 'disapproved' ? 0 : Number(r.balance)), 0) ?? 0
  return (
    <div className="space-y-5">
      <PageHeader title={`Welcome${vol.first_name ? `, ${vol.preferred_name || vol.first_name}` : ''}`} description={`Volunteer ID ${vol.volunteer_no}`} />
      {pending.length > 0 && <Alert tone="warning" title={`${pending.length} assignment offer(s) awaiting your confirmation`}><Link className="underline" to="/assignments">Review offers</Link></Alert>}
      {comp.data && comp.data.percent < 100 && (
        <Card title="Complete your profile" actions={<Link className="text-sm text-prc-600 hover:underline" to="/profile">Continue</Link>}>
          <ProgressBar percent={comp.data.percent} /><p className="mt-2 text-xs text-muted">Still needed: {comp.data.missing.slice(0, 4).join(', ')}{comp.data.missing.length > 4 ? '…' : ''}</p></Card>)}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Account" value={<span className="capitalize">{profile?.account_status}</span>} hint={<>Profile: <StatusBadge status={vol.verification_status} /></>} />
        <StatCard label="Open examinations" value={open.data ?? '—'} hint={<Link className="text-prc-600" to="/opportunities">Browse</Link>} />
        <StatCard label="Preferences pending" value={prefs.data?.filter((p) => p.status === 'pending').length ?? '—'} hint={<Link className="text-prc-600" to="/preferences">View</Link>} />
        <StatCard label="Confirmed assignments" value={upcoming.length} hint={<Link className="text-prc-600" to="/assignments">View</Link>} />
        <StatCard label="Allowance outstanding" value={peso(outstanding)} hint={<Link className="text-prc-600" to="/allowances">Details</Link>} />
        <StatCard label="CPD units (this portal)" value={Number(cpd.data?.approved_units ?? 0)} hint={`${Number(cpd.data?.pending_units ?? 0)} pending review`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Upcoming reporting schedule">
          {upcoming.length === 0 ? <EmptyState title="No confirmed assignments yet" /> : (
            <ul className="divide-y divide-line text-sm">{upcoming.slice(0, 5).map((a) => <li key={a.id} className="py-2"><Link className="font-medium text-navy-800 hover:underline" to={`/assignments/${a.id}`}>{a.event_name}</Link>
              <p className="text-xs text-muted">{fmtDate(a.exam_date)} · report {fmtTime(a.report_time)} · {a.position_name} · {a.center_name}</p></li>)}</ul>)}
        </Card>
        <Card title="Recent notifications" actions={<Link className="text-sm text-prc-600 hover:underline" to="/notifications">All</Link>}>
          {notes.data?.length === 0 ? <EmptyState title="Nothing new" /> : <ul className="divide-y divide-line text-sm">{notes.data?.map((n) => <li key={n.id} className="py-2"><p className={n.read_at ? '' : 'font-medium'}>{n.title}</p><p className="text-xs text-muted">{n.body}</p></li>)}</ul>}
        </Card>
      </div>
    </div>
  )
}
