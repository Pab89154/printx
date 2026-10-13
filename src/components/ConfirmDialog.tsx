import { useEffect, useId, useState } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  /** Optional text field (replaces window.prompt). */
  prompt?: {
    label?: string
    placeholder?: string
    defaultValue?: string
    required?: boolean
  }
  onConfirm: (promptValue?: string) => void
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
  prompt,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const promptId = useId()
  const [promptValue, setPromptValue] = useState(prompt?.defaultValue ?? '')

  useEffect(() => {
    if (!open) return
    setPromptValue(prompt?.defaultValue ?? '')
  }, [open, prompt?.defaultValue])

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

  const promptRequired = Boolean(prompt?.required)
  const canConfirm = !busy && (!promptRequired || promptValue.trim().length > 0)

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
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-bold text-navy">
          {title}
        </h2>
        <p id={descId} className="mt-2 text-sm leading-relaxed text-muted">
          {message}
        </p>
        {prompt ? (
          <label className="mt-4 block text-sm font-medium text-navy" htmlFor={promptId}>
            {prompt.label || 'Note'}
            <textarea
              id={promptId}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              rows={3}
              autoFocus
              disabled={busy}
              placeholder={prompt.placeholder}
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
            />
          </label>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'}
            onClick={() => onConfirm(prompt ? promptValue : undefined)}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
