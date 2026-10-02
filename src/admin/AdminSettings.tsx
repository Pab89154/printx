import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import type { AdminPermissions, AdminUser } from '../types/api'
import { adminHomePath, adminPath } from '../lib/portal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  defaultPermissions,
  type PermissionKey,
} from '../../shared/permissions'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm'

/** Permissions the main admin can grant to regular admins (not manage_admins). */
const EDITABLE_PERMS = PERMISSION_KEYS.filter((k) => k !== 'manage_admins')

export function AdminSettings() {
  const { email, isMainAdmin, can, refresh } = useAdminAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [newAdminPerms, setNewAdminPerms] = useState<AdminPermissions>(defaultPermissions())
  const [adminError, setAdminError] = useState('')
  const [adminMessage, setAdminMessage] = useState('')
  const [pendingRemove, setPendingRemove] = useState<AdminUser | null>(null)
  const [removing, setRemoving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPerms, setEditPerms] = useState<AdminPermissions | null>(null)
  const [savingPerms, setSavingPerms] = useState(false)

  const [websiteOnline, setWebsiteOnline] = useState(true)
  const [siteStatusMessage, setSiteStatusMessage] = useState('')
  const [siteStatusSaving, setSiteStatusSaving] = useState(false)

  async function loadAdmins() {
    if (!can('manage_admins')) {
      setAdmins([])
      return
    }
    setAdmins(await api.admin.users.list())
  }

  async function loadSiteStatus() {
    if (!can('website_status') && !can('content')) return
    const content = await api.admin.content.get()
    setWebsiteOnline(content.websiteOnline !== false)
  }

  useEffect(() => {
    loadAdmins().catch(console.error)
    loadSiteStatus().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when role/access identity changes
  }, [isMainAdmin, email])

  async function toggleWebsiteOnline(next: boolean) {
    setSiteStatusSaving(true)
    setSiteStatusMessage('')
    try {
      await api.admin.content.update({ websiteOnline: next })
      setWebsiteOnline(next)
      setSiteStatusMessage(
        next
          ? 'Public website is online again.'
          : 'Public website paused — visitors see “Currently Planning Prints!”',
      )
    } catch (e) {
      setSiteStatusMessage(e instanceof Error ? e.message : 'Failed to update website status')
    } finally {
      setSiteStatusSaving(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      await api.admin.settings.changePassword(currentPassword, newPassword)
      setMessage('Password updated. Please sign in again.')
      setTimeout(() => navigate(adminHomePath()), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update password')
    }
  }

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault()
    setAdminError('')
    setAdminMessage('')
    try {
      await api.admin.users.create(newAdminEmail, newAdminPassword, newAdminPerms)
      setNewAdminEmail('')
      setNewAdminPassword('')
      setNewAdminPerms(defaultPermissions())
      setAdminMessage('Admin account created. They can sign in with the access you set.')
      loadAdmins()
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to create admin')
    }
  }

  async function confirmRemoveAdmin() {
    if (!pendingRemove) return
    setRemoving(true)
    setAdminError('')
    setAdminMessage('')
    try {
      await api.admin.users.delete(pendingRemove.id)
      setPendingRemove(null)
      setAdminMessage('Admin account removed.')
      await loadAdmins()
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to remove admin')
    } finally {
      setRemoving(false)
    }
  }

  function startEdit(admin: AdminUser) {
    setEditingId(admin.id)
    setEditPerms({ ...admin.permissions })
  }

  async function saveEditPerms() {
    if (!editingId || !editPerms) return
    setSavingPerms(true)
    setAdminError('')
    try {
      await api.admin.users.updatePermissions(editingId, editPerms)
      setAdminMessage('Access updated.')
      setEditingId(null)
      setEditPerms(null)
      await loadAdmins()
      await refresh()
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : 'Failed to update access')
    } finally {
      setSavingPerms(false)
    }
  }

  function togglePerm(
    perms: AdminPermissions,
    key: PermissionKey,
    set: (p: AdminPermissions) => void,
  ) {
    set({ ...perms, [key]: !perms[key], manage_admins: false })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Settings</h1>
      <p className="mt-1 text-muted">
        {isMainAdmin
          ? 'You are the main admin — control the site and what other admins can see.'
          : 'Manage your account.'}
      </p>

      <div className="mt-8 max-w-md rounded-2xl border bg-white p-6">
        <h2 className="mb-2 font-semibold">Your account</h2>
        <p className="text-sm text-muted">Signed in as</p>
        <p className="font-medium text-navy">{email ?? '—'}</p>
        {isMainAdmin ? (
          <p className="mt-1 text-xs font-semibold text-electric">Main admin</p>
        ) : (
          <p className="mt-1 text-xs text-green-600">Regular admin</p>
        )}
      </div>

      {can('website_status') && (
        <div className="mt-8 max-w-md rounded-2xl border bg-white p-6">
          <h2 className="mb-1 font-semibold">Public website</h2>
          <p className="mb-4 text-sm text-muted">
            Temporarily pause the public site. Visitors will see “Currently Planning Prints!” Admins can still try the full site in the sandbox.
          </p>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
            <span className="text-sm font-medium text-navy">
              {websiteOnline ? 'Website is online' : 'Website is paused'}
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-electric"
              checked={websiteOnline}
              disabled={siteStatusSaving}
              onChange={(e) => toggleWebsiteOnline(e.target.checked)}
            />
          </label>
          {siteStatusMessage && (
            <p className={`mt-3 text-sm ${websiteOnline ? 'text-green-600' : 'text-amber-600'}`}>
              {siteStatusMessage}
            </p>
          )}
          {can('sandbox') && (
            <>
              <Link
                to={adminPath('sandbox')}
                className="mt-4 inline-flex rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:border-amber-400"
              >
                Open site sandbox
              </Link>
              <p className="mt-2 text-xs text-muted">
                Sandbox shows the real PrintX site to signed-in admins only — it does not unpause the public website.
              </p>
            </>
          )}
        </div>
      )}

      {isMainAdmin && can('manage_admins') && (
        <div className="mt-8 max-w-2xl rounded-2xl border bg-white p-6">
          <h2 className="mb-1 font-semibold">Admin accounts & access</h2>
          <p className="mb-4 text-sm text-muted">
            Only you (main admin) can create regular admins and choose what each one can see and change.
          </p>

          <ul className="space-y-3">
            {admins.map((admin) => (
              <li key={admin.id} className="rounded-xl border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-navy">{admin.email}</p>
                    <p className="text-xs text-muted">
                      {admin.isMainAdmin ? 'Main admin — full access' : 'Regular admin'} · Joined{' '}
                      {new Date(admin.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {admin.isMainAdmin ? (
                      <span className="text-xs font-medium text-electric">You</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            editingId === admin.id
                              ? (setEditingId(null), setEditPerms(null))
                              : startEdit(admin)
                          }
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-navy hover:border-electric"
                        >
                          {editingId === admin.id ? 'Close' : 'Edit access'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRemove(admin)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {editingId === admin.id && editPerms && (
                  <div className="mt-4 border-t pt-4">
                    <p className="mb-2 text-sm font-medium text-navy">What this admin can access</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {EDITABLE_PERMS.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="accent-electric"
                            checked={editPerms[key]}
                            onChange={() => togglePerm(editPerms, key, setEditPerms)}
                          />
                          {PERMISSION_LABELS[key]}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={savingPerms}
                      onClick={saveEditPerms}
                      className="mt-4 rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {savingPerms ? 'Saving…' : 'Save access'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <form onSubmit={createAdmin} className="mt-6 border-t pt-6">
            <h3 className="mb-3 font-medium text-navy">Add regular admin</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Email
                <input
                  type="email"
                  required
                  className={`mt-1 ${inputClass}`}
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="name@printx.pw"
                />
              </label>
              <label>
                Temporary password
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
            <p className="mb-2 mt-4 text-sm font-medium text-navy">Access for this new admin</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EDITABLE_PERMS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="accent-electric"
                    checked={newAdminPerms[key]}
                    onChange={() => togglePerm(newAdminPerms, key, setNewAdminPerms)}
                  />
                  {PERMISSION_LABELS[key]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Share credentials securely. They should change their password after first login.
            </p>
            {adminError && <p className="mt-3 text-sm text-red-600">{adminError}</p>}
            {adminMessage && <p className="mt-3 text-sm text-green-600">{adminMessage}</p>}
            <button type="submit" className="mt-4 rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">
              Create admin account
            </button>
          </form>
        </div>
      )}

      {can('settings') && (
        <form onSubmit={changePassword} className="mt-8 max-w-md rounded-2xl border bg-white p-6">
          <h2 className="mb-4 font-semibold">Change your password</h2>
          <label className="block">
            Current password
            <input
              type="password"
              required
              className={`mt-1 ${inputClass}`}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="mt-3 block">
            New password
            <input
              type="password"
              required
              minLength={8}
              className={`mt-1 ${inputClass}`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {message && <p className="mt-3 text-sm text-green-600">{message}</p>}
          <button type="submit" className="mt-4 rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">
            Update Password
          </button>
        </form>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Remove admin?"
        message={
          pendingRemove
            ? `Remove ${pendingRemove.email}? They will no longer be able to sign in.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        busy={removing}
        onCancel={() => {
          if (!removing) setPendingRemove(null)
        }}
        onConfirm={confirmRemoveAdmin}
      />
    </div>
  )
}
