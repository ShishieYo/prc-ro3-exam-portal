import clsx from 'clsx'
import { useState, type ReactNode } from 'react'

export function Tabs({ tabs, initial }: { tabs: { id: string; label: string; badge?: ReactNode; content: ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0].id)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current.id} onClick={() => setActive(t.id)}
            className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', t.id === current.id ? 'border-prc-600 text-navy-900' : 'border-transparent text-muted hover:text-ink')}>
            {t.label} {t.badge}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current.content}</div>
    </div>
  )
}
