import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

type ToastItem = { id: number; kind: 'success' | 'error'; text: string }
type Listener = (t: ToastItem) => void
const listeners = new Set<Listener>()
let seq = 0

function push(kind: ToastItem['kind'], text: string) {
  const t = { id: ++seq, kind, text }
  listeners.forEach((l) => l(t))
}

export const toast = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    const l: Listener = (t) => {
      setItems((x) => [...x, t])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.kind === 'error' ? 8000 : 4000)
    }
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return (
    <div className="no-print fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-md border bg-white p-3 text-sm shadow-lg ${t.kind === 'error' ? 'border-red-300' : 'border-emerald-300'}`}>
          {t.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
          <span className="break-words">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
