import { Link } from 'react-router-dom'
import { CASH_TERMS_BODY, STRIPE_TERMS_BODY } from '../../shared/checkoutConsent'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

export function Terms() {
  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/shop" className="text-sm text-electric hover:underline">
          ← Back to shop
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold text-navy">Terms and conditions</h1>
        <p className="mt-2 text-sm text-muted">
          This is the notice shown before payment. It is not a lawyer-drafted privacy policy or
          contract, and it does not decide a court outcome.
        </p>

        <section id="checkout" className="mt-8 rounded-2xl border bg-white p-6">
          <h2 className="text-lg font-bold text-navy">Checkout</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-navy">{STRIPE_TERMS_BODY}</p>
        </section>

        <section id="cash" className="mt-6 rounded-2xl border bg-white p-6">
          <h2 className="text-lg font-bold text-navy">School cash sale</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-navy">{CASH_TERMS_BODY}</p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
