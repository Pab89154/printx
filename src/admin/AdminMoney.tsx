import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAdminAuth } from '../context/AdminAuthContext'
import type { MoneySummaryDto } from '../types/catalog'

function currentUtcMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function personLabel(p: { displayName: string | null; email: string }): string {
  return p.displayName?.trim() || p.email.split('@')[0] || p.email || 'Printer'
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

  const owedToMeUsd = useMemo(() => {
    if (!data || !email) return 0
    const me = email.trim().toLowerCase()
    const mine = data.owedByPerson.find((p) => p.email.trim().toLowerCase() === me)
    return mine?.totalOwedUsd ?? 0
  }, [data, email])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Money</h1>
          <p className="mt-1 text-sm text-muted">
            Stripe earnings and print costs (no profit share). Each month&apos;s owed resets for the
            new month; older months stay in history.
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
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                From Stripe
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">
                ${data.earnings.totalUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Shop ${data.earnings.shopUsd.toFixed(2)} · Custom $
                {data.earnings.customUsd.toFixed(2)}
              </p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Owed to me
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">${owedToMeUsd.toFixed(2)}</p>
              <p className="mt-1 text-xs text-muted">This month · worst-case cost</p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Business kept
              </p>
              <p className="mt-2 text-2xl font-bold text-electric">
                ${data.businessKeptUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">Earnings minus all print costs</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                This year · Stripe
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">
                ${data.totals.year.stripeUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">{data.totals.year.year} UTC</p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                All time · Stripe
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">
                ${data.totals.allTime.stripeUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">Every paid shop + custom order</p>
            </div>
            <div className="rounded-2xl border bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Owed to me · totals
              </p>
              <p className="mt-2 text-2xl font-bold text-navy">
                ${data.totals.allTime.owedToMeUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Year ${data.totals.year.owedToMeUsd.toFixed(2)} · all time $
                {data.totals.allTime.owedToMeUsd.toFixed(2)}
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
                      <th className="py-2 pr-3 font-semibold">Stripe</th>
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
                  Everyone who finished prints in {formatMonthLabel(data.month)}.
                </p>
              </div>
              <p className="text-right">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Total owed
                </span>
                <span className="text-2xl font-bold tabular-nums text-electric">
                  ${data.reimbursementsTotalUsd.toFixed(2)}
                </span>
              </p>
            </div>

            {data.owedByPerson.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No printer reimbursements this month.</p>
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
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-bold text-navy">Stripe payments</h2>
            <p className="mt-1 text-sm text-muted">
              Paid shop checkouts and custom prints in {formatMonthLabel(data.month)}.
            </p>

            {paymentLines.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No Stripe payments this month.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {paymentLines.map((line) => (
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
                      </p>
                    </div>
                    <p className="text-base font-bold tabular-nums text-electric">
                      ${line.amountUsd.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
