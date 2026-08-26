import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-electric focus:ring-2 focus:ring-electric/20'

export function AdminSettings() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <p className="mt-1 text-muted">Manage your admin account settings.</p>

      <form onSubmit={changePassword} className="mt-8 max-w-md rounded-2xl border bg-white p-6">
        <h2 className="mb-4 font-semibold">Change Password</h2>
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
