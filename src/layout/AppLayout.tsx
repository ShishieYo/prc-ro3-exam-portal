import { useQuery } from '@tanstack/react-query'
import { Bell, ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthProvider'
import { Alert } from '@/components/ui/ui'
import { useMyVolunteer } from '@/hooks/useMyVolunteer'
import { supabase } from '@/lib/supabase'
import { CRUMBS, NAV } from './nav'
import { Brand } from './Brand'

export function AppLayout() {
  const { profile, canAny, signOut, isStaff, session } = useAuth()
  const { data: vol } = useMyVolunteer()
  const loc = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => setMobileOpen(false), [loc.pathname])

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    enabled: !!session,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })

  const showVolunteer = !isStaff || !!vol?.last_name
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (g.volunteer ? showVolunteer : i.any ? canAny(i.any) : true)),
  })).filter((g) => g.items.length > 0)

  const parts = loc.pathname.split('/').filter(Boolean)
  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
      {groups.map((g) => (
        <div key={g.title}>
          {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-prc-100/70">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} end={i.end} title={collapsed ? i.label : undefined}
                  className={({ isActive }) => clsx('flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-white/15 font-medium text-white' : 'text-prc-100 hover:bg-white/10')}>
                  <i.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{i.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen">
      <aside className={clsx('no-print sticky top-0 hidden h-screen flex-col bg-navy-900 text-white md:flex', collapsed ? 'w-16' : 'w-64')}>
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-3">
          {!collapsed && <Brand light compact />}
          <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="rounded p-1 hover:bg-white/10">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        {nav}
      </aside>

      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-navy-900 text-white">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-3">
              <Brand light compact />
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="rounded p-1 hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-4 py-2.5">
          <button className="rounded p-1.5 hover:bg-slate-100 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1 truncate text-sm text-muted">
            <Link to="/" className="hover:text-ink">Home</Link>
            {parts.map((p, i) => (
              <Fragment key={i}>
                <span className="mx-1.5">/</span>
                <span className={i === parts.length - 1 ? 'text-ink' : ''}>{CRUMBS[p] ?? (p.length > 12 ? '…' : p)}</span>
              </Fragment>
            ))}
          </nav>
          <Link to="/notifications" className="relative rounded p-2 hover:bg-slate-100" aria-label={`Notifications${unread.data ? `, ${unread.data} unread` : ''}`}>
            <Bell className="h-5 w-5" />
            {!!unread.data && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold text-white">{unread.data > 99 ? '99+' : unread.data}</span>}
          </Link>
          <div className="hidden text-right text-xs leading-tight sm:block">
            <p className="font-medium text-ink">{profile?.email}</p>
            <p className="text-muted">{isStaff ? 'PRC personnel' : 'Volunteer'}</p>
          </div>
          <button onClick={() => signOut()} className="rounded p-2 text-muted hover:bg-slate-100" aria-label="Sign out" title="Sign out"><LogOut className="h-5 w-5" /></button>
        </header>
        <main className="flex-1 p-4 md:p-6">
          {profile?.account_status === 'pending' && (
            <div className="mb-4"><Alert tone="warning" title="Account awaiting PRC approval">You can complete your profile and upload documents now. You can submit examination preferences once PRC approves your account.</Alert></div>
          )}
          <Outlet />
        </main>
        <footer className="no-print border-t border-line px-4 py-3 text-center text-xs text-muted">
          PRC Regional Office III — Licensure Examination Personnel Portal · For authorised use only. Activity is logged.
        </footer>
      </div>
    </div>
  )
}
