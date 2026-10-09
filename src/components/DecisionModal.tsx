import { useState } from 'react'
import { Button } from '@/components/ui/ui'
import { SelectInput, TextArea } from '@/components/ui/form'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { errorMessage } from '@/lib/supabase'

export interface DecisionOption { value: string; label: string; reasonRequired?: boolean }

/** Review decision with a reason that becomes mandatory for adverse outcomes. */
export function DecisionModal({ title, options, children, onSubmit, onClose }: {
  title: string; options: DecisionOption[]; children?: React.ReactNode
  onSubmit: (decision: string, reason: string) => Promise<unknown>; onClose: () => void
}) {
  const [decision, setDecision] = useState(options[0].value)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const opt = options.find((o) => o.value === decision)!
  const go = async () => {
    setBusy(true)
    try { await onSubmit(decision, reason.trim()); onClose() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open title={title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={opt.reasonRequired && !reason.trim()} onClick={go}>Submit decision</Button></>}>
      <div className="space-y-4">
        {children}
        <SelectInput label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectInput>
        <TextArea label={opt.reasonRequired ? 'Reason (required)' : 'Remarks (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} required={opt.reasonRequired} />
      </div>
    </Modal>
  )
}
