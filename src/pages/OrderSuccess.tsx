import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { api } from '../lib/api'

type SuccessPayload = {
  orderId: string
  status: string
  statusLabel: string
  totalUsd: number
  shippingMethod: string
  trackCode: string | null
  trackCodeAlreadyShown: boolean
  items: {
    designName: string
    colorName: string
    qty: number
    printStatusLabel: string
  }[]
}

export function OrderSuccess() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  const [data, setData] = useState<SuccessPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(sessionId))

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      setError('Missing checkout session.')
      return
    }
    let cancelled = false
    setLoading(true)
    api.catalog
      .orderSuccess(sessionId)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load order')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-lg px-4 py-16 text-center sm:py-20">
        <h1 className="text-3xl font-extrabold text-navy">Thanks for your order!</h1>
        <p className="mt-4 text-muted">
          Payment received. We&apos;ll print and ship your order. Use your track code below to check
          status anytime.
        </p>

        {loading ? <p className="mt-8 text-sm text-muted">Loading your track code…</p> : null}
        {error ? <p className="mt-8 text-sm text-red-600">{error}</p> : null}

        {data && !loading ? (
          <div className="mt-10">
            {data.trackCode ? (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Your track code
                </p>
                <p className="mt-3 font-mono text-5xl font-extrabold tracking-[0.2em] text-navy sm:text-6xl">
                  {data.trackCode}
                </p>
                <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
                  Keep this code — PrintX will not show it again. Write it down or screenshot it
                  before you leave this page.
                </p>
              </>
            ) : (
              <p className="mt-8 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-navy">
                This track code was already shown once and won&apos;t be displayed again. Enter it on{' '}
                <Link to="/track" className="font-semibold text-electric hover:underline">
                  Track orders
                </Link>{' '}
                if you still have it.
              </p>
            )}

            <p className="mt-6 text-sm text-muted">
              {data.statusLabel}
              {data.totalUsd > 0 ? ` · $${data.totalUsd.toFixed(2)}` : ''}
              {data.shippingMethod ? ` · ${data.shippingMethod}` : ''}
            </p>
          </div>
        ) : null}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link to="/track" className="btn btn-primary inline-flex">
            Track orders
          </Link>
          <Link to="/shop" className="btn btn-ghost inline-flex">
            Back to shop
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
