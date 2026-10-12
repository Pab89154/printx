import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { useCustomerAuth } from '../context/CustomerAuthContext'

export function AccountRegister() {
  const { register, customer } = useCustomerAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/account'
  const [name, setName] = useState('')
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
      await register(name, email, password)
      navigate(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-extrabold text-navy">Create account</h1>
        <p className="mt-2 text-sm text-muted">
          Create an account to track orders. Guest checkout is also available from the cart.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4 rounded-2xl border bg-white p-6">
          <label className="block text-sm font-medium text-navy">
            Name
            <input
              type="text"
              required
              autoComplete="name"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
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
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link
            to={`/account/sign-in${next !== '/account' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="font-semibold text-electric hover:underline"
          >
            Sign in
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  )
}
