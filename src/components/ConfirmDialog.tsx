import { useEffect } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-navy/50"
        disabled={busy}
        onClick={() => {
          if (!busy) onCancel()
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="printx-confirm-title"
        aria-describedby="printx-confirm-desc"
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
      >
        <h2 id="printx-confirm-title" className="text-lg font-bold text-navy">
          {title}
        </h2>
        <p id="printx-confirm-desc" className="mt-2 text-sm leading-relaxed text-muted">
          {message}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
