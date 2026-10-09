import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui/ui'
import { fmtDate, peso } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'

/* eslint-disable @typescript-eslint/no-explicit-any */
const C = { confirmed: '#1560bd', awaiting: '#e0a526', vacant: '#c2c9d4', paid: '#1560bd', approved: '#5b8fd1' }

export function ManagementDashboard() {
  const q = useQuery({ queryKey: ['mgmt-dashboard'], queryFn: async () => unwrap(await supabase.rpc('management_dashboard')) as any })
  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />
  const d = q.data
  const s = d.staffing ?? {}
  const staffData = [{ name: 'All upcoming examinations', Confirmed: s.confirmed ?? 0, 'Awaiting confirmation': Math.max((s.assigned ?? 0) - (s.confirmed ?? 0), 0), Vacant: s.vacant ?? 0 }]
  const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`)
  return (
    <div className="space-y-5">
      <PageHeader title="Management Dashboard" description="Live figures calculated from portal records." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Registered volunteers" value={d.volunteers_total} hint={`${d.volunteers_active} active`} />
        <StatCard label="Verified volunteers" value={d.volunteers_verified} />
        <StatCard label="Pending verification" value={d.volunteers_pending_verification} tone={d.volunteers_pending_verification ? 'warning' : 'neutral'} />
        <StatCard label="Available for upcoming exams" value={d.volunteers_available} />
        <StatCard label="Upcoming examinations" value={d.events_upcoming} />
        <StatCard label="Confirmation rate" value={pct(d.confirmation_rate)} hint="Accepted vs. offered" />
        <StatCard label="Attendance verified" value={pct(d.attendance_completion_rate)} hint="Past duty days" />
        <StatCard label="Absences / substitutions" value={`${d.absences} / ${d.substitutions}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Staffing — required vs. assigned">
          <p className="mb-2 text-sm text-muted">Required {s.required ?? 0} · Assigned {s.assigned ?? 0} · Confirmed {s.confirmed ?? 0} · Vacant {s.vacant ?? 0}</p>
          <div className="h-32" role="img" aria-label={`Staffing: ${s.confirmed ?? 0} confirmed, ${s.awaiting ?? 0} awaiting confirmation, ${s.vacant ?? 0} vacant`}>
            <ResponsiveContainer><BarChart layout="vertical" data={staffData} margin={{ left: 10, right: 10 }}>
              <CartesianGrid horizontal={false} stroke="#e5e9f0" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" hide />
              <Tooltip /><Legend />
              <Bar dataKey="Confirmed" stackId="a" fill={C.confirmed} /><Bar dataKey="Awaiting confirmation" stackId="a" fill={C.awaiting} /><Bar dataKey="Vacant" stackId="a" fill={C.vacant} />
            </BarChart></ResponsiveContainer>
          </div>
        </Card>
        <Card title="Examinations requiring staffing action" padded={false}>
          {d.needs_staffing.length === 0 ? <EmptyState title="No vacancies in upcoming examinations" /> : (
            <table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-muted"><tr><th className="px-3 py-2 text-left">Examination</th><th className="px-3 py-2">Starts</th><th className="px-3 py-2">Required</th><th className="px-3 py-2">Assigned</th><th className="px-3 py-2">Vacant</th></tr></thead>
              <tbody className="divide-y divide-line">{d.needs_staffing.map((e: any) => (
                <tr key={e.id}><td className="px-3 py-2"><Link className="text-navy-800 hover:underline" to={`/admin/events/${e.id}`}>{e.name}</Link></td><td className="px-3 py-2 text-center">{fmtDate(e.start_date)}</td>
                  <td className="px-3 py-2 text-center">{e.required}</td><td className="px-3 py-2 text-center">{e.assigned}</td><td className="px-3 py-2 text-center font-semibold text-red-700">{e.vacant}</td></tr>))}</tbody></table>)}
        </Card>
      </div>

      {d.allowance && (
        <Card title="Allowance processing" actions={<Link className="text-sm text-prc-600 hover:underline" to="/admin/allowances">Open</Link>}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Eligible personnel" value={d.allowance.eligible_personnel} /><StatCard label="Pending validation" value={d.allowance.pending_validation} />
            <StatCard label="Awaiting approval" value={d.allowance.awaiting_approval} /><StatCard label="Approved amount" value={peso(d.allowance.approved_amount)} />
            <StatCard label="Total paid" value={peso(d.allowance.total_paid)} /><StatCard label="Outstanding" value={peso(d.allowance.outstanding)} />
          </div>
        </Card>)}
      {d.cpd && (
        <Card title="CPD approvals (units recorded by this portal)" actions={<Link className="text-sm text-prc-600 hover:underline" to="/admin/cpd">Open</Link>}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Eligible professionals" value={d.cpd.eligible_professionals} /><StatCard label="Qualifying days" value={d.cpd.qualifying_days} />
            <StatCard label="Units approved" value={Number(d.cpd.units_approved)} /><StatCard label="Units pending" value={Number(d.cpd.units_pending)} />
            <StatCard label="For review" value={d.cpd.for_review + d.cpd.pending_approval} tone={d.cpd.for_review ? 'warning' : 'neutral'} /><StatCard label="Flagged" value={d.cpd.flagged} tone={d.cpd.flagged ? 'danger' : 'neutral'} />
          </div>
        </Card>)}
    </div>
  )
}

export { C as CHART_COLORS }
