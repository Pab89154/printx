import { useState } from 'react'
import { CheckCircle2, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'

export function CustomPrinting() {
  const [submitted, setSubmitted] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const form = e.currentTarget
    const formData = new FormData(form)
    try {
      await api.public.customRequest(formData)
      setSubmitted(true)
      setShowForm(false)
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request')
    } finally {
      setLoading(false)
    }
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
              <Button size="lg" className="mt-8" onClick={() => setShowForm(true)}>
                Request a Custom Print
              </Button>
            )}
            {submitted && (
              <div className="mt-8 flex items-start gap-3 rounded-2xl border border-cyan/30 bg-cyan/5 p-5">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-cyan" />
                <div>
                  <p className="font-semibold text-navy">Request received!</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Someone from PrintX will review your idea and get back to you by email.
                  </p>
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
                  <span className="mb-1.5 block text-sm font-medium text-navy">School</span>
                  <input name="school" type="text" className="field-input" placeholder="Your school name" />
                </label>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">What would you like printed?</span>
                  <input name="description" required type="text" className="field-input" placeholder="Describe your idea" />
                </label>
                <div className="mt-4">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Upload a 3D model (optional)</span>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 text-sm text-muted hover:border-electric hover:bg-electric/5">
                    <Upload size={18} />
                    <span>.STL or .OBJ file</span>
                    <input name="file" type="file" accept=".stl,.obj" className="sr-only" />
                  </label>
                </div>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">Approximate size</span>
                  <select name="size" className="field-input">
                    <option>Small (under 3 inches)</option>
                    <option>Medium (3–6 inches)</option>
                    <option>Large (6+ inches)</option>
                    <option>Not sure</option>
                  </select>
                </label>
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <Button type="submit" size="lg" className="mt-6 w-full" disabled={loading}>
                  {loading ? 'Submitting…' : 'Submit Request'}
                </Button>
              </form>
            </ScrollReveal>
          )}
        </div>
      </div>
    </section>
  )
}
