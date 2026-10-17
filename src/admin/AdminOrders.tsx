import { useEffect, useState } from 'react'
import { publicOrderStatusLabel, publicPrintStatusLabel } from '../../shared/orderTracking'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { OrderDto, PrinterDto } from '../types/catalog'

function isPrinted(status: string): boolean {
  return status === 'printed' || status === 'done'
}

function money(n: number | null | undefined): string {
  return (Number(n) || 0).toFixed(2)
}

/** Printer pay is capped by what the customer paid for items after discounts. */
function expectedPrinterPayUsd(
  order: OrderDto,
  item: NonNullable<OrderDto['items']>[number],
): number {
  const fromTotal = Math.max(0, (Number(order.totalUsd) || 0) - (Number(order.shippingUsd) || 0))
  const subtotal = Number(order.subtotalUsd) || 0
  const itemsPaid = subtotal > 0 ? Math.min(subtotal, fromTotal) : fromTotal
  const siblings = order.items ?? []
  const lineSum = siblings.reduce((s, r) => s + (Number(r.lineTotalUsd) || 0), 0)
  const line = Number(item.lineTotalUsd) || 0
  const paidShare =
    itemsPaid <= 0
      ? 0
      : lineSum <= 0
        ? itemsPaid / Math.max(1, siblings.length)
        : itemsPaid * (line / lineSum)
  const worst = Math.max(0, (Number(item.worstCostUnitUsd) || 0) * (Number(item.qty) || 1))
  return Math.round(Math.min(worst, paidShare) * 100) / 100
}

