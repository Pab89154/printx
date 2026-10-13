import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { api } from '../lib/api'

type TrackPayload = {
  status: string
  statusLabel: string
  shippingMethod: string
  trackingNumber: string
  trackingCarrier: string
  trackingUrl: string
  shippedAt: string | null
  arrivedEta: string | null
  items: {
    designName: string
    colorName: string
    qty: number
    printStatusLabel: string
  }[]
}

export function TrackOrder() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<TrackPayload | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOrder(null)
    try {
      const data = await api.catalog.trackOrder(code)
      setOrder(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-extrabold text-navy">Track orders</h1>
        <p className="mt-2 text-muted">
          Enter the 6-digit code from your order confirmation. PrintX does not recover lost codes.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
          <label className="block text-sm font-medium text-navy">
            Track code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-2xl tracking-[0.35em] text-navy outline-none focus:border-electric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" className="btn btn-primary w-full" disabled={busy || code.length !== 6}>
            {busy ? 'Looking up…' : 'Track order'}
          </button>
        </form>

        {order ? (
          <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 text-left">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Status</p>
            <p className="mt-1 text-2xl font-bold text-navy">{order.statusLabel}</p>
            {order.shippingMethod ? (
              <p className="mt-2 text-sm text-muted">Shipping: {order.shippingMethod}</p>
            ) : null}
            {order.shippedAt && order.arrivedEta && order.status === 'shipped' ? (
              <p className="mt-1 text-sm text-muted">
                Estimated arrival {new Date(order.arrivedEta).toLocaleDateString()}
              </p>
            ) : null}
            {order.trackingUrl ? (
              <p className="mt-3">
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-electric hover:underline"
                >
                  {order.trackingCarrier || 'Carrier'} tracking
                  {order.trackingNumber ? ` · ${order.trackingNumber}` : ''}
                </a>
              </p>
            ) : order.trackingNumber ? (
              <p className="mt-3 text-sm text-navy">
                {order.trackingCarrier || 'Tracking'}: {order.trackingNumber}
              </p>
            ) : null}

            <ul className="mt-6 space-y-3 border-t border-slate-100 pt-4">
              {order.items.map((item, i) => (
                <li key={`${item.designName}-${i}`} className="text-sm">
                  <p className="font-medium text-navy">
                    {item.designName}
                    {item.colorName ? ` · ${item.colorName}` : ''} × {item.qty}
                  </p>
                  <p className="text-muted">{item.printStatusLabel}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-10 text-center text-sm text-muted">
          <Link to="/shop" className="text-electric hover:underline">
            Back to shop
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  )
}
