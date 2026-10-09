import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '@/layout/Brand'

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-line bg-white px-4 py-3"><Link to="/" className="inline-block"><Brand /></Link></header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
          {footer && <div className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