export function AdminOrders() {
  const { label } = useAdminAuth()
  const [orders, setOrders] = useState<OrderDto[]>([])
  const [printers, setPrinters] = useState<PrinterDto[]>([])
  const [error, setError] = useState('')
  const [claimPrinter, setClaimPrinter] = useState<Record<string, string>>({})
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
  const [gcodeBusyId, setGcodeBusyId] = useState<string | null>(null)
  const [stlBusyId, setStlBusyId] = useState<string | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [shipTracking, setShipTracking] = useState<Record<string, string>>({})
  const [shipBusyId, setShipBusyId] = useState<string | null>(null)
  const [arriveBusyId, setArriveBusyId] = useState<string | null>(null)
  const [pendingRefund, setPendingRefund] = useState<OrderDto | null>(null)
  const [pendingDeleteOrder, setPendingDeleteOrder] = useState<OrderDto | null>(null)
  const [pendingDeclineRefund, setPendingDeclineRefund] = useState<{ id: string } | null>(null)
  const [declineBusy, setDeclineBusy] = useState(false)
  const [refundRequests, setRefundRequests] = useState<
    {
      id: string
      orderId: string | null
      customerEmail: string
      customerName: string
      reason: string
      amountUsd: number
      createdAt: string
    }[]
  >([])

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
    try {
      const rr = await api.catalog.orders.listRefundRequests()
      setRefundRequests(rr.requests.filter((r) => r.orderId))
    } catch {
      setRefundRequests([])
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load orders'))
  }, [])

  async function shipOrder(order: OrderDto) {
    const trackingNumber = (shipTracking[order.id] || '').trim()
    if (!trackingNumber) {
      setError('Enter a UPS tracking number.')
      return
    }
    setShipBusyId(order.id)
    setError('')
    try {
      await api.catalog.orders.ship(order.id, { trackingNumber, carrier: 'UPS' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ship update failed')
    } finally {
      setShipBusyId(null)
    }
  }

  async function markArrived(order: OrderDto) {
    setArriveBusyId(order.id)
    setError('')
    try {
      await api.catalog.orders.markArrived(order.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark arrived')
    } finally {
      setArriveBusyId(null)
    }
  }

  async function decideRefund(id: string, action: 'approve' | 'decline') {
    if (action === 'decline') {
      setPendingDeclineRefund({ id })
      return
    }
    setError('')
    try {
      await api.catalog.orders.approveRefundRequest(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update refund request')
    }
  }

  async function confirmDeclineRefund(note?: string) {
    if (!pendingDeclineRefund) return
    setDeclineBusy(true)
    setError('')
    try {
      await api.catalog.orders.declineRefundRequest(
        pendingDeclineRefund.id,
        (note || '').trim() || 'Declined',
      )
      setPendingDeclineRefund(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update refund request')
    } finally {
      setDeclineBusy(false)
    }
  }

  async function refreshFromStripe() {
    setRefreshBusy(true)
    setError('')
    try {
      const data = await api.catalog.orders.refreshShipping()
      setOrders(data.orders)
      setPrinters(data.printers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh from Stripe')
    } finally {
      setRefreshBusy(false)
    }
  }

  function refundOrder(order: OrderDto) {
    setPendingRefund(order)
  }

  async function confirmRefundOrder() {
    if (!pendingRefund) return
    setRefundBusyId(pendingRefund.id)
    setError('')
    try {
      await api.catalog.orders.refund(pendingRefund.id)
      setPendingRefund(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund failed')
    } finally {
      setRefundBusyId(null)
    }
  }

  function deleteOrder(order: OrderDto) {
    setPendingDeleteOrder(order)
  }

  async function confirmDeleteOrder() {
    if (!pendingDeleteOrder) return
    setDeleteBusyId(pendingDeleteOrder.id)
    setError('')
    try {
      await api.catalog.orders.delete(pendingDeleteOrder.id)
      setPendingDeleteOrder(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteBusyId(null)
    }
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-clip">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-navy">Orders</h1>
          <p className="mt-1 text-sm text-muted">
            Claim a paid item with your printer. When done, Money tracks what to pay the printer
            (worst-case print cost). PrintX profit is the rest that stays in Stripe. Use Refund if the
            customer cancels or you cannot print.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          disabled={refreshBusy}
          onClick={() => void refreshFromStripe()}
        >
          {refreshBusy ? 'Refreshing…' : 'Refresh from Stripe'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {refundRequests.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-lg font-bold text-navy">Refund requests</h2>
          <ul className="mt-3 space-y-3">
            {refundRequests.map((r) => (
              <li key={r.id} className="rounded-xl border bg-white px-4 py-3 text-sm">
                <p className="font-semibold text-navy">
                  {r.customerName || r.customerEmail} · ${money(r.amountUsd)}
                </p>
                <p className="text-muted">{r.reason}</p>
                <div className="action-row mt-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={() => void decideRefund(r.id, 'approve')}
                  >
                    Approve refund
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact text-red-600"
                    onClick={() => void decideRefund(r.id, 'decline')}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {orders.length === 0 && (
        <p className="rounded-2xl border bg-white p-6 text-sm text-muted">No paid orders yet.</p>
      )}

      {orders.map((order) => (
        <section key={order.id} className="min-w-0 overflow-hidden rounded-2xl border bg-white p-4 sm:p-6">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-navy">
                {order.customerName || 'Customer'} · {order.customerEmail}
              </p>
              {order.paymentMethod === 'cash' ? (
                <p className="mt-1 text-xs font-semibold text-navy">Cash · school pickup</p>
              ) : null}
              <p className="text-xs text-muted">
                {publicOrderStatusLabel(order.status)} · ${money(order.totalUsd)}
                {order.subtotalUsd > 0 && order.shippingUsd > 0
                  ? ` (items $${money(order.subtotalUsd)} + ship $${money(order.shippingUsd)})`
                  : ''}{' '}
                · paid {order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
              </p>
              {order.trackCode ? (
                <p className="mt-1 font-mono text-xs font-semibold text-navy">
                  Track code {order.trackCode}
                  {order.trackCodeShownAt ? ' · shown to customer' : ' · not shown yet'}
                </p>
              ) : null}
              {order.paymentMethod === 'cash' ? (
                <div className="mt-2 text-xs text-muted">
                  <p>School pickup · no shipping</p>
                  {order.cashRecordedByName ? <p>Cash recorded by {order.cashRecordedByName}</p> : null}
                  {order.agreementName ? (
                    <p>
                      Agreement: {order.agreementName}
                      {order.agreementAt ? ` · ${new Date(order.agreementAt).toLocaleString()}` : ''}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {order.paymentMethod !== 'cash' &&
              (order.shippingName ||
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
                  {!order.shippingLine1 &&
                  !order.shippingCity &&
                  !order.shippingPostal &&
                  (order.shippingUsd > 0 || order.shippingMethod) ? (
                    <p className="text-amber-700">
                      Street missing — try Refresh from Stripe. If it stays empty, check the Checkout
                      session in the Stripe Dashboard.
                    </p>
                  ) : null}
                  {(order.shippingMethod || order.shippingUsd > 0) && (
                    <p className="mt-1 text-muted">
                      {order.shippingMethod || 'Shipping'}
                      {order.shippingUsd > 0 ? ` · $${money(order.shippingUsd)}` : ''}
                    </p>
                  )}
                  {order.trackingNumber || order.shippedAt ? (
                    <p className="mt-1 font-medium text-electric">
                      Shipped
                      {order.trackingNumber
                        ? ` · ${order.trackingCarrier || 'UPS'} ${order.trackingNumber}`
                        : ''}
                    </p>
                  ) : null}
                </div>
              )}
              {order.pendingRefundRequest ? (
                <p className="mt-2 text-xs text-amber-800">
                  Customer refund request: {order.pendingRefundRequest.reason}
                </p>
              ) : null}
              {order.paymentMethod !== 'cash' && order.status !== 'refunded' && !order.shippedAt && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-muted">
                    UPS tracking
                    <input
                      className="mt-1 block rounded-lg border px-2 py-1.5 text-sm text-navy"
                      placeholder="1Z…"
                      value={shipTracking[order.id] || ''}
                      onChange={(e) =>
                        setShipTracking((m) => ({ ...m, [order.id]: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    disabled={shipBusyId === order.id}
                    onClick={() => void shipOrder(order)}
                  >
                    {shipBusyId === order.id ? 'Saving…' : 'Mark shipped'}
                  </button>
                </div>
              )}
              {order.status !== 'refunded' &&
                Boolean(order.shippedAt) &&
                order.status === 'shipped' && (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      disabled={arriveBusyId === order.id}
                      onClick={() => void markArrived(order)}
                    >
                      {arriveBusyId === order.id ? 'Saving…' : 'Mark arrived / delivered'}
                    </button>
                  </div>
                )}
            </div>
            <div className="action-row sm:w-auto">
              {order.paymentMethod !== 'cash' && order.status !== 'refunded' && (
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
            {(order.items ?? []).map((item) => {
              const printerPayUsd = expectedPrinterPayUsd(order, item)
              return (
              <div
                key={item.id}
                className="min-w-0 overflow-hidden rounded-xl border border-slate-100 px-3 py-3 text-sm sm:px-4"
              >
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-navy">
                      {item.designName ?? 'Design'} · {item.colorName} × {item.qty}
                    </p>
                    <p className="text-xs text-muted">
                      SKU {item.sku} · unit ${money(item.unitPriceUsd)} · print cost $
                      {money(item.worstCostUnitUsd)}
                    </p>
                    <p className="text-xs text-muted">
                      Status: {publicPrintStatusLabel(item.printStatus)}
                      {item.assignedPrinterId
                        ? ` · printer ${printers.find((p) => p.id === item.assignedPrinterId)?.ownerLabel ?? item.assignedPrinterId}`
                        : ''}
                    </p>
                    {isPrinted(item.printStatus) ? (
                      <p className="mt-1 text-xs text-electric">
                        Pay printer ${money(item.reimburseUsd)}
                        {item.profitUsd != null
                          ? ` · PrintX profit $${money(item.profitUsd)}`
                          : ''}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted">
                        Printer pay ${money(printerPayUsd)}
                        {printerPayUsd <= 0
                          ? ' (customer paid $0 after discounts)'
                          : ' (capped by amount customer paid)'}
                      </p>
                    )}
                  </div>

                  {order.status !== 'refunded' && item.printStatus === 'unclaimed' && (
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <select
                        className="w-full min-w-0 rounded-lg border px-2 py-1.5 text-sm sm:w-auto"
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
                        className="btn btn-primary btn-compact w-full sm:w-auto"
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
                    !order.shippedAt &&
                    (item.printStatus === 'claimed' || isPrinted(item.printStatus)) && (
                      <div className="action-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={stlBusyId === item.id}
                          onClick={() => {
                            setStlBusyId(item.id)
                            setError('')
                            void api.catalog.orders
                              .downloadStl(item.id)
                              .then(() => setError(''))
                              .catch((e) =>
                                setError(e instanceof Error ? e.message : 'STL download failed'),
                              )
                              .finally(() => setStlBusyId(null))
                          }}
                        >
                          {stlBusyId === item.id
                            ? 'Downloading…'
                            : (item.filamentColorIds?.length || 0) > 1
                              ? 'Download STLs'
                              : 'Download STL'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={gcodeBusyId === item.id}
                          onClick={() => {
                            setGcodeBusyId(item.id)
                            setError(
                              'Preparing G-code (usually under a few minutes). Leave this tab open.',
                            )
                            void api.catalog.orders
                              .downloadGcode(item.id)
                              .then(() => setError(''))
                              .catch((e) =>
                                setError(e instanceof Error ? e.message : 'G-code download failed'),
                              )
                              .finally(() => setGcodeBusyId(null))
                          }}
                        >
                          {gcodeBusyId === item.id
                            ? 'Slicing…'
                            : (item.filamentColorIds?.length || 0) > 1
                              ? 'Download G-codes'
                              : 'Download G-code'}
                        </button>
                        {item.printStatus === 'claimed' && (
                          <button
                            type="button"
                            className="btn btn-primary btn-compact col-span-2 sm:col-span-1"
                            onClick={() =>
                              void api.catalog.orders
                                .complete(item.id)
                                .then(() => load())
                                .catch((e) =>
                                  setError(e instanceof Error ? e.message : 'Complete failed'),
                                )
                            }
                          >
                            Mark printed
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
              )
            })}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={Boolean(pendingRefund)}
        title="Refund order?"
        message={
          pendingRefund
            ? `Refund $${money(pendingRefund.totalUsd)} to ${
                pendingRefund.customerName || pendingRefund.customerEmail || 'this customer'
              }? Money returns through Stripe to their original payment method.`
            : ''
        }
        confirmLabel="Refund"
        cancelLabel="Cancel"
        danger
        busy={refundBusyId === pendingRefund?.id}
        onCancel={() => {
          if (refundBusyId !== pendingRefund?.id) setPendingRefund(null)
        }}
        onConfirm={() => void confirmRefundOrder()}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteOrder)}
        title="Delete order?"
        message={
          pendingDeleteOrder
            ? pendingDeleteOrder.status === 'refunded'
              ? `Delete order for ${
                  pendingDeleteOrder.customerName ||
                  pendingDeleteOrder.customerEmail ||
                  'this order'
                }? This removes it from the portal permanently.`
              : `Delete order for ${
                  pendingDeleteOrder.customerName ||
                  pendingDeleteOrder.customerEmail ||
                  'this order'
                } ($${money(pendingDeleteOrder.totalUsd)}, ${pendingDeleteOrder.status})? This does not refund Stripe — refund first if needed. Removes the order from the portal permanently.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleteBusyId === pendingDeleteOrder?.id}
        onCancel={() => {
          if (deleteBusyId !== pendingDeleteOrder?.id) setPendingDeleteOrder(null)
        }}
        onConfirm={() => void confirmDeleteOrder()}
      />

      <ConfirmDialog
        open={Boolean(pendingDeclineRefund)}
        title="Decline refund request?"
        message="Add a short note for the customer (optional)."
        confirmLabel="Decline"
        cancelLabel="Cancel"
        danger
        busy={declineBusy}
        prompt={{
          label: 'Note for customer',
          placeholder: 'e.g. already printed/shipped',
          defaultValue: '',
        }}
        onCancel={() => {
          if (!declineBusy) setPendingDeclineRefund(null)
        }}
        onConfirm={(note) => void confirmDeclineRefund(note)}
      />
    </div>
  )
}
