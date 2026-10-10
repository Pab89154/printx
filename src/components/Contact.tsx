import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { mailtoHref, openPrintXMailto, PRINTX_CONTACT_EMAIL } from '../lib/mailto'
import { usePublicData } from '../context/PublicDataContext'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

const INQUIRY_TYPES = [
  'General question',
  'Custom print request',
  'Website feedback',
] as const

export function Contact() {
  const { data } = usePublicData()
  const content = data?.content
  const contactEmail = content?.contactEmail?.trim() || PRINTX_CONTACT_EMAIL
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name') || '').trim()
    const email = String(form.get('email') || '').trim()
    const inquiryType = String(form.get('inquiryType') || 'General question').trim()
    const message = String(form.get('message') || '').trim()

    openPrintXMailto({
      email: contactEmail,
      subject: `[PrintX] ${inquiryType}: ${name || 'Message'}`,
      body: [
        `Name: ${name}`,
        `Reply-to: ${email}`,
        `Inquiry: ${inquiryType}`,
        '',
        message,
      ].join('\n'),
    })
    setSubmitted(true)
    e.currentTarget.reset()
  }

  return (
    <section id="contact" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading title="Contact PrintX" subtitle="Questions, custom print ideas, or website feedback." />
        </ScrollReveal>

        <div className="grid gap-12 lg:grid-cols-5">
          <ScrollReveal className="lg:col-span-2">
            <div className="space-y-4 text-sm">
              <p>
                <strong>Email:</strong>{' '}
                <a
                  href={mailtoHref(contactEmail, { subject: 'Hello PrintX' })}
                  className="text-electric"
                >
                  {contactEmail}
                </a>
              </p>
              <p><strong>General questions</strong> — ask us anything about PrintX.</p>
              <p><strong>Custom print requests</strong> — tell us about your idea.</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={150} className="lg:col-span-3">
            {submitted ? (
              <div className="flex items-start gap-3 rounded-2xl border border-cyan/30 bg-white p-8">
                <CheckCircle2 size={24} className="text-cyan" />
                <div>
                  <p className="text-lg font-semibold text-navy">Opening your email app…</p>
                  <p className="mt-2 text-sm text-muted">
                    Send the message to {contactEmail} from your mail app. If nothing opened,{' '}
                    <a
                      href={mailtoHref(contactEmail, { subject: 'Hello PrintX' })}
                      className="font-medium text-electric"
                    >
                      tap here
                    </a>
                    .
                  </p>
                  <Button type="button" size="sm" className="mt-4" onClick={() => setSubmitted(false)}>
                    Write another
                  </Button>
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
                <Button type="submit" size="lg" className="mt-6 w-full">
                  Email PrintX
                </Button>
                <p className="mt-3 text-center text-xs text-muted">
                  Opens your email app to {contactEmail}
                </p>
              </form>
            )}
          </ScrollReveal>
        </div>
      </div>
    </section>
  )
}
