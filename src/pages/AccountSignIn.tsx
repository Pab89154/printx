import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { useCustomerAuth } from '../context/CustomerAuthContext'

export function AccountSignIn() {
  const { login, customer } = useCustomerAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/account'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (customer) navigate(next, { replace: true })
  }, [customer, navigate, next])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-extrabold text-navy">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Sign in to checkout and view your orders.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4 rounded-2xl border bg-white p-6">
          <label className="block text-sm font-medium text-navy">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-navy">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          No account?{' '}
          <Link
            to={`/account/register${next !== '/account' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="font-semibold text-electric hover:underline"
          >
            Create one
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  )
}
