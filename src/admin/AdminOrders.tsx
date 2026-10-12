import { useEffect, useState } from 'react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import type { OrderDto, PrinterDto } from '../types/catalog'

export function AdminOrders() {
  const { label } = useAdminAuth()
  const [orders, setOrders] = useState<OrderDto[]>([])
  const [printers, setPrinters] = useState<PrinterDto[]>([])
  const [error, setError] = useState('')
  const [claimPrinter, setClaimPrinter] = useState<Record<string, string>>({})
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
  const [gcodeBusyId, setGcodeBusyId] = useState<string | null>(null)

  async function load() {
    const data = await api.catalog.orders.list()
    setOrders(data.orders)
    setPrinters(data.printers)
    const defaults: Record<string, string> = {}
    for (const o of data.orders) {
      for (const item of o.items ?? []) {
        if (item.printStatus === 'unclaimed') {
          defaults[item.id] = data.printers[0]?.id ?? ''
        }
      }
    }
    setClaimPrinter(defaults)
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load orders'))
  }, [])

  async function refundOrder(order: OrderDto) {
    const who = order.customerName || order.customerEmail || 'this customer'
    if (
      !window.confirm(
        `Refund $${order.totalUsd.toFixed(2)} to ${who}? Money returns through Stripe to their original payment method.`,
      )
    ) {
      return
    }
    setRefundBusyId(order.id)
    setError('')
    try {
      await api.catalog.orders.refund(order.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund failed')
    } finally {
      setRefundBusyId(null)
    }
  }

  async function deleteOrder(order: OrderDto) {
    const who = order.customerName || order.customerEmail || 'this order'
    const warn =
      order.status === 'refunded'
        ? `Delete order for ${who}? This removes it from the portal permanently.`
        : `Delete order for ${who} ($${order.totalUsd.toFixed(2)}, ${order.status})? This does not refund Stripe — refund first if needed. Removes the order from the portal permanently.`
    if (!window.confirm(warn)) return
    setDeleteBusyId(order.id)
    setError('')
    try {
      await api.catalog.orders.delete(order.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Orders</h1>
        <p className="mt-1 text-sm text-muted">
          Claim a paid item with your printer. When done, you get the worst-case manufacturing cost
          (tracked under Money). Leftover profit stays with PrintX in Stripe. Use Refund if the
          customer cancels or you cannot print.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {orders.length === 0 && (
        <p className="rounded-2xl border bg-white p-6 text-sm text-muted">No paid orders yet.</p>
      )}

      {orders.map((order) => (
        <section key={order.id} className="rounded-2xl border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-navy">
                {order.customerName || 'Customer'} · {order.customerEmail}
              </p>
              <p className="text-xs text-muted">
                {order.status} · ${order.totalUsd.toFixed(2)}
                {order.subtotalUsd > 0 && order.shippingUsd > 0
                  ? ` (items $${order.subtotalUsd.toFixed(2)} + ship $${order.shippingUsd.toFixed(2)})`
                  : ''}{' '}
                · paid {order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
              </p>
              {(order.shippingName ||
                order.shippingLine1 ||
                order.shippingMethod ||
                order.shippingUsd > 0) && (
                <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-navy">
                  <p className="font-semibold">Ship to</p>
                  {order.shippingName ? <p>{order.shippingName}</p> : null}
                  {order.shippingLine1 ? <p>{order.shippingLine1}</p> : null}
                  {order.shippingLine2 ? <p>{order.shippingLine2}</p> : null}
                  {(order.shippingCity || order.shippingState || order.shippingPostal) && (
                    <p>
                      {[order.shippingCity, order.shippingState].filter(Boolean).join(', ')}
                      {order.shippingPostal ? ` ${order.shippingPostal}` : ''}
                    </p>
                  )}
                  {order.shippingCountry ? <p>{order.shippingCountry}</p> : null}
                  {!order.shippingLine1 && !order.shippingCity && !order.shippingPostal ? (
                    <p className="text-amber-700">Street address not saved yet — reopen Orders to refresh from Stripe.</p>
                  ) : null}
                  {(order.shippingMethod || order.shippingUsd > 0) && (
                    <p className="mt-1 text-muted">
                      {order.shippingMethod || 'Shipping'}
                      {order.shippingUsd > 0 ? ` · $${order.shippingUsd.toFixed(2)}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {order.status !== 'refunded' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-compact text-red-600"
                  disabled={refundBusyId === order.id || deleteBusyId === order.id}
                  onClick={() => void refundOrder(order)}
                >
                  {refundBusyId === order.id ? 'Refunding…' : 'Refund'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-compact text-red-600"
                disabled={deleteBusyId === order.id || refundBusyId === order.id}
                onClick={() => void deleteOrder(order)}
              >
                {deleteBusyId === order.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(order.items ?? []).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-100 px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-navy">
                      {item.designName ?? 'Design'} · {item.colorName} × {item.qty}
                    </p>
                    <p className="text-xs text-muted">
                      SKU {item.sku} · unit ${item.unitPriceUsd.toFixed(2)} · worst cost $
                      {item.worstCostUnitUsd.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted">
                      Status: {item.printStatus}
                      {item.assignedPrinterId
                        ? ` · printer ${printers.find((p) => p.id === item.assignedPrinterId)?.ownerLabel ?? item.assignedPrinterId}`
                        : ''}
                    </p>
                    {item.printStatus === 'done' && (
                      <p className="mt-1 text-xs text-electric">
                        Owed to printer ${item.reimburseUsd?.toFixed(2)}
                        {item.profitUsd != null
                          ? ` · business kept $${item.profitUsd.toFixed(2)}`
                          : ''}
                      </p>
                    )}
                  </div>

                  {order.status !== 'refunded' && item.printStatus === 'unclaimed' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-lg border px-2 py-1.5 text-sm"
                        value={claimPrinter[item.id] ?? ''}
                        onChange={(e) =>
                          setClaimPrinter((m) => ({ ...m, [item.id]: e.target.value }))
                        }
                      >
                        {printers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.ownerLabel} — {p.modelName}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        onClick={() =>
                          void api.catalog.orders
                            .claim(item.id, claimPrinter[item.id] || printers[0]?.id || '')
                            .then(() => load())
                            .catch((e) => setError(e instanceof Error ? e.message : 'Claim failed'))
                        }
                      >
                        Claim as {label}
                      </button>
                    </div>
                  )}

                  {order.status !== 'refunded' &&
                    (item.printStatus === 'claimed' || item.printStatus === 'done') && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={gcodeBusyId === item.id}
                          onClick={() => {
                            setGcodeBusyId(item.id)
                            setError('')
                            void api.catalog.orders
                              .downloadGcode(item.id)
                              .catch((e) =>
                                setError(e instanceof Error ? e.message : 'G-code download failed'),
                              )
                              .finally(() => setGcodeBusyId(null))
                          }}
                        >
                          {gcodeBusyId === item.id ? 'Preparing…' : 'Download G-code'}
                        </button>
                        {item.printStatus === 'claimed' && (
                          <button
                            type="button"
                            className="btn btn-primary btn-compact"
                            onClick={() =>
                              void api.catalog.orders
                                .complete(item.id)
                                .then(() => load())
                                .catch((e) =>
                                  setError(e instanceof Error ? e.message : 'Complete failed'),
                                )
                            }
                          >
                            Mark printed / settle
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
