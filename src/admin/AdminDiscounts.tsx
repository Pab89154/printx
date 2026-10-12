import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'

type Discount = {
  id: string
  code: string
  kind: string
  percentOff: number | null
  amountOffCents: number | null
  maxRedemptions: number | null
  active: boolean
  createdAt: string
}

export function AdminDiscounts() {
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<'percent' | 'amount'>('percent')
  const [percentOff, setPercentOff] = useState('10')
  const [amountDollars, setAmountDollars] = useState('5')
  const [maxRedemptions, setMaxRedemptions] = useState('')

  async function load() {
    const data = await api.catalog.orders.discounts.list()
    setDiscounts(data.discounts)
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.catalog.orders.discounts.create({
        code,
        kind,
        percentOff: kind === 'percent' ? Number(percentOff) : undefined,
        amountOffCents: kind === 'amount' ? Math.round(Number(amountDollars) * 100) : undefined,
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
      })
      setCode('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(id: string) {
    setError('')
    try {
      await api.catalog.orders.discounts.deactivate(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deactivate failed')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Discounts</h1>
        <p className="mt-1 text-sm text-muted">
          Codes appear on Stripe Checkout. Customers enter them when paying.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={(e) => void onCreate(e)} className="rounded-2xl border bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-navy">New promo code</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Code
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              minLength={3}
              placeholder="SAVE10"
            />
          </label>
          <label className="text-sm">
            Type
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}
            >
              <option value="percent">Percent off</option>
              <option value="amount">Fixed $ off</option>
            </select>
          </label>
          {kind === 'percent' ? (
            <label className="text-sm">
              Percent
              <input
                type="number"
                min={1}
                max={100}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={percentOff}
                onChange={(e) => setPercentOff(e.target.value)}
              />
            </label>
          ) : (
            <label className="text-sm">
              Amount (USD)
              <input
                type="number"
                min={0.5}
                step={0.01}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
              />
            </label>
          )}
          <label className="text-sm">
            Max redemptions (optional)
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="Unlimited"
            />
          </label>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create in Stripe'}
        </button>
      </form>

      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold text-navy">Codes</h2>
        {discounts.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No discounts yet.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {discounts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-semibold text-navy">{d.code}</p>
                  <p className="text-xs text-muted">
                    {d.kind === 'percent'
                      ? `${d.percentOff}% off`
                      : `$${((d.amountOffCents || 0) / 100).toFixed(2)} off`}
                    {d.maxRedemptions ? ` · max ${d.maxRedemptions}` : ''}
                    {' · '}
                    {d.active ? 'active' : 'inactive'}
                  </p>
                </div>
                {d.active && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact text-red-600"
                    onClick={() => void deactivate(d.id)}
                  >
                    Deactivate
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
