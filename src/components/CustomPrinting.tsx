import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'

export function CustomPrinting() {
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get('name') || '').trim()
    const email = String(formData.get('email') || '').trim()
    const description = String(formData.get('description') || '').trim()
    const size = String(formData.get('size') || '').trim()

    if (!name || !email || !description || !size) {
      setError('Please fill in all required fields.')
      return
    }

    setBusy(true)
    setError('')
    void api.public
      .customRequest(formData)
      .then(() => {
        setSubmitted(true)
        form.reset()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not submit request'))
      .finally(() => setBusy(false))
  }

  return (
    <section id="custom" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <ScrollReveal>
            <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">Have an Idea?</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Want something we don&apos;t currently sell? Tell us about your idea and we&apos;ll see if we can 3D
              print it. We may not print every request.
            </p>
            {submitted && (
              <div className="mt-8 flex items-start gap-3 rounded-2xl border border-cyan/30 bg-cyan/5 p-5">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-cyan" />
                <div>
                  <p className="font-semibold text-navy">Request submitted</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Your idea is in our Custom Prints queue. A main admin will accept or decline it — we&apos;ll
                    follow up by email.
                  </p>
                  <Button type="button" size="sm" className="mt-4" onClick={() => setSubmitted(false)}>
                    Submit another
                  </Button>
                </div>
              </div>
            )}
          </ScrollReveal>

          {!submitted && (
            <ScrollReveal delay={150}>
              <form
                className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg sm:p-8"
                onSubmit={handleSubmit}
              >
                <h3 className="font-semibold text-navy">Request a custom print</h3>
                <p className="mt-1 text-sm text-muted">All fields below are required (file optional).</p>
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                  <textarea
                    name="description"
                    required
                    rows={4}
                    className="field-input"
                    placeholder="Describe your idea"
                  />
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Approximate size</span>
                  <select name="size" required className="field-input" defaultValue="">
                    <option value="" disabled>
                      Select a size
                    </option>
                    <option>Small (under 3 inches)</option>
                    <option>Medium (3–6 inches)</option>
                    <option>Large (6+ inches)</option>
                    <option>Not sure</option>
                  </select>
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">
                    Model file <span className="font-normal text-muted">(optional · .stl or .obj)</span>
                  </span>
                  <input
                    name="file"
                    type="file"
                    accept=".stl,.obj,model/stl,model/obj"
                    className="mt-1.5 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-electric/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-electric"
                  />
                </label>
                <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
                  {busy ? 'Submitting…' : 'Submit request'}
                </Button>
              </form>
            </ScrollReveal>
          )}
        </div>
      </div>
    </section>
  )
}
