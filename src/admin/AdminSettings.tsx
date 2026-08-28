import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import type { AdminUser } from '../types/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-electric focus:ring-2 focus:ring-electric/20'

export function AdminSettings() {
  const { email } = useAdminAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminMessage, setAdminMessage] = useState('')

  async function loadAdmins() {
    setAdmins(await api.admin.users.list())
  }

  useEffect(() => {
    loadAdmins()
  }, [])

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      await api.admin.settings.changePassword(currentPassword, newPassword)
      setMessage('Password updated. Please sign in again.')
      setTimeout(() => navigate('/admin'), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update password')
    }
  }

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault()
    setAdminError('')
    setAdminMessage('')
    try {
      await api.admin.users.create(newAdminEmail, newAdminPassword)
      setNewAdminEmail('')
      setNewAdminPassword('')
      setAdminMessage('Admin account created. They can sign in immediately.')
      loadAdmins()
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to create admin')
    }
  }

  async function removeAdmin(id: string) {
    if (!confirm('Remove this admin account? They will no longer be able to sign in.')) return
    setAdminError('')
    setAdminMessage('')
    try {
      await api.admin.users.delete(id)
      setAdminMessage('Admin account removed.')
      loadAdmins()
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to remove admin')
    }
  }

  const currentAdmin = admins.find((a) => a.email.toLowerCase() === (email ?? '').toLowerCase())

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <p className="mt-1 text-muted">Manage your admin account and team access.</p>

      <div className="mt-8 max-w-md rounded-2xl border bg-white p-6">
        <h2 className="mb-2 font-semibold">Your account</h2>
        <p className="text-sm text-muted">Signed in as</p>
        <p className="font-medium text-navy">{email ?? '—'}</p>
        <p className="mt-1 text-xs text-green-600">Verified admin account</p>
      </div>

      <div className="mt-8 max-w-2xl rounded-2xl border bg-white p-6">
        <h2 className="mb-1 font-semibold">Admin accounts</h2>
        <p className="mb-4 text-sm text-muted">
          Only signed-in admins can create other admin accounts. There is no public sign-up page.
        </p>

        <ul className="space-y-2">
          {admins.map((admin) => (
            <li key={admin.id} className="flex items-center justify-between rounded-xl border px-4 py-3">
              <div>
                <p className="font-medium text-navy">{admin.email}</p>
                <p className="text-xs text-muted">
                  {admin.emailVerified ? 'Verified' : 'Unverified'} · joined {new Date(admin.createdAt).toLocaleDateString()}
                </p>
              </div>
              {admin.id !== currentAdmin?.id && admins.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAdmin(admin.id)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
              {admin.id === currentAdmin?.id && (
                <span className="text-xs font-medium text-electric">You</span>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={createAdmin} className="mt-6 border-t pt-6">
          <h3 className="mb-3 font-medium text-navy">Add admin account</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Email
              <input
                type="email"
                required
                className={`mt-1 ${inputClass}`}
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                placeholder="name@printx.pw"
              />
            </label>
            <label>Temporary password
              <input
                type="password"
                required
                minLength={8}
                className={`mt-1 ${inputClass}`}
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
                placeholder="8+ characters"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">Share these credentials securely. The new admin should change their password after first login.</p>
          {adminError && <p className="mt-3 text-sm text-red-600">{adminError}</p>}
          {adminMessage && <p className="mt-3 text-sm text-green-600">{adminMessage}</p>}
          <button type="submit" className="mt-4 rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">
            Create admin account
          </button>
        </form>
      </div>

      <form onSubmit={changePassword} className="mt-8 max-w-md rounded-2xl border bg-white p-6">
        <h2 className="mb-4 font-semibold">Change your password</h2>
        <label className="block">Current password
          <input type="password" required className={`mt-1 ${inputClass}`} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className="mt-3 block">New password
          <input type="password" required minLength={8} className={`mt-1 ${inputClass}`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mt-3 text-sm text-green-600">{message}</p>}
        <button type="submit" className="mt-4 rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">Update Password</button>
      </form>
    </div>
  )
}
