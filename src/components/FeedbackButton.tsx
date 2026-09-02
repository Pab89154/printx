import { useEffect, useId, useState } from 'react'
import { CheckCircle2, MessageSquarePlus, X } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from './Button'

export function FeedbackButton() {
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prev
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const form = e.currentTarget
    const data = new FormData(form)
    try {
      await api.public.contact({
        name: String(data.get('name')),
        email: String(data.get('email')),
        inquiryType: 'Website feedback',
        message: String(data.get('message')),
      })
      setSubmitted(true)
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send feedback')
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setOpen(false)
    setTimeout(() => {
      setSubmitted(false)
      setError('')
    }, 200)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-electric px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-electric/35 transition-all hover:-translate-y-0.5 hover:bg-electric-light hover:shadow-cyan/25 sm:bottom-6 sm:right-6"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MessageSquarePlus size={18} aria-hidden />
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-navy/50 backdrop-blur-sm"
            aria-label="Close feedback form"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 w-full max-w-md rounded-2xl border border-navy/10 bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-xl font-bold text-navy">
                  Send feedback
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Tell us what you like or what we can improve.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-navy"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {submitted ? (
              <div className="flex items-start gap-3 rounded-2xl border border-cyan/30 bg-cyan/5 p-5">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-cyan" />
                <div>
                  <p className="font-semibold text-navy">Thanks for the feedback!</p>
                  <p className="mt-1 text-sm text-muted">We read every message.</p>
                  <Button type="button" size="sm" className="mt-4" onClick={close}>
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Name</span>
                  <input name="name" required className="field-input" placeholder="Your name" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Email</span>
                  <input
                    name="email"
                    required
                    type="email"
                    className="field-input"
                    placeholder="you@email.com"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Your feedback</span>
                  <textarea
                    name="message"
                    required
                    rows={4}
                    className="field-input"
                    placeholder="What should we know?"
                  />
                </label>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? 'Sending…' : 'Send feedback'}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
