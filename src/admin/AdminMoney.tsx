import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAdminAuth } from '../context/AdminAuthContext'
import type { MoneySummaryDto } from '../types/catalog'

function currentUtcMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function personLabel(p: { displayName: string | null; email: string }): string {
  const named = p.displayName?.trim()
  if (named) return named
  const local = (p.email.split('@')[0] || '').trim()
  if (!local) return p.email || 'Printer'
  // court.padilla → Court Padilla
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function AdminMoney() {
  const { email } = useAdminAuth()
  const [month, setMonth] = useState(currentUtcMonth)
  const [data, setData] = useState<MoneySummaryDto | null>(null)
  const [error, setError] = useState('')
  const [busyUserId, setBusyUserId] = useState('')
  const [busyShipKey, setBusyShipKey] = useState('')

  async function load(nextMonth = month) {
    setError('')
    const summary = await api.catalog.money.get(nextMonth)
    setData(summary)
  }

  useEffect(() => {
    let cancelled = false
    void api.catalog.money
      .get(month)
      .then((summary) => {
        if (!cancelled) {
          setData(summary)
          setError('')
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load money')
      })
    return () => {
      cancelled = true
    }
  }, [month])

  const paymentLines = useMemo(() => {
    if (!data) return []
    return [...data.earnings.shopOrders, ...data.earnings.customOrders].sort((a, b) =>
      String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? '')),
    )
  }, [data])

  const shippingLines = useMemo(() => {
    return paymentLines.filter((line) => (line.shippingUsd ?? 0) > 0)
  }, [paymentLines])

  const shippingKeptAsProfitUsd = data?.shippingKeptAsProfitUsd ?? 0

  async function setShippingToProfit(line: {
    id: string
    kind: 'shop' | 'custom'
  }, undo: boolean) {
    const key = `${line.kind}-${line.id}`
    setBusyShipKey(key)
    setError('')
    try {
      await api.catalog.money.shippingToProfit({ kind: line.kind, id: line.id, undo })
      await load(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update shipping')
    } finally {
      setBusyShipKey('')
    }
  }

  const printPayUsd = useMemo(() => {
    if (!data) return 0
    if (data.myPrintPayUsd != null) return data.myPrintPayUsd
    if (!email) return 0
    const me = email.trim().toLowerCase()
    const mine = data.owedByPerson.find((p) => p.email.trim().toLowerCase() === me)
    return mine?.totalOwedUsd ?? 0
  }, [data, email])

  const owedToMeUsd = useMemo(() => {
    if (!data) return 0
    return data.youEarnTotalUsd ?? printPayUsd + (data.myProfitShareUsd ?? 0)
  }, [data, printPayUsd])

  const shippingTotalUsd = data?.shippingTotalUsd ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Money</h1>
          <p className="mt-1 text-sm text-muted">
            Owed to you = print pay + your equal share of PrintX profit. Earned = items + shipping
            moved to profit − Stripe fees (2.9% + $0.30). Shipping stays for UPS unless you move it
            to profit.
          </p>
        </div>
        <label className="text-sm font-semibold text-navy">
          Month
          <input
            type="month"
            className="mt-1 block rounded-xl border px-3 py-2 font-normal"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentUtcMonth())}
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-electric/30 bg-electric/5 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Owed to me
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">${owedToMeUsd.toFixed(2)}</p>
              <p className="mt-1 text-xs text-muted">
                Print pay ${printPayUsd.toFixed(2)} + profit share $
                {(data.myProfitShareUsd ?? 0).toFixed(2)}
                {data.partnerCount ? ` · split ${data.partnerCount} ways` : ''}
              </p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Print pay
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">${printPayUsd.toFixed(2)}</p>
              <p className="mt-1 text-xs text-muted">
                Claimed/printed pay + your share of unclaimed print costs
              </p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                PrintX profit
              </p>
              <p className="mt-2 text-2xl font-bold text-electric">
                ${data.businessKeptUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">
                After print pay + Stripe fees · $
                {(data.myProfitShareUsd ?? 0).toFixed(2)} each
                {data.partnerCount ? ` · split ${data.partnerCount} ways` : ''}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800/80">
                Shipping · for UPS
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">${shippingTotalUsd.toFixed(2)}</p>
              <p className="mt-1 text-xs text-muted">
                Pass-through for labels
                {shippingKeptAsProfitUsd > 0
                  ? ` · $${shippingKeptAsProfitUsd.toFixed(2)} moved to profit`
                  : ''}
              </p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Stripe fees
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">
                ${(data.stripeFeesUsd ?? 0).toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">2.9% + $0.30 per successful charge</p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                This year · earned
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">
                ${data.totals.year.stripeUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.totals.year.year} UTC · after Stripe · items + shipping in profit
              </p>
            </div>
          </div>

          <section className="rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-bold text-navy">Month history</h2>
            <p className="mt-1 text-sm text-muted">
              Tap a month to open its breakdown. Settled months stay listed — they never disappear.
            </p>
            {data.monthHistory.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No months with earnings or owed costs yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-3 font-semibold">Month</th>
                      <th className="py-2 pr-3 font-semibold">Net earned</th>
                      <th className="py-2 pr-3 font-semibold">Owed to me</th>
                      <th className="py-2 pr-3 font-semibold">All printers</th>
                      <th className="py-2 font-semibold">Settled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthHistory.map((row) => {
                      const selected = row.month === data.month
                      return (
                        <tr
                          key={row.month}
                          className={`cursor-pointer border-b border-slate-100 transition hover:bg-surface ${
                            selected ? 'bg-electric/5' : ''
                          }`}
                          onClick={() => setMonth(row.month)}
                        >
                          <td className="py-3 pr-3 font-medium text-navy">
                            {formatMonthLabel(row.month)}
                            {selected ? (
                              <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-electric">
                                Viewing
                              </span>
                            ) : null}
                          </td>
                          <td className="py-3 pr-3 tabular-nums">${row.stripeUsd.toFixed(2)}</td>
                          <td className="py-3 pr-3 tabular-nums">${row.owedToMeUsd.toFixed(2)}</td>
                          <td className="py-3 pr-3 tabular-nums">
                            ${row.reimbursementsUsd.toFixed(2)}
                          </td>
                          <td className="py-3 text-xs">
                            {row.mySettlement ? (
                              <span className="text-emerald-700">
                                ${row.mySettlement.amountUsd.toFixed(2)} ·{' '}
                                {new Date(row.mySettlement.markedPaidAt).toLocaleDateString()}
                              </span>
                            ) : row.owedToMeUsd > 0 ? (
                              <span className="text-amber-700">Not settled</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-navy">Owed by person</h2>
                <p className="mt-1 text-sm text-muted">
                  Print pay + profit share for {formatMonthLabel(data.month)}.
                </p>
              </div>
              <p className="text-right">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Total owed
                </span>
                <span className="text-2xl font-bold tabular-nums text-electric">
                  $
                  {data.owedByPerson
                    .reduce((sum, p) => sum + p.totalOwedUsd, 0)
                    .toFixed(2)}
                </span>
              </p>
            </div>

            {data.owedByPerson.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Nothing owed this month.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {data.owedByPerson.map((person) => (
                  <div key={person.userId} className="rounded-xl border border-slate-100 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-navy">{personLabel(person)}</p>
                        <p className="text-xs text-muted">{person.email}</p>
                        <p className="mt-1 text-lg font-bold text-electric">
                          ${person.totalOwedUsd.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted">
                          Print pay ${(person.printPayUsd ?? person.totalOwedUsd).toFixed(2)}
                          {(person.profitShareUsd ?? 0) > 0
                            ? ` + share $${(person.profitShareUsd ?? 0).toFixed(2)}`
                            : ''}
                        </p>
                        {person.settlement ? (
                          <p className="mt-1 text-xs text-emerald-700">
                            Marked paid {new Date(person.settlement.markedPaidAt).toLocaleString()}
                            {person.settlement.note ? ` · ${person.settlement.note}` : ''}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-amber-700">Not settled yet</p>
                        )}
                      </div>
                      {data.canSettle && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={busyUserId === person.userId || person.totalOwedUsd <= 0}
                          onClick={() => {
                            setBusyUserId(person.userId)
                            void api.catalog.money
                              .settle({ userId: person.userId, yearMonth: data.month })
                              .then(() => load(data.month))
                              .catch((e) =>
                                setError(e instanceof Error ? e.message : 'Settle failed'),
                              )
                              .finally(() => setBusyUserId(''))
                          }}
                        >
                          {person.settlement ? 'Update settled' : 'Mark settled'}
                        </button>
                      )}
                    </div>
                    {person.lines.length > 0 ? (
                      <ul className="mt-3 space-y-1.5 text-xs text-muted">
                        {person.lines.map((line) => (
                          <li key={line.id} className="flex flex-wrap justify-between gap-2">
                            <span>
                              {line.designName ?? 'Item'}
                              {line.colorName ? ` · ${line.colorName}` : ''}
                              {line.qty != null ? ` × ${line.qty}` : ''}
                            </span>
                            <span className="tabular-nums text-navy">${line.amountUsd.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (person.profitShareUsd ?? 0) > 0 ? (
                      <p className="mt-3 text-xs text-muted">Profit share only — no print pay lines.</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-navy">Shipping money</h2>
                <p className="mt-1 text-sm text-muted">
                  Held for UPS by default. Tap <span className="font-medium text-navy">Add to profit</span>{' '}
                  on an order if that shipping should count as PrintX profit instead.
                </p>
              </div>
              <p className="text-right">
                <span className="block text-xs font-semibold uppercase tracking-wide text-amber-800/80">
                  For UPS
                </span>
                <span className="text-2xl font-bold tabular-nums text-navy">
                  ${shippingTotalUsd.toFixed(2)}
                </span>
                {shippingKeptAsProfitUsd > 0 ? (
                  <span className="mt-1 block text-xs text-electric">
                    +${shippingKeptAsProfitUsd.toFixed(2)} in profit
                  </span>
                ) : null}
              </p>
            </div>

            {shippingLines.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No shipping collected this month.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {shippingLines.map((line) => {
                  const shipKey = `${line.kind}-${line.id}`
                  const asProfit = Boolean(line.shippingToProfitAt)
                  return (
                    <div
                      key={`ship-${shipKey}`}
                      className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                        asProfit ? 'border-electric/30' : 'border-amber-100'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-navy">
                          {line.label}
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900/70">
                            {line.kind === 'shop' ? 'Shop' : 'Custom'}
                          </span>
                          {asProfit ? (
                            <span className="ml-2 rounded-full bg-electric/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-electric">
                              In profit
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted">
                          {line.email || '—'}
                          {line.paidAt ? ` · ${new Date(line.paidAt).toLocaleString()}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <p className="text-base font-bold tabular-nums text-navy">
                          ${(line.shippingUsd ?? 0).toFixed(2)}
                        </p>
                        <button
                          type="button"
                          className={`btn btn-compact ${asProfit ? 'btn-ghost' : 'btn-secondary'}`}
                          disabled={busyShipKey === shipKey}
                          onClick={() => void setShippingToProfit(line, asProfit)}
                        >
                          {busyShipKey === shipKey
                            ? 'Saving…'
                            : asProfit
                              ? 'Undo → UPS'
                              : 'Add to profit'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-bold text-navy">Payments</h2>
            <p className="mt-1 text-sm text-muted">
              Net earned per checkout in {formatMonthLabel(data.month)}: items + shipping moved to
              profit, minus Stripe fees. UPS shipping is not counted.
            </p>

            {paymentLines.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No Stripe payments this month.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {paymentLines.map((line) => {
                  const charge =
                    line.chargeUsd ??
                    Math.round((line.amountUsd + (line.shippingUsd ?? 0)) * 100) / 100
                  const fee = line.stripeFeeUsd ?? 0
                  const ship = line.shippingUsd ?? 0
                  const shipKept = line.shippingToProfitAt ? ship : 0
                  const net =
                    Math.round(Math.max(0, line.amountUsd + shipKept - fee) * 100) / 100
                  return (
                    <div
                      key={`${line.kind}-${line.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-navy">
                          {line.label}
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {line.kind === 'shop' ? 'Shop' : 'Custom'}
                          </span>
                        </p>
                        <p className="text-xs text-muted">
                          {line.email || '—'}
                          {line.paidAt ? ` · ${new Date(line.paidAt).toLocaleString()}` : ''}
                          {` · charged $${charge.toFixed(2)}`}
                          {` · items $${line.amountUsd.toFixed(2)}`}
                          {ship > 0
                            ? line.shippingToProfitAt
                              ? ` · shipping $${ship.toFixed(2)} in profit`
                              : ` · shipping $${ship.toFixed(2)} for UPS`
                            : ''}
                          {fee > 0 ? ` · Stripe fee $${fee.toFixed(2)}` : ''}
                        </p>
                      </div>
                      <p className="text-base font-bold tabular-nums text-electric">
                        ${net.toFixed(2)}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
