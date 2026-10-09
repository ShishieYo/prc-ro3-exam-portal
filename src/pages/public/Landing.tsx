import { CalendarCheck, ClipboardCheck, Lock, Users, Wallet, Award } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from '@/layout/Brand'
import { useAuth } from '@/auth/AuthProvider'

const STAGES = ['Registration', 'Verification', 'Preference', 'Assignment', 'Confirmation', 'Deployment', 'Attendance', 'Allowance', 'CPD']

export function Landing() {
  const { session } = useAuth()
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Brand />
          <div className="flex gap-2">
            {session ? <Link to="/" className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700">Open portal</Link> : (
              <>
                <Link to="/sign-in" className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-prc-50">Sign in</Link>
                <Link to="/register" className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700">Register as volunteer</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="bg-navy-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-sm font-medium uppercase tracking-widest text-prc-100">Professional Regulation Commission · Regional Office III</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">Licensure Examination Personnel Portal</h1>
          <p className="mt-2 text-lg text-prc-100">One Portal. Organized Examination Operations.</p>
          <p className="mt-5 max-w-2xl text-prc-100">
            Register as a volunteer examination personnel, tell us which licensure examinations you can serve, and track your assignments,
            attendance, allowance processing and CPD participation records in one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-navy-900 hover:bg-prc-50">Register as volunteer</Link>
            <Link to="/sign-in" className="rounded-md border border-white/40 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Sign in</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-lg font-semibold text-navy-900">What you can do</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Users, 'Maintain your profile', 'Keep personal, professional and employment information current, and upload supporting documents securely.'],
            [CalendarCheck, 'Choose examinations', 'Browse upcoming licensure examinations, declare your availability and submit preferences for PRC review.'],
            [ClipboardCheck, 'Confirm assignments', 'Receive assignment offers with reporting details, accept or decline, and download your assignment notice.'],
            [Wallet, 'Monitor allowances', 'See the processing and payment status of your allowance for each verified duty day.'],
            [Award, 'Track CPD records', 'View CPD units recorded by this portal from verified participation, subject to PRC approval.'],
            [Lock, 'Protected data', 'Access is role-based and audited. Financial details are masked and visible only to authorised personnel.'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Users
            return (
              <div key={t as string} className="rounded-lg border border-line p-4">
                <I className="h-5 w-5 text-prc-600" aria-hidden />
                <h3 className="mt-2 text-sm font-semibold text-navy-900">{t as string}</h3>
                <p className="mt-1 text-sm text-muted">{d as string}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="text-lg font-semibold text-navy-900">Every step is traceable</h2>
          <ol className="mt-4 flex flex-wrap gap-2 text-sm">
            {STAGES.map((s, i) => <li key={s} className="rounded-full bg-white px-3 py-1 ring-1 ring-line"><span className="mr-1.5 text-prc-600">{i + 1}.</span>{s}</li>)}
          </ol>
          <p className="mt-6 max-w-3xl text-sm text-muted">
            Submitting a preference is not an assignment. Assignments are made by authorised PRC personnel and are confirmed only after you accept the offer.
            CPD units shown in this portal are recorded from verified participation and are not your complete PRC CPD balance.
          </p>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
        <Link to="/privacy" className="font-medium text-prc-600 hover:underline">Privacy Notice & Terms</Link>
        <span className="mx-2">·</span>
        For authorised use only. This internal portal does not imply endorsement beyond its intended use.
      </footer>
    </div>
  )
}
