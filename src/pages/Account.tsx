import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { useCustomerAuth } from '../context/CustomerAuthContext'
import { api } from '../lib/api'

type ShopOrder = {
  id: string
  kind: 'shop'
  status: string
  totalUsd: number
  shippingUsd: number
  shippingLine1: string
  shippingCity: string
  shippingState: string
  shippingPostal: string
  shippingMethod: string
  trackingNumber: string
  trackingCarrier: string
  trackingUrl: string
  shippedAt: string | null
  paidAt: string | null
  refundRequest: { id: string; status: string; reason: string; adminNote: string } | null
  items: { id: string; designName: string; colorName: string; qty: number; unitPriceUsd: number }[]
}

type CustomOrder = {
  id: string
  kind: 'custom'
  status: string
  label: string
  totalUsd: number
  shippingUsd: number
  trackingNumber: string
  trackingCarrier: string
  trackingUrl: string
  shippedAt: string | null
  paidAt: string | null
  refundRequest?: { id: string; status: string; reason: string; adminNote: string } | null
}

export function Account() {
  const { customer, loading, logout } = useCustomerAuth()
  const [shopOrders, setShopOrders] = useState<ShopOrder[]>([])
  const [customOrders, setCustomOrders] = useState<CustomOrder[]>([])
  const [error, setError] = useState('')
  const [refundReason, setRefundReason] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const data = await api.customer.orders()
    setShopOrders(data.shopOrders as ShopOrder[])
    setCustomOrders(data.customOrders as CustomOrder[])
  }

  useEffect(() => {
    if (!customer) return
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load orders'))
  }, [customer])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <Header />
        <p className="p-8 text-sm text-muted">Loading…</p>
      </div>
    )
  }
  if (!customer) {
    return <Navigate to="/account/sign-in?next=/account" replace />
  }

  async function requestRefund(kind: 'shop' | 'custom', id: string) {
    const reason = (refundReason[id] || '').trim()
    if (!reason) {
      setError('Please enter a reason for the refund.')
      return
    }
    setBusyId(id)
    setError('')
    try {
      if (kind === 'shop') await api.customer.requestShopRefund(id, reason)
      else await api.customer.requestCustomRefund(id, reason)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund request failed')
    } finally {
      setBusyId(null)
    }
  }

  const all = [
    ...shopOrders.map((o) => ({ ...o, sortAt: o.paidAt || '' })),
    ...customOrders.map((o) => ({ ...o, sortAt: o.paidAt || '' })),
  ].sort((a, b) => b.sortAt.localeCompare(a.sortAt))

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold text-navy">My account</h1>
            <p className="mt-1 text-sm text-muted">
              {customer.displayName || customer.email} · {customer.email}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <h2 className="mt-10 text-lg font-bold text-navy">Orders</h2>
        {all.length === 0 ? (
          <p className="mt-4 rounded-2xl border bg-white p-6 text-sm text-muted">
            No orders yet.{' '}
            <Link to="/shop" className="text-electric hover:underline">
              Shop designs
            </Link>
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {all.map((order) => (
              <li key={`${order.kind}-${order.id}`} className="rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-navy">
                      {order.kind === 'shop'
                        ? order.items.map((i) => i.designName).join(', ') || 'Shop order'
                        : order.label}
                    </p>
                    <p className="text-xs text-muted">
                      {order.status}
                      {order.paidAt ? ` · paid ${new Date(order.paidAt).toLocaleString()}` : ''}
                      {' · '}${order.totalUsd.toFixed(2)}
                      {order.shippingUsd > 0 ? ` + ship $${order.shippingUsd.toFixed(2)}` : ''}
                    </p>
                  </div>
                </div>

                {order.kind === 'shop' && order.items.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-muted">
                    {order.items.map((i) => (
                      <li key={i.id}>
                        {i.designName} · {i.colorName} × {i.qty}
                      </li>
                    ))}
                  </ul>
                )}

                {order.shippedAt || order.trackingNumber ? (
                  <div className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-navy">
                    <p className="font-semibold">Shipped</p>
                    {order.trackingNumber ? (
                      <p>
                        {order.trackingCarrier || 'UPS'}{' '}
                        {order.trackingUrl ? (
                          <a
                            href={order.trackingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-electric hover:underline"
                          >
                            {order.trackingNumber}
                          </a>
                        ) : (
                          order.trackingNumber
                        )}
                      </p>
                    ) : null}
                    {order.shippedAt ? (
                      <p className="text-xs text-muted">
                        {new Date(order.shippedAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {order.refundRequest ? (
                  <p className="mt-3 text-sm text-muted">
                    Refund request: <span className="font-medium text-navy">{order.refundRequest.status}</span>
                    {order.refundRequest.adminNote
                      ? ` — ${order.refundRequest.adminNote}`
                      : ''}
                  </p>
                ) : order.status !== 'refunded' && order.kind === 'shop' ? (
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <label className="block text-xs font-semibold text-muted">
                      Request a refund
                      <textarea
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-navy"
                        rows={2}
                        placeholder="Why do you need a refund?"
                        value={refundReason[order.id] || ''}
                        onChange={(e) =>
                          setRefundReason((m) => ({ ...m, [order.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact text-red-600"
                      disabled={busyId === order.id}
                      onClick={() => void requestRefund('shop', order.id)}
                    >
                      {busyId === order.id ? 'Sending…' : 'Submit refund request'}
                    </button>
                  </div>
                ) : order.status !== 'refunded' && order.kind === 'custom' && !order.refundRequest ? (
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <label className="block text-xs font-semibold text-muted">
                      Request a refund
                      <textarea
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-navy"
                        rows={2}
                        placeholder="Why do you need a refund?"
                        value={refundReason[order.id] || ''}
                        onChange={(e) =>
                          setRefundReason((m) => ({ ...m, [order.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact text-red-600"
                      disabled={busyId === order.id}
                      onClick={() => void requestRefund('custom', order.id)}
                    >
                      {busyId === order.id ? 'Sending…' : 'Submit refund request'}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  )
}
