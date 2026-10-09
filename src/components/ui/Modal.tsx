import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui'
import { TextArea } from './form'

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-lg bg-white shadow-xl`}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

/** Confirmation for consequential actions; optionally collects a mandatory reason. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, requireReason, reasonLabel = 'Reason', onConfirm, onClose }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; requireReason?: boolean; reasonLabel?: string
  onConfirm: (reason: string) => Promise<unknown> | unknown; onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setReason('') }, [open])
  const submit = async () => {
    setBusy(true)
    try { await onConfirm(reason.trim()); onClose() } catch { /* the caller reports the error; keep the dialog open */ } finally { setBusy(false) }
  }
  return (
    <Modal open={open} title={title} onClose={onClose} footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={requireReason && !reason.trim()} onClick={submit}>{confirmLabel}</Button>
      </>}>
      <div className="space-y-3 text-sm text-ink">
        <div>{message}</div>
        {requireReason && <TextArea label={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} required />}
      </div>
    </Modal>
  )
}
