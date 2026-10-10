import { useEffect, useState } from 'react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import type { OrderDto, PrinterDto } from '../types/catalog'

export function AdminOrders() {
  const { email } = useAdminAuth()
  const [orders, setOrders] = useState<OrderDto[]>([])
  const [printers, setPrinters] = useState<PrinterDto[]>([])
  const [error, setError] = useState('')
  const [claimPrinter, setClaimPrinter] = useState<Record<string, string>>({})

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Orders</h1>
        <p className="mt-1 text-sm text-muted">
          Claim a paid item with your printer. When done, you get the worst-case cost; leftover profit splits equally among admins.
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
                {order.status} · ${order.totalUsd.toFixed(2)} · paid{' '}
                {order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
              </p>
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
                        Reimburse ${item.reimburseUsd?.toFixed(2)} · profit pool $
                        {item.profitUsd?.toFixed(2)}
                      </p>
                    )}
                  </div>

                  {item.printStatus === 'unclaimed' && (
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
                        Claim as {email?.split('@')[0]}
                      </button>
                    </div>
                  )}

                  {item.printStatus === 'claimed' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
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
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
