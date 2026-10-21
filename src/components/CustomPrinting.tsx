import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'

type QuoteStatus = {
  id: string
  sliceStatus: string
  catalogPriceUsd: number | null
  error?: string
  status: string
}

type Step = 'form' | 'estimating' | 'priced' | 'failed'

export function CustomPrinting() {
  const [step, setStep] = useState<Step>('form')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [quote, setQuote] = useState<QuoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [error, setError] = useState('')
  /** Ignore late estimate responses after the user cancels. */
  const abandonRef = useRef(false)

  // Warn if they try to close the tab while estimating.
  useEffect(() => {
    if (step !== 'estimating') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [step])

  useEffect(() => {
    if (!requestId || step !== 'estimating') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = () => {
      void api.public
        .customRequestStatus(requestId)
        .then((data) => {
          if (cancelled || abandonRef.current) return
          setQuote(data)
          if (data.sliceStatus === 'ready' && data.catalogPriceUsd != null) {
            setStep('priced')
            return
          }
          if (data.sliceStatus === 'error') {
            setStep('failed')
            return
          }
          timer = setTimeout(poll, 2000)
        })
        .catch((err) => {
          if (cancelled || abandonRef.current) return
          setError(err instanceof Error ? err.message : 'Could not load estimate')
          setStep('failed')
        })
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [requestId, step])

  function resetAll() {
    setStep('form')
    setRequestId(null)
    setQuote(null)
    setError('')
    setBusy(false)
    setPayBusy(false)
  }

  function handleEstimate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const file = formData.get('file')

    if (!(file instanceof File) || !file.size) {
      setError('Please attach an .stl or .gcode file.')
      return
    }
    const name = file.name.toLowerCase()
    if (!name.endsWith('.stl') && !name.endsWith('.gcode')) {
      setError('Please attach an .stl or .gcode file.')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError(
        `That file is ${(file.size / 1048576).toFixed(0)} MB — the biggest model we can take is 50 MB. In your design app, look for “decimate” or “reduce mesh” to shrink it, then try again.`,
      )
      return
    }

    abandonRef.current = false
    setBusy(true)
    setError('')
    setQuote(null)
    setStep('estimating')
    void api.public
      .customRequest(formData)
      .then((res) => {
        if (abandonRef.current) {
          void api.public.customRequestCancel(res.id).catch(() => undefined)
          return
        }
        setRequestId(res.id)
        setQuote({
          id: res.id,
          sliceStatus: 'slicing',
          catalogPriceUsd: null,
          status: 'awaiting_payment',
        })
      })
      .catch((err) => {
        if (abandonRef.current) return
        setError(err instanceof Error ? err.message : 'Could not start estimate')
        setStep('form')
      })
      .finally(() => setBusy(false))
  }

  async function handlePay() {
    if (!requestId) return
    setPayBusy(true)
    setError('')
    try {
      const { url } = await api.public.customRequestCheckout(requestId)
      if (!url) throw new Error('Checkout URL missing')
      window.location.href = url
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed'
      setError(msg)
      setPayBusy(false)
    }
  }

  async function handleCancel() {
    abandonRef.current = true
    const id = requestId
    if (!id) {
      resetAll()
      return
    }
    setPayBusy(true)
    setError('')
    try {
      await api.public.customRequestCancel(id)
      resetAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
      setPayBusy(false)
    }
  }

  return (
    <section id="custom" className="relative py-20 sm:py-28">
      {step === 'estimating' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/70 px-4 backdrop-blur-sm"
          role="alertdialog"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 text-center shadow-2xl">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-electric" aria-hidden />
            <p className="mt-4 text-lg font-semibold text-navy">Estimating your print…</p>
            <p className="mt-2 text-sm text-muted">
              We&apos;re slicing your model and calculating the price. This can take a minute.
            </p>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="mt-6 w-full"
              disabled={payBusy}
              onClick={() => void handleCancel()}
            >
              {payBusy ? 'Cancelling…' : 'Cancel'}
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <ScrollReveal>
            <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">Have an Idea?</h2>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Upload your model, get a price estimate, then pay online. Name and email are collected at Checkout.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={150}>
            {step === 'form' && (
              <form
                className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg sm:p-8"
                onSubmit={handleEstimate}
              >
                <h3 className="font-semibold text-navy">Request a custom print</h3>
                <p className="mt-1 text-sm text-muted">
                  Upload a model to estimate price. You&apos;ll enter name and email when you pay.
                </p>
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm font-medium text-navy">
                    Model file <span className="font-normal text-muted">(.stl or .gcode)</span>
                  </span>
                  <input
                    name="file"
                    type="file"
                    required
                    accept=".stl,.gcode,model/stl"
                    className="mt-1.5 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-electric/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-electric"
                  />
                </label>
                <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
                  {busy ? 'Starting…' : 'Estimate price'}
                </Button>
              </form>
            )}

            {step === 'priced' && quote && (
              <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-lg sm:p-8">
                <h3 className="font-semibold text-navy">Your estimate</h3>
                <p className="mt-1 text-sm text-muted">Review the price, then pay to send your request — or cancel.</p>
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <p className="mt-6 text-4xl font-extrabold text-electric">
                  ${quote.catalogPriceUsd?.toFixed(2) ?? '—'}
                </p>
                <p className="mt-2 text-sm text-muted">
                  Worst-cost printer estimate. Payment goes through Checkout (Stripe).
                </p>
                <p className="mt-4 text-sm text-navy">
                  <Link to="/terms-and-conditions" className="text-electric underline">
                    Click here to read the terms and conditions.
                  </Link>{' '}
                  Checkout asks you to agree before you pay.
                </p>
                {quote.error ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-amber-700">{quote.error}</p>
                ) : null}
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    size="lg"
                    className="w-full"
                    disabled={payBusy}
                    onClick={() => void handlePay()}
                  >
                    {payBusy ? 'Redirecting…' : 'Pay'}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="secondary"
                    className="w-full"
                    disabled={payBusy}
                    onClick={() => void handleCancel()}
                  >
                    {payBusy ? 'Cancelling…' : 'Cancel'}
                  </Button>
                </div>
              </div>
            )}

            {step === 'failed' && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-6 sm:p-8">
                <h3 className="font-semibold text-navy">Could not estimate</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">
                  {quote?.error || error || 'We could not quote this file. Try an .stl or .gcode export.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button type="button" onClick={() => void handleCancel()}>
                    Try again
                  </Button>
                </div>
              </div>
            )}
          </ScrollReveal>
        </div>
      </div>
    </section>
  )
}
