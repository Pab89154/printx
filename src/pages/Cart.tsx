import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { colorSwatchStyle } from '../../shared/colors'
import { CUSTOMER_ACCOUNTS_ENABLED } from '../../shared/customerAccounts'
import { useCart } from '../context/CartContext'
import { useCustomerAuth } from '../context/CustomerAuthContext'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

export function Cart() {
  const { lines, setQty, remove, subtotal, clear } = useCart()
  const { customer, loading } = useCustomerAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const signedIn = CUSTOMER_ACCOUNTS_ENABLED && Boolean(customer)

  async function checkout() {
    setBusy(true)
    setError('')
    try {
      const { url } = await api.catalog.checkout({
        promoCode: promoCode.trim() || undefined,
        items: lines.map((l) => ({
          designId: l.designId,
          colorId: l.colorId,
          qty: l.qty,
          ...(l.filamentColorIds?.length ? { filamentColorIds: l.filamentColorIds } : {}),
        })),
      })
      clear()
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/shop" className="text-sm text-electric hover:underline">
          ← Continue shopping
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold text-navy">Cart</h1>

        {lines.length === 0 ? (
          <p className="mt-8 text-muted">Your cart is empty.</p>
        ) : (
          <>
            <ul className="mt-8 space-y-4">
              {lines.map((l) => (
                <li
                  key={`${l.designId}-${l.colorId}-${(l.filamentColorIds ?? []).join('|')}`}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4"
                >
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-100 bg-slate-50"
                    title={l.colorName}
                  >
                    <span
                      className="h-8 w-8 rounded-full border border-slate-200 shadow-sm"
                      style={colorSwatchStyle({ id: l.colorId, hex: l.colorHex })}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-navy">{l.name}</p>
                    <p className="text-sm text-muted">
                      <span
                        className="mr-1 inline-block h-2.5 w-2.5 rounded-full border align-middle"
                        style={colorSwatchStyle({ id: l.colorId, hex: l.colorHex })}
                      />
                      {l.colorName} · ${l.unitPrice.toFixed(2)}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="w-16 rounded-lg border px-2 py-1 text-sm"
                    value={l.qty}
                    onChange={(e) =>
                      setQty(l.designId, l.colorId, Number(e.target.value), l.filamentColorIds)
                    }
                  />
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={() => remove(l.designId, l.colorId, l.filamentColorIds)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-right text-lg font-bold text-navy">
              Subtotal ${subtotal.toFixed(2)}
            </p>

            <label className="mt-6 block text-sm text-navy">
              Promo code
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 uppercase"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
              />
            </label>

            <p className="mt-4 text-sm text-muted">
              Promo codes are entered here only — not on Stripe Checkout.
            </p>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              className="btn btn-primary mt-6 w-full"
              disabled={busy || (CUSTOMER_ACCOUNTS_ENABLED && loading)}
              onClick={() => void checkout()}
            >
              {busy ? 'Redirecting…' : signedIn ? 'Checkout' : 'Checkout as guest'}
            </button>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
