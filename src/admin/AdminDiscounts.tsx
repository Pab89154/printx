import { useEffect, useState, type FormEvent } from 'react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'

type Discount = {
  id: string
  code: string
  kind: string
  percentOff: number | null
  amountOffCents: number | null
  maxRedemptions: number | null
  active: boolean
  visibleToCustomers: boolean
  createdAt: string
}

type DiscountKind =
  | 'percent'
  | 'amount'
  | 'free_shipping'
  | 'percent_and_shipping'
  | 'amount_and_shipping'

const MAIN_ADMIN_KINDS: DiscountKind[] = [
  'free_shipping',
  'percent_and_shipping',
  'amount_and_shipping',
]

function discountLabel(d: Pick<Discount, 'kind' | 'percentOff' | 'amountOffCents'>) {
  if (d.kind === 'free_shipping') return 'Free standard shipping'
  if (d.kind === 'percent_and_shipping') return `${d.percentOff}% off + free standard shipping`
  if (d.kind === 'amount_and_shipping') {
    return `$${((d.amountOffCents || 0) / 100).toFixed(2)} off + free standard shipping`
  }
  if (d.kind === 'percent') return `${d.percentOff}% off`
  return `$${((d.amountOffCents || 0) / 100).toFixed(2)} off`
}

export function AdminDiscounts() {
  const { isMainAdmin } = useAdminAuth()
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<DiscountKind>('percent')
  const [percentOff, setPercentOff] = useState('10')
  const [amountDollars, setAmountDollars] = useState('5')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [visibleToCustomers, setVisibleToCustomers] = useState(true)

  async function load() {
    const data = await api.catalog.orders.discounts.list()
    setDiscounts(data.discounts)
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  useEffect(() => {
    if (!isMainAdmin && MAIN_ADMIN_KINDS.includes(kind)) setKind('percent')
  }, [isMainAdmin, kind])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const usesPercent = kind === 'percent' || kind === 'percent_and_shipping'
      const usesAmount = kind === 'amount' || kind === 'amount_and_shipping'
      await api.catalog.orders.discounts.create({
        code,
        kind,
        percentOff: usesPercent ? Number(percentOff) : undefined,
        amountOffCents: usesAmount ? Math.round(Number(amountDollars) * 100) : undefined,
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
        visibleToCustomers,
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

  const usesPercent = kind === 'percent' || kind === 'percent_and_shipping'
  const usesAmount = kind === 'amount' || kind === 'amount_and_shipping'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Discounts</h1>
        <p className="mt-1 text-sm text-muted">
          Codes appear on Stripe Checkout. Item+shipping codes should be entered on the cart so both
          discounts apply. Customers with accounts can also see codes marked visible.
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
              onChange={(e) => setKind(e.target.value as DiscountKind)}
            >
              <option value="percent">Percent off</option>
              <option value="amount">Fixed $ off</option>
              {isMainAdmin ? (
                <>
                  <option value="free_shipping">Free standard shipping</option>
                  <option value="percent_and_shipping">% off + free standard shipping</option>
                  <option value="amount_and_shipping">$ off + free standard shipping</option>
                </>
              ) : null}
            </select>
          </label>
          {usesPercent ? (
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
          ) : usesAmount ? (
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
          ) : (
            <p className="text-sm text-muted sm:col-span-2">
              Credits the standard shipping rate at Checkout. Only main admins can create these.
            </p>
          )}
          {(kind === 'percent_and_shipping' || kind === 'amount_and_shipping') && (
            <p className="text-sm text-muted sm:col-span-2">
              Discounts items and waives Standard shipping when the code is entered on the cart
              before checkout. Priority/Express stay paid.
            </p>
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
        <label className="flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={visibleToCustomers}
            onChange={(e) => setVisibleToCustomers(e.target.checked)}
          />
          Show on customer account page
        </label>
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
                    {discountLabel(d)}
                    {d.maxRedemptions ? ` · max ${d.maxRedemptions}` : ''}
                    {' · '}
                    {d.visibleToCustomers ? 'on account' : 'checkout only'}
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
