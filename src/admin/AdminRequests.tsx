import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAdminAuth } from '../context/AdminAuthContext'
import type { CustomRequest, RequestStatus } from '../types/api'

const statuses: RequestStatus[] = ['new', 'reviewing', 'approved', 'declined', 'completed']

export function AdminRequests() {
  const { isMainAdmin } = useAdminAuth()
  const [requests, setRequests] = useState<CustomRequest[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setRequests(await api.admin.requests.list())
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [])

  async function setStatus(id: string, status: RequestStatus) {
    setBusyId(id)
    setError('')
    try {
      await api.admin.requests.updateStatus(id, status)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Custom Print Requests</h1>
      <p className="mt-1 text-muted">
        Ideas submitted from the public site. Main admins accept or decline here — nothing is emailed to
        hello@printx.pw.
      </p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 space-y-4">
        {requests.length === 0 && (
          <p className="rounded-xl border border-dashed bg-white p-8 text-center text-muted">No requests yet.</p>
        )}
        {requests.map((req) => (
          <div key={req.id} className="rounded-xl border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-navy">{req.name}</p>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {req.status}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  <a href={`mailto:${req.email}`} className="text-electric hover:underline">
                    {req.email}
                  </a>
                  {req.school ? ` · ${req.school}` : ''}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{req.description}</p>
                {req.size && <p className="mt-1 text-xs text-muted">Size: {req.size}</p>}
                {req.uploaded_file && (
                  <a
                    href={`/api/admin/uploads/${encodeURIComponent(req.uploaded_file)}`}
                    className="mt-1 inline-block text-xs font-medium text-electric hover:underline"
                  >
                    Download uploaded file
                  </a>
                )}
                <p className="mt-2 text-xs text-muted">Submitted {new Date(req.created_at).toLocaleString()}</p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                {isMainAdmin && (req.status === 'new' || req.status === 'reviewing') && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      disabled={busyId === req.id}
                      onClick={() => void setStatus(req.id, 'approved')}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact text-red-600"
                      disabled={busyId === req.id}
                      onClick={() => void setStatus(req.id, 'declined')}
                    >
                      Decline
                    </button>
                  </div>
                )}
                {isMainAdmin ? (
                  <select
                    value={req.status}
                    disabled={busyId === req.id}
                    onChange={(e) => void setStatus(req.id, e.target.value as RequestStatus)}
                    className="h-11 w-full shrink-0 rounded-lg border border-slate-200 px-3 text-sm capitalize sm:w-auto"
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted">Only the main admin can accept or decline.</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
