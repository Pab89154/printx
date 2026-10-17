import { useEffect, useState, type FormEvent } from 'react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import { ConfirmDialog } from '../components/ConfirmDialog'

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
  | 'school_pickup'

const MAIN_ADMIN_KINDS: DiscountKind[] = [
  'free_shipping',
  'percent_and_shipping',
  'amount_and_shipping',
  'school_pickup',
]

function asDiscountKind(raw: string): DiscountKind {
  if (
    raw === 'amount' ||
    raw === 'free_shipping' ||
    raw === 'percent_and_shipping' ||
    raw === 'amount_and_shipping' ||
    raw === 'school_pickup'
  ) {
    return raw
  }
  return 'percent'
}

function discountLabel(d: Pick<Discount, 'kind' | 'percentOff' | 'amountOffCents'>) {
  if (d.kind === 'school_pickup') return 'School pickup (classmates, cash only)'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<DiscountKind>('percent')
  const [percentOff, setPercentOff] = useState('10')
  const [amountDollars, setAmountDollars] = useState('5')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [visibleToCustomers, setVisibleToCustomers] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; code: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  function resetForm() {
    setEditingId(null)
    setCode('')
    setKind('percent')
    setPercentOff('10')
    setAmountDollars('5')
    setMaxRedemptions('')
    setVisibleToCustomers(false)
  }

  function startEdit(d: Discount) {
    setError('')
    setEditingId(d.id)
    setCode(d.code)
    const nextKind = asDiscountKind(d.kind)
    setKind(
      !isMainAdmin && MAIN_ADMIN_KINDS.includes(nextKind) ? 'percent' : nextKind,
    )
    setPercentOff(d.percentOff != null ? String(d.percentOff) : '10')
    setAmountDollars(
      d.amountOffCents != null ? (d.amountOffCents / 100).toFixed(2) : '5',
    )
    setMaxRedemptions(d.maxRedemptions != null ? String(d.maxRedemptions) : '')
    setVisibleToCustomers(d.visibleToCustomers)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const usesPercent = kind === 'percent' || kind === 'percent_and_shipping'
      const usesAmount = kind === 'amount' || kind === 'amount_and_shipping'
      const body = {
        code,
        kind,
        percentOff: usesPercent ? Number(percentOff) : undefined,
        amountOffCents: usesAmount ? Math.round(Number(amountDollars) * 100) : undefined,
        maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
        visibleToCustomers: kind === 'school_pickup' ? false : visibleToCustomers,
      }
      if (editingId) {
        await api.catalog.orders.discounts.update(editingId, body)
      } else {
        await api.catalog.orders.discounts.create(body)
      }
      resetForm()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId ? 'Update failed' : 'Create failed')
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

  async function reactivate(id: string) {
    setError('')
    try {
      await api.catalog.orders.discounts.reactivate(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reactivate failed')
    }
  }

  async function confirmRemove() {
    if (!pendingDelete) return
    setDeleting(true)
    setError('')
    try {
      await api.catalog.orders.discounts.remove(pendingDelete.id)
      if (editingId === pendingDelete.id) resetForm()
      setPendingDelete(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  async function toggleAccountVisibility(id: string, next: boolean) {
    setError('')
    try {
      await api.catalog.orders.discounts.setVisibility(id, next)
      if (editingId === id) setVisibleToCustomers(next)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update visibility')
    }
  }

  const usesPercent = kind === 'percent' || kind === 'percent_and_shipping'
  const usesAmount = kind === 'amount' || kind === 'amount_and_shipping'
  const editing = Boolean(editingId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Discounts</h1>
        <p className="mt-1 text-sm text-muted">
          Codes work on Checkout/cart. They stay hidden from customer accounts unless you check “Show
          on customer account.” Item+shipping codes should be entered on the cart.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={(e) => void onSubmit(e)} className="rounded-2xl border bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-navy">
            {editing ? `Edit promo code` : 'New promo code'}
          </p>
          {editing ? (
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => resetForm()}>
              Cancel edit
            </button>
          ) : null}
        </div>
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
                  <option value="school_pickup">School pickup (classmates, cash only)</option>
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
          ) : kind === 'school_pickup' ? (
            <p className="text-sm text-muted sm:col-span-2">
              Lets a classmate pay cash at school with no shipment and no shipping charge. It does
              not discount the item price and it is not sent to Checkout. Only main admins can
              create these.
            </p>
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
        {kind !== 'school_pickup' ? (
          <label className="flex items-center gap-2 text-sm text-navy">
            <input
              type="checkbox"
              checked={visibleToCustomers}
              onChange={(e) => setVisibleToCustomers(e.target.checked)}
            />
            Show on customer account page (optional — off by default)
          </label>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy
            ? editing
              ? 'Saving…'
              : 'Creating…'
            : editing
              ? 'Save changes'
              : kind === 'school_pickup'
                ? 'Create school pickup code'
                : 'Create in Stripe'}
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
                  <p className="font-semibold text-navy">
                    {d.code}
                    {editingId === d.id ? (
                      <span className="ml-2 text-xs font-medium text-electric">editing</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    {discountLabel(d)}
                    {d.maxRedemptions ? ` · max ${d.maxRedemptions}` : ''}
                    {' · '}
                    {d.visibleToCustomers ? 'on account' : 'checkout only'}
                    {' · '}
                    {d.active ? 'active' : 'inactive'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => startEdit(d)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => void toggleAccountVisibility(d.id, !d.visibleToCustomers)}
                  >
                    {d.visibleToCustomers ? 'Hide from accounts' : 'Show on accounts'}
                  </button>
                  {d.active ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={() => void deactivate(d.id)}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={() => void reactivate(d.id)}
                    >
                      Reactivate
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact text-red-600"
                    onClick={() => setPendingDelete({ id: d.id, code: d.code })}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete promo code?"
        message={
          pendingDelete
            ? `Delete promo code ${pendingDelete.code}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
