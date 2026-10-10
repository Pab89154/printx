import { Link, useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

export function OrderSuccess() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-3xl font-extrabold text-navy">Thanks for your order!</h1>
        <p className="mt-4 text-muted">
          Payment received. PrintX will print your design and follow up by email.
        </p>
        {sessionId ? (
          <p className="mt-2 break-all text-xs text-muted">Stripe session: {sessionId}</p>
        ) : null}
        <Link to="/shop" className="btn btn-primary mt-8 inline-flex">
          Back to shop
        </Link>
      </main>
      <Footer />
    </div>
  )
}
