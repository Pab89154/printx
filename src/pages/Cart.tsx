import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { colorSwatchStyle } from '../../shared/colors'
import {
  CASH_PAYMENT_LABEL,
  CASH_TERMS_BODY,
  CASH_TERMS_LABEL,
  cashPaymentDetail,
  cashSaleItemNotice,
} from '../../shared/checkoutConsent'
import { CUSTOMER_ACCOUNTS_ENABLED } from '../../shared/customerAccounts'
import { useCart } from '../context/CartContext'
import { useCustomerAuth } from '../context/CustomerAuthContext'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

export function Cart() {
  const { lines, setQty, remove, subtotal, clear } = useCart()
  const { loading, customer } = useCustomerAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [cashCodeInput, setCashCodeInput] = useState('')
  const [schoolCode, setSchoolCode] = useState('')
  const [schoolError, setSchoolError] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [agreePay, setAgreePay] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    if (customer?.displayName && !customerName) setCustomerName(customer.displayName)
  }, [customer?.displayName, customerName])

  useEffect(() => {
    const trimmed = cashCodeInput.trim()
    setSchoolCode('')
    setSchoolError('')
    setAgreePay(false)
    setAgreeTerms(false)
    if (trimmed.length < 3) return
    const handle = window.setTimeout(() => {
      void api.catalog
        .schoolPickupCode(trimmed)
        .then((res) => {
          if (res.schoolPickup && res.code) {
            setSchoolCode(res.code)
            setSchoolError('')
          } else {
            setSchoolCode('')
            setSchoolError(
              res.error ||
                'That is not a school pickup code. Discount codes go in the promo box above.',
            )
          }
        })
        .catch((e) => {
          setSchoolCode('')
          setSchoolError(e instanceof Error ? e.message : 'Could not check that code')
        })
    }, 300)
    return () => window.clearTimeout(handle)
  }, [cashCodeInput])

  const notice = cashSaleItemNotice(
    lines.map((l) => ({
      name: l.name,
      color: l.colorName,
      qty: l.qty,
      lineUsd: Math.round(l.unitPrice * l.qty * 100) / 100,
    })),
    subtotal,
  )
  const nameOk = customerName.trim().length >= 3 && customerName.trim().includes(' ')
  const cashReady = Boolean(schoolCode && nameOk && agreePay && agreeTerms && subtotal > 0)

  function cartItems() {
    return lines.map((l) => ({
      designId: l.designId,
      colorId: l.colorId,
      qty: l.qty,
      ...(l.filamentColorIds?.length ? { filamentColorIds: l.filamentColorIds } : {}),
    }))
  }

  async function checkout() {
    setBusy(true)
    setError('')
    try {
      const { url } = await api.catalog.checkout({
        promoCode: promoCode.trim() || undefined,
        items: cartItems(),
      })
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed')
      setBusy(false)
    }
  }

  async function cashCheckout() {
    if (!cashReady) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      const res = await api.catalog.cashCheckout({
        code: schoolCode,
        promoCode: promoCode.trim() || undefined,
        customerName: customerName.trim(),
        agreeToPay: true,
        agreeToTerms: true,
        items: cartItems(),
      })
      clear()
      setDone(
        res.discountUsd && res.discountUsd > 0
          ? `Order placed for $${res.totalUsd.toFixed(2)} (promo ${res.promoCode} saved $${res.discountUsd.toFixed(2)}). School pickup, no shipping.`
          : `Order placed for $${res.totalUsd.toFixed(2)}. School pickup, no shipping.`,
      )
      setPromoCode('')
      setCashCodeInput('')
      setSchoolCode('')
      setAgreePay(false)
      setAgreeTerms(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the cash sale')
    } finally {
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

        {done ? <p className="mt-6 text-sm text-emerald-700">{done}</p> : null}

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
              {schoolCode ? `School pickup · $${subtotal.toFixed(2)}` : `Subtotal $${subtotal.toFixed(2)}`}
            </p>
            {schoolCode ? (
              <p className="mt-1 text-right text-sm text-muted">No shipping. Handed over at school.</p>
            ) : null}

            <label className="mt-6 block text-sm text-navy">
              Promo code
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 uppercase"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Optional — only one promo code"
                autoComplete="off"
              />
            </label>
            <label className="mt-4 block text-sm text-navy">
              School pickup code (pay cash)
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 uppercase"
                value={cashCodeInput}
                onChange={(e) => setCashCodeInput(e.target.value)}
                placeholder="Optional — pay cash when you pick up at school"
                autoComplete="off"
              />
            </label>
            {schoolCode ? (
              <p className="mt-2 text-sm text-emerald-700">
                School pickup code {schoolCode} — pay cash at school.
                {promoCode.trim()
                  ? ` Your promo code also applies — its discount comes off the cash total.`
                  : ''}
              </p>
            ) : null}
            {schoolError ? <p className="mt-2 text-sm text-red-600">{schoolError}</p> : null}

            {schoolCode ? (
              <div className="mt-4 space-y-3">
                <label className="block text-sm text-navy">
                  Full name
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    autoComplete="name"
                    placeholder="First and last name"
                  />
                </label>
                <label className="flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm text-navy">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={agreePay}
                    onChange={(e) => setAgreePay(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">{CASH_PAYMENT_LABEL}</span>
                    <span className="mt-1 block text-muted">{cashPaymentDetail(notice)}</span>
                  </span>
                </label>
                <div className="rounded-xl border bg-white px-4 py-3 text-sm text-navy">
                  <p className="font-semibold">Terms and conditions</p>
                  <p className="mt-2">
                    <Link to="/terms-and-conditions#cash" className="text-electric underline">
                      Click here to read the terms and conditions.
                    </Link>
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{CASH_TERMS_BODY}</p>
                  <label className="mt-3 flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                    />
                    <span className="font-semibold">{CASH_TERMS_LABEL}</span>
                  </label>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted">
                  Promo codes are entered here only — not in Checkout.
                </p>
                <p className="mt-4 text-sm text-navy">
                  <Link to="/terms-and-conditions" className="text-electric underline">
                    Click here to read the terms and conditions.
                  </Link>{' '}
                  Checkout asks you to agree before you pay.
                </p>
              </>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            {schoolCode ? (
              <button
                type="button"
                className="btn btn-primary mt-6 w-full"
                disabled={busy || !cashReady}
                onClick={() => void cashCheckout()}
              >
                {busy ? 'Placing order…' : 'Order'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary mt-6 w-full"
                disabled={busy || (CUSTOMER_ACCOUNTS_ENABLED && loading)}
                onClick={() => void checkout()}
              >
                {busy ? 'Redirecting…' : 'Checkout'}
              </button>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
