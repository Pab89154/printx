import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCart } from '../context/CartContext'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

export function Cart() {
  const { lines, setQty, remove, subtotal, clear } = useCart()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function checkout() {
    setBusy(true)
    setError('')
    try {
      const { url } = await api.catalog.checkout({
        customerName: name,
        customerEmail: email,
        items: lines.map((l) => ({
          designId: l.designId,
          colorId: l.colorId,
          qty: l.qty,
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
                  key={`${l.designId}-${l.colorId}`}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4"
                >
                  {l.imageUrl ? (
                    <img src={l.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-navy">{l.name}</p>
                    <p className="text-sm text-muted">
                      <span
                        className="mr-1 inline-block h-2.5 w-2.5 rounded-full border align-middle"
                        style={{ background: l.colorHex }}
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
                    onChange={(e) => setQty(l.designId, l.colorId, Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={() => remove(l.designId, l.colorId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-right text-lg font-bold text-navy">
              Subtotal ${subtotal.toFixed(2)}
            </p>

            <div className="mt-8 grid gap-3 rounded-2xl border bg-white p-6 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Name
                <input
                  required
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Email
                <input
                  required
                  type="email"
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              className="btn btn-primary mt-6 w-full"
              disabled={busy || !email}
              onClick={() => void checkout()}
            >
              {busy ? 'Redirecting to Stripe…' : 'Pay with Stripe'}
            </button>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
