import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { mailtoHref, openPrintXMailto, PRINTX_CONTACT_EMAIL } from '../lib/mailto'
import { usePublicData } from '../context/PublicDataContext'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'

export function CustomPrinting() {
  const { data } = usePublicData()
  const contactEmail = data?.content?.contactEmail?.trim() || PRINTX_CONTACT_EMAIL
  const [submitted, setSubmitted] = useState(false)
  const [showForm, setShowForm] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get('name') || '').trim()
    const email = String(formData.get('email') || '').trim()
    const description = String(formData.get('description') || '').trim()
    const size = String(formData.get('size') || '').trim()

    openPrintXMailto({
      email: contactEmail,
      subject: `[PrintX] Custom print request: ${name || 'Visitor'}`,
      body: [
        `Name: ${name}`,
        `Reply-to: ${email}`,
        size ? `Approximate size: ${size}` : null,
        '',
        'What I would like printed:',
        description,
        '',
        '(If you have a .STL or .OBJ file, please attach it in this email.)',
      ]
        .filter(Boolean)
        .join('\n'),
    })
    setSubmitted(true)
    setShowForm(false)
    form.reset()
  }

  return (
    <section id="custom" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <ScrollReveal>
            <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">Have an Idea?</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Want something we don&apos;t currently sell? Tell us about your idea and we&apos;ll see if we can 3D print it.
            </p>
            {!showForm && !submitted && (
              <Button
                size="lg"
                className="mt-8"
                href={mailtoHref(contactEmail, {
                  subject: '[PrintX] Custom print request',
                  body: 'Hi PrintX,\n\nI have a custom print idea:\n\n',
                })}
              >
                Request a Custom Print
              </Button>
            )}
            {!showForm && !submitted && (
              <button
                type="button"
                className="mt-3 block text-sm font-medium text-electric hover:underline"
                onClick={() => setShowForm(true)}
              >
                Or fill in details first
              </button>
            )}
            {submitted && (
              <div className="mt-8 flex items-start gap-3 rounded-2xl border border-cyan/30 bg-cyan/5 p-5">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-cyan" />
                <div>
                  <p className="font-semibold text-navy">Opening your email app…</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Send the request to {contactEmail}. Attach a .STL/.OBJ in your mail app if you have one.
                  </p>
                  <Button type="button" size="sm" className="mt-4" onClick={() => setSubmitted(false)}>
                    Write another
                  </Button>
                </div>
              </div>
            )}
          </ScrollReveal>

          {showForm && (
            <ScrollReveal delay={150}>
              <form className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg sm:p-8" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-navy">Name</span>
                    <input name="name" required type="text" className="field-input" placeholder="Your name" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-navy">Email</span>
                    <input name="email" required type="email" className="field-input" placeholder="you@email.com" />
                  </label>
                </div>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">What would you like printed?</span>
                  <input name="description" required type="text" className="field-input" placeholder="Describe your idea" />
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Approximate size</span>
                  <select name="size" className="field-input">
                    <option>Small (under 3 inches)</option>
                    <option>Medium (3–6 inches)</option>
                    <option>Large (6+ inches)</option>
                    <option>Not sure</option>
                  </select>
                </label>
                <p className="mt-3 text-xs text-muted">
                  Your email app will open to {contactEmail}. Attach a .STL or .OBJ there if you have one.
                </p>
                <Button type="submit" size="lg" className="mt-4 w-full">
                  Email request
                </Button>
                <button
                  type="button"
                  className="mt-3 w-full text-sm font-medium text-muted hover:text-navy"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </form>
            </ScrollReveal>
          )}
        </div>
      </div>
    </section>
  )
}
