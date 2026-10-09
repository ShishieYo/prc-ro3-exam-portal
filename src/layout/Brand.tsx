import clsx from 'clsx'

/** Logo placeholder: no official PRC seal is bundled. Replace /public/prc-logo.* when an approved asset is available. */
export function Brand({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold', light ? 'bg-white text-navy-900' : 'bg-navy-900 text-white')} aria-hidden>PRC</div>
      <div className="leading-tight">
        <p className={clsx('text-sm font-semibold', light ? 'text-white' : 'text-navy-900')}>PRC Region III</p>
        {!compact && <p className={clsx('text-xs', light ? 'text-prc-100' : 'text-muted')}>Examination Personnel Portal</p>}
        {compact && <p className="text-[11px] text-prc-100">Examination Personnel</p>}
      </div>
    </div>
  )
}
