import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api'
import { mailtoHref } from '../lib/mailto'
import { usePublicData } from '../context/PublicDataContext'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

const INQUIRY_TYPES = ['General question', 'School stand request', 'Custom print request'] as const

export function Contact() {
  const { data } = usePublicData()
  const content = data?.content
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const form = new FormData(e.currentTarget)
    try {
      await api.public.contact({
        name: String(form.get('name')),
        email: String(form.get('email')),
        inquiryType: String(form.get('inquiryType')),
        message: String(form.get('message')),
      })
      setSubmitted(true)
      e.currentTarget.reset()
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="contact" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading title="Contact PrintX" subtitle="Questions, school stand requests, or custom print ideas." />
        </ScrollReveal>

        <div className="grid gap-12 lg:grid-cols-5">
          <ScrollReveal className="lg:col-span-2">
            <div className="space-y-4 text-sm">
              <p><strong>Email:</strong> <a href={mailtoHref(content?.contactEmail ?? 'hello@printx.pw', { subject: 'Hello PrintX' })} className="text-electric">{content?.contactEmail}</a></p>
              <p><strong>General questions</strong> — ask us anything about PrintX.</p>
              <p><strong>School stand requests</strong> — bring PrintX to your school.</p>
              <p><strong>Custom print requests</strong> — tell us about your idea.</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={150} className="lg:col-span-3">
            {submitted ? (
              <div className="flex items-start gap-3 rounded-2xl border border-cyan/30 bg-white p-8">
                <CheckCircle2 size={24} className="text-cyan" />
                <div>
                  <p className="text-lg font-semibold text-navy">Message sent!</p>
                  <p className="mt-2 text-sm text-muted">Thanks for reaching out. We&apos;ll get back to you soon.</p>
                </div>
              </div>
            ) : (
              <form className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block"><span className="mb-1.5 block text-sm font-medium">Name</span><input name="name" required className="field-input" /></label>
                  <label className="block"><span className="mb-1.5 block text-sm font-medium">Email</span><input name="email" required type="email" className="field-input" /></label>
                </div>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium">Inquiry type</span>
                  <select name="inquiryType" className="field-input">{INQUIRY_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium">Message</span>
                  <textarea name="message" required rows={4} className="field-input" />
                </label>
                <Button type="submit" size="lg" className="mt-6 w-full" disabled={loading}>{loading ? 'Sending…' : 'Send Message'}</Button>
              </form>
            )}
          </ScrollReveal>
        </div>
      </div>
    </section>
  )
}
