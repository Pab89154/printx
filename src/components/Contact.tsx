import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

const INQUIRY_TYPES = ['General question', 'Website feedback'] as const

export function Contact() {
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get('name') || '').trim()
    const email = String(formData.get('email') || '').trim()
    const inquiryType = String(formData.get('inquiryType') || 'General question').trim()
    const message = String(formData.get('message') || '').trim()

    setBusy(true)
    setError('')
    try {
      await api.public.contact({ name, email, inquiryType, message })
      setSubmitted(true)
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="contact" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading
            title="Contact PrintX"
            subtitle="Questions, custom print ideas, or website feedback."
          />
        </ScrollReveal>

        <div className="grid gap-12 lg:grid-cols-5">
          <ScrollReveal className="lg:col-span-2">
            <div className="space-y-4 text-sm">
              <p>
                <strong>Send a message</strong> with the form — it goes to our PrintX inbox (not your
                email app).
              </p>
              <p>
                <strong>General questions</strong> — ask us anything about PrintX.
              </p>
              <p>
                <strong>Custom print ideas</strong> — use{' '}
                <a href="#custom" className="text-electric hover:underline">
                  Custom Prints
                </a>{' '}
                above (reviewed in the portal).
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={150} className="lg:col-span-3">
            {submitted ? (
              <div className="flex items-start gap-3 rounded-2xl border border-cyan/30 bg-white p-8">
                <CheckCircle2 size={24} className="text-cyan" />
                <div>
                  <p className="text-lg font-semibold text-navy">Message sent</p>
                  <p className="mt-2 text-sm text-muted">
                    Thanks — we received your message in our PrintX inbox and will get back to you.
                  </p>
                  <Button type="button" size="sm" className="mt-4" onClick={() => setSubmitted(false)}>
                    Write another
                  </Button>
                </div>
              </div>
            ) : (
              <form className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8" onSubmit={handleSubmit}>
                {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Name</span>
                    <input name="name" required className="field-input" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Email</span>
                    <input name="email" required type="email" className="field-input" />
                  </label>
                </div>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium">Inquiry type</span>
                  <select name="inquiryType" className="field-input">
                    {INQUIRY_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium">Message</span>
                  <textarea name="message" required rows={4} className="field-input" />
                </label>
                <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
                  {busy ? 'Sending…' : 'Send message'}
                </Button>
                <p className="mt-3 text-center text-xs text-muted">
                  Delivered to the PrintX portal inbox — no email app opens.
                </p>
              </form>
            )}
          </ScrollReveal>
        </div>
      </div>
    </section>
  )
}
