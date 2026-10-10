import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import type { AdminPermissions, AdminUser } from '../types/api'
import { adminHomePath, adminPath } from '../lib/portal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SpellCheckedField } from '../components/SpellCheckedField'
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  defaultPermissions,
  type PermissionKey,
} from '../../shared/permissions'
import { SandboxIcon } from '../lib/sandboxIcon'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm'

/** Permissions the main admin can grant to regular admins (not manage_admins). */
const EDITABLE_PERMS = PERMISSION_KEYS.filter((k) => k !== 'manage_admins')

export function AdminSettings() {
  const { email, displayName, label, isMainAdmin, can, refresh, setDisplayName } = useAdminAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [nameMessage, setNameMessage] = useState('')
  const [nameError, setNameError] = useState('')
  const [nameSaving, setNameSaving] = useState(false)

  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [newAdminName, setNewAdminName] = useState('')
  const [newAdminPerms, setNewAdminPerms] = useState<AdminPermissions>(defaultPermissions())
  const [adminError, setAdminError] = useState('')
  const [adminMessage, setAdminMessage] = useState('')
  const [pendingRemove, setPendingRemove] = useState<AdminUser | null>(null)
  const [removing, setRemoving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPerms, setEditPerms] = useState<AdminPermissions | null>(null)
  const [savingPerms, setSavingPerms] = useState(false)
  const [passwordTargetId, setPasswordTargetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordError, setResetPasswordError] = useState('')
  const [resetPasswordMessage, setResetPasswordMessage] = useState('')
  const [resetPasswordSaving, setResetPasswordSaving] = useState(false)
  const [emailTargetId, setEmailTargetId] = useState<string | null>(null)
  const [resetEmail, setResetEmail] = useState('')
  const [resetEmailError, setResetEmailError] = useState('')
  const [resetEmailMessage, setResetEmailMessage] = useState('')
  const [resetEmailSaving, setResetEmailSaving] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)

  const [websiteOnline, setWebsiteOnline] = useState(true)
  const [siteStatusMessage, setSiteStatusMessage] = useState('')
  const [siteStatusSaving, setSiteStatusSaving] = useState(false)

  const [signatureDraft, setSignatureDraft] = useState('')
  const [savingSignature, setSavingSignature] = useState(false)
  const [signatureMessage, setSignatureMessage] = useState('')

  const [csToken, setCsToken] = useState('')
  const [csPrinterId, setCsPrinterId] = useState('')
  const [csFilamentId, setCsFilamentId] = useState('')
  const [csOwnedPrinterId, setCsOwnedPrinterId] = useState('')
  const [csTokenMasked, setCsTokenMasked] = useState<string | null>(null)
  const [csHasToken, setCsHasToken] = useState(false)
  const [csPrinters, setCsPrinters] = useState<
    { id: string; ownerLabel: string; modelName: string; ownerUserId: string | null }[]
  >([])
  const [csSaving, setCsSaving] = useState(false)
  const [csMessage, setCsMessage] = useState('')
  const [csError, setCsError] = useState('')

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

  async function loadSignature() {
    if (!can('mail')) {
      setSignatureDraft('')
      return
    }
    const sig = await api.admin.mail.getSignature()
    setSignatureDraft(sig.signature)
  }

  async function loadCloudSlicer() {
    const data = await api.admin.settings.getCloudSlicer()
    setCsTokenMasked(data.tokenMasked)
    setCsHasToken(data.hasToken)
    setCsPrinterId(data.printerId)
    setCsFilamentId(data.filamentId)
    setCsOwnedPrinterId(data.ownedPrinterId ?? '')
    setCsPrinters(data.printers)
    setCsToken('')
  }

  useEffect(() => {
    setNameDraft(displayName ?? '')
  }, [displayName])

  useEffect(() => {
    setEmailDraft(email ?? '')
  }, [email])

  useEffect(() => {
    loadAdmins().catch(console.error)
    loadSiteStatus().catch(console.error)
    loadSignature().catch(console.error)
    loadCloudSlicer().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when role/access identity changes
  }, [isMainAdmin, email])

  async function saveDisplayName(e: React.FormEvent) {
    e.preventDefault()
    setNameError('')
    setNameMessage('')
    setNameSaving(true)
    try {
      const result = await api.admin.settings.updateProfile(nameDraft)
      setDisplayName(result.displayName)
      setNameDraft(result.displayName ?? '')
      setNameMessage(result.displayName ? 'Name saved.' : 'Name cleared — email will be shown instead.')
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Could not save name')
    } finally {
      setNameSaving(false)
    }
  }

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

  async function saveSignature() {
    setSavingSignature(true)
    setSignatureMessage('')
    try {
      const result = await api.admin.mail.updateSignature(signatureDraft)
      setSignatureDraft(result.signature)
      setSignatureMessage(result.signature.trim() ? 'Signature saved.' : 'Signature cleared.')
    } catch (err) {
      setSignatureMessage(err instanceof Error ? err.message : 'Could not save signature')
    } finally {
      setSavingSignature(false)
    }
  }

  async function saveCloudSlicer(e: React.FormEvent) {
    e.preventDefault()
    setCsSaving(true)
    setCsError('')
    setCsMessage('')
    try {
      const result = await api.admin.settings.updateCloudSlicer({
        ...(csToken.trim() ? { token: csToken.trim() } : {}),
        printerId: csPrinterId,
        filamentId: csFilamentId,
        ownedPrinterId: csOwnedPrinterId,
      })
      setCsTokenMasked(result.tokenMasked)
      setCsHasToken(result.hasToken)
      setCsPrinterId(result.printerId)
      setCsFilamentId(result.filamentId)
      setCsOwnedPrinterId(result.ownedPrinterId ?? '')
      setCsToken('')
      setCsMessage(
        result.hasToken && result.printerId && result.filamentId && result.ownedPrinterId
          ? 'Cloud Slicer settings saved. Your printer will be quoted when designs are submitted.'
          : 'Saved. Add token, Cloud Slicer printer/filament IDs, and your PrintX printer to enable quoting.',
      )
      await loadCloudSlicer()
    } catch (err) {
      setCsError(err instanceof Error ? err.message : 'Could not save Cloud Slicer settings')
    } finally {
      setCsSaving(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!isMainAdmin) return
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

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!isMainAdmin) return
    setEmailError('')
    setEmailMessage('')
    setEmailSaving(true)
    try {
      await api.admin.settings.changeEmail(emailDraft, emailPassword)
      setEmailMessage('Email updated. Please sign in again with your new email.')
      setEmailPassword('')
      setTimeout(() => navigate(adminHomePath()), 1500)
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to update email')
    } finally {
      setEmailSaving(false)
    }
  }

  async function saveAdminPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordTargetId || !isMainAdmin) return
    setResetPasswordError('')
    setResetPasswordMessage('')
    setResetPasswordSaving(true)
    try {
      await api.admin.users.setPassword(passwordTargetId, resetPassword)
      setResetPassword('')
      setPasswordTargetId(null)
      setResetPasswordMessage('Password updated. They will need to sign in again.')
    } catch (err) {
      setResetPasswordError(err instanceof Error ? err.message : 'Could not update password')
    } finally {
      setResetPasswordSaving(false)
    }
  }

  async function saveAdminEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!emailTargetId || !isMainAdmin) return
    setResetEmailError('')
    setResetEmailMessage('')
    setResetEmailSaving(true)
    try {
      const result = await api.admin.users.setEmail(emailTargetId, resetEmail)
      setResetEmail('')
      setEmailTargetId(null)
      setResetEmailMessage(`Email updated to ${result.email}. They will need to sign in again.`)
      await loadAdmins()
    } catch (err) {
      setResetEmailError(err instanceof Error ? err.message : 'Could not update email')
    } finally {
      setResetEmailSaving(false)
    }
  }

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault()
    setAdminError('')
    setAdminMessage('')
    try {
      await api.admin.users.create(newAdminEmail, newAdminPassword, newAdminPerms, newAdminName)
      setNewAdminEmail('')
      setNewAdminPassword('')
      setNewAdminName('')
      setNewAdminPerms(defaultPermissions())
      setAdminMessage('Admin account created. They can sign in with the access you set.')
      loadAdmins()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create admin'
      setAdminError(
        msg === 'Unauthorized'
          ? 'Your session expired. Sign out, sign back in as pablo.molina@printx.pw, then try again.'
          : msg,
      )
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
        <p className="font-medium text-navy">{label}</p>
        <p className="mt-0.5 text-sm text-muted">{email ?? '—'}</p>
        {isMainAdmin ? (
          <p className="mt-1 text-xs font-semibold text-electric">Main admin</p>
        ) : (
          <p className="mt-1 text-xs text-green-600">Regular admin</p>
        )}

        {can('settings') && (
          <form onSubmit={saveDisplayName} className="mt-5 border-t pt-5">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-navy">Display name (optional)</span>
              <input
                className={inputClass}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Your name"
                maxLength={80}
                autoComplete="nickname"
              />
            </label>
            <p className="mt-2 text-xs text-muted">
              Shown in the portal only — you cannot sign in with this name. Always log in with your email and
              password. Leave blank to show your email instead.
            </p>
            {nameError && <p className="mt-2 text-sm text-red-600">{nameError}</p>}
            {nameMessage && <p className="mt-2 text-sm text-green-600">{nameMessage}</p>}
            <button
              type="submit"
              disabled={nameSaving}
              className="btn btn-primary mt-3"
            >
              {nameSaving ? 'Saving…' : 'Save name'}
            </button>
          </form>
        )}
      </div>

      <form onSubmit={saveCloudSlicer} className="mt-8 max-w-md rounded-2xl border bg-white p-6">
        <h2 className="mb-1 font-semibold">Cloud Slicer API</h2>
        <p className="text-sm text-muted">
          Each printer owner uses their own free Cloud Slicer account. Create a printer + filament there, then
          paste the API token and IDs here. PrintX quotes your machine when a design STL is submitted.
        </p>
        <label className="mt-4 block text-sm font-medium text-navy">
          Your PrintX printer
          <select
            className={`mt-1 ${inputClass}`}
            value={csOwnedPrinterId}
            onChange={(e) => setCsOwnedPrinterId(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {csPrinters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.ownerLabel} — {p.modelName}
                {p.ownerUserId && p.ownerUserId !== '' ? ' (linked)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium text-navy">
          API token
          <input
            type="password"
            className={`mt-1 ${inputClass}`}
            value={csToken}
            onChange={(e) => setCsToken(e.target.value)}
            placeholder={csHasToken ? `Saved ${csTokenMasked ?? '••••'}` : 'Paste Cloud Slicer token'}
            autoComplete="off"
          />
        </label>
        {csHasToken ? (
          <p className="mt-1 text-xs text-muted">Token on file: {csTokenMasked}. Leave blank to keep it.</p>
        ) : null}
        <label className="mt-3 block text-sm font-medium text-navy">
          Cloud Slicer printer ID
          <input
            className={`mt-1 ${inputClass}`}
            value={csPrinterId}
            onChange={(e) => setCsPrinterId(e.target.value)}
            placeholder="printer_…"
            required
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-navy">
          Cloud Slicer filament ID
          <input
            className={`mt-1 ${inputClass}`}
            value={csFilamentId}
            onChange={(e) => setCsFilamentId(e.target.value)}
            placeholder="filament_…"
            required
          />
        </label>
        <p className="mt-2 text-xs text-muted">
          Dashboard: cloudslicer3d.com → create printer/filament → copy IDs. Free plan: 100 quotes/month per
          account.
        </p>
        {csError && <p className="mt-3 text-sm text-red-600">{csError}</p>}
        {csMessage && <p className="mt-3 text-sm text-green-600">{csMessage}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={csSaving} className="btn btn-primary">
            {csSaving ? 'Saving…' : 'Save Cloud Slicer'}
          </button>
          {csHasToken ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={csSaving}
              onClick={() => {
                setCsSaving(true)
                void api.admin.settings
                  .updateCloudSlicer({ clearToken: true, token: '', printerId: csPrinterId, filamentId: csFilamentId, ownedPrinterId: csOwnedPrinterId })
                  .then(() => loadCloudSlicer())
                  .then(() => setCsMessage('API token cleared.'))
                  .catch((err) => setCsError(err instanceof Error ? err.message : 'Clear failed'))
                  .finally(() => setCsSaving(false))
              }}
            >
              Clear token
            </button>
          ) : null}
        </div>
      </form>

      {can('mail') && (
        <div className="mt-8 max-w-md rounded-2xl border bg-white p-6">
          <h2 className="mb-1 font-semibold">Mail signature</h2>
          <p className="text-sm text-muted">
            Added at the end of new messages, replies, and forwards. Leave blank for no signature.
          </p>
          <label className="mt-4 block text-sm font-medium text-navy">
            Signature
            <SpellCheckedField
              multiline
              className={`mt-1 ${inputClass}`}
              rows={6}
              value={signatureDraft}
              onChange={setSignatureDraft}
              placeholder={'Your name\nPrintX Admin'}
            />
          </label>
          {signatureDraft.trim() ? (
            <div className="mt-4 rounded-xl border border-dashed bg-surface/60 p-4 text-sm text-navy">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{`--\n${signatureDraft.trim()}`}</pre>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingSignature}
              onClick={() => void saveSignature()}
            >
              {savingSignature ? 'Saving…' : 'Save signature'}
            </button>
            {signatureMessage && <p className="text-sm text-muted">{signatureMessage}</p>}
          </div>
        </div>
      )}

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
                className="btn btn-secondary mt-4 !border-amber-200 !bg-amber-50 !text-amber-900 hover:!border-amber-400 hover:!bg-amber-100 hover:!text-amber-950"
              >
                <SandboxIcon size={16} className="text-amber-500" />
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
            As main admin you can create regular admins, choose what they can see, change their emails and
            passwords, and delete their accounts.
          </p>
          {resetPasswordMessage && (
            <p className="mb-4 text-sm text-green-600">{resetPasswordMessage}</p>
          )}
          {resetEmailMessage && (
            <p className="mb-4 text-sm text-green-600">{resetEmailMessage}</p>
          )}

          <ul className="space-y-3">
            {admins.map((admin) => (
              <li key={admin.id} className="rounded-xl border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-navy">{admin.displayName?.trim() || admin.email}</p>
                    {admin.displayName?.trim() && (
                      <p className="text-sm text-muted">{admin.email}</p>
                    )}
                    <p className="text-xs text-muted">
                      {admin.isMainAdmin ? 'Main admin — full access' : 'Regular admin'} · Joined{' '}
                      {new Date(admin.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                          className="btn btn-secondary"
                        >
                          {editingId === admin.id ? 'Close' : 'Edit access'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEmailTargetId((id) => (id === admin.id ? null : admin.id))
                            setResetEmail(admin.email)
                            setResetEmailError('')
                            setResetEmailMessage('')
                            setPasswordTargetId(null)
                          }}
                          className="btn btn-secondary"
                        >
                          {emailTargetId === admin.id ? 'Close' : 'Change email'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPasswordTargetId((id) => (id === admin.id ? null : admin.id))
                            setResetPassword('')
                            setResetPasswordError('')
                            setResetPasswordMessage('')
                            setEmailTargetId(null)
                          }}
                          className="btn btn-secondary"
                        >
                          {passwordTargetId === admin.id ? 'Close' : 'Set password'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingRemove(admin)}
                          className="btn btn-danger"
                        >
                          Delete account
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {emailTargetId === admin.id && (
                  <form onSubmit={saveAdminEmail} className="mt-4 border-t pt-4">
                    <p className="mb-2 text-sm font-medium text-navy">Change login email</p>
                    <label className="block">
                      <span className="sr-only">New email</span>
                      <input
                        type="email"
                        required
                        className={inputClass}
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="name@printx.pw"
                        autoComplete="email"
                      />
                    </label>
                    <p className="mt-2 text-xs text-muted">
                      They will be signed out and must sign in with this email next time.
                    </p>
                    {resetEmailError && (
                      <p className="mt-2 text-sm text-red-600">{resetEmailError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={resetEmailSaving}
                      className="btn btn-primary mt-3"
                    >
                      {resetEmailSaving ? 'Saving…' : 'Save email'}
                    </button>
                  </form>
                )}

                {passwordTargetId === admin.id && (
                  <form onSubmit={saveAdminPassword} className="mt-4 border-t pt-4">
                    <p className="mb-2 text-sm font-medium text-navy">Set new password</p>
                    <label className="block">
                      <span className="sr-only">New password</span>
                      <input
                        type="password"
                        required
                        minLength={8}
                        className={inputClass}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="8+ characters"
                        autoComplete="new-password"
                      />
                    </label>
                    <p className="mt-2 text-xs text-muted">
                      They will be signed out and must use this password next time.
                    </p>
                    {resetPasswordError && (
                      <p className="mt-2 text-sm text-red-600">{resetPasswordError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={resetPasswordSaving}
                      className="btn btn-primary mt-3"
                    >
                      {resetPasswordSaving ? 'Saving…' : 'Save password'}
                    </button>
                  </form>
                )}

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
                      className="btn btn-primary mt-4"
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
                Name (optional)
                <input
                  className={`mt-1 ${inputClass}`}
                  value={newAdminName}
                  onChange={(e) => setNewAdminName(e.target.value)}
                  placeholder="First Last"
                  maxLength={80}
                />
              </label>
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
              <label className="sm:col-span-2">
                Password
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
              Share credentials securely. Only you (main admin) can change their email or password later.
            </p>
            {adminError && <p className="mt-3 text-sm text-red-600">{adminError}</p>}
            {adminMessage && <p className="mt-3 text-sm text-green-600">{adminMessage}</p>}
            <button type="submit" className="btn btn-primary mt-4">
              Create admin account
            </button>
          </form>
        </div>
      )}

      {isMainAdmin && can('settings') && (
        <form onSubmit={changeEmail} className="mt-8 max-w-md rounded-2xl border bg-white p-6">
          <h2 className="mb-4 font-semibold">Change your email</h2>
          <label className="block">
            New email
            <input
              type="email"
              required
              className={`mt-1 ${inputClass}`}
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="mt-3 block">
            Current password
            <input
              type="password"
              required
              className={`mt-1 ${inputClass}`}
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            You’ll be signed out and must sign in with the new email.
          </p>
          {emailError && <p className="mt-3 text-sm text-red-600">{emailError}</p>}
          {emailMessage && <p className="mt-3 text-sm text-green-600">{emailMessage}</p>}
          <button type="submit" disabled={emailSaving} className="btn btn-primary mt-4">
            {emailSaving ? 'Saving…' : 'Update email'}
          </button>
        </form>
      )}

      {isMainAdmin && can('settings') && (
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
          <button type="submit" className="btn btn-primary mt-4">
            Update Password
          </button>
        </form>
      )}

      {!isMainAdmin && can('settings') && (
        <div className="mt-8 max-w-md rounded-2xl border bg-white p-6">
          <h2 className="mb-2 font-semibold">Email & password</h2>
          <p className="text-sm text-muted">
            Regular admins cannot change their own email or password. Ask the main admin to update them for
            you in Settings → Admin accounts.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Delete account?"
        message={
          pendingRemove
            ? `Delete ${pendingRemove.email}? They will no longer be able to sign in. This can’t be undone.`
            : ''
        }
        confirmLabel="Delete account"
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
