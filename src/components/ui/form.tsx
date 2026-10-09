import clsx from 'clsx'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'

const base = 'block w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm placeholder:text-slate-400 disabled:bg-slate-100 aria-[invalid=true]:border-red-500'

export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: (id: string, describedBy: string | undefined) => ReactNode; className?: string }) {
  const id = useId()
  const msgId = error || hint ? `${id}-msg` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}{required && <span className="text-red-600" aria-hidden> *</span>}
      </label>
      {children(id, msgId)}
      {(error || hint) && <p id={msgId} className={clsx('mt-1 text-xs', error ? 'text-red-700' : 'text-muted')}>{error ?? hint}</p>}
    </div>
  )
}

type FieldBase = { label: string; error?: string; hint?: string; wrapperClassName?: string }

export function TextInput({ label, error, hint, wrapperClassName, className, ...rest }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={rest.required} className={wrapperClassName}>
      {(id, d) => <input id={id} aria-invalid={!!error} aria-describedby={d} className={clsx(base, className)} {...rest} />}
    </Field>
  )
}

export function SelectInput({ label, error, hint, wrapperClassName, className, children, ...rest }: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={rest.required} className={wrapperClassName}>
      {(id, d) => <select id={id} aria-invalid={!!error} aria-describedby={d} className={clsx(base, className)} {...rest}>{children}</select>}
    </Field>
  )
}

export function TextArea({ label, error, hint, wrapperClassName, className, ...rest }: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={rest.required} className={wrapperClassName}>
      {(id, d) => <textarea id={id} rows={3} aria-invalid={!!error} aria-describedby={d} className={clsx(base, className)} {...rest} />}
    </Field>
  )
}

export function Checkbox({ label, hint, className, ...rest }: { label: ReactNode; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={clsx('flex items-start gap-2 text-sm text-ink', className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line text-navy-900" {...rest} />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  )
}

/** Plain control without a label wrapper (filters, toolbars). */
export function FilterSelect({ label, className, children, ...rest }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select className={clsx(base, 'py-1.5', className)} {...rest}>{children}</select>
    </label>
  )
}
