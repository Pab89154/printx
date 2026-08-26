import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { CustomRequest, RequestStatus } from '../types/api'

const statuses: RequestStatus[] = ['new', 'reviewing', 'approved', 'declined', 'completed']

export function AdminRequests() {
  const [requests, setRequests] = useState<CustomRequest[]>([])

  async function load() {
    setRequests(await api.admin.requests.list())
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Custom Print Requests</h1>
      <p className="mt-1 text-muted">Review and update the status of custom print requests.</p>

      <div className="mt-6 space-y-4">
        {requests.length === 0 && (
          <p className="rounded-xl border border-dashed bg-white p-8 text-center text-muted">No requests yet.</p>
        )}
        {requests.map((req) => (
          <div key={req.id} className="rounded-xl border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-navy">{req.name}</p>
                <p className="text-sm text-muted">{req.email} · {req.school || 'No school listed'}</p>
                <p className="mt-2 text-sm">{req.description}</p>
                {req.size && <p className="mt-1 text-xs text-muted">Size: {req.size}</p>}
                {req.uploaded_file && <p className="mt-1 text-xs text-electric">File uploaded: {req.uploaded_file}</p>}
                <p className="mt-2 text-xs text-muted">Submitted {new Date(req.created_at).toLocaleString()}</p>
              </div>
              <select
                value={req.status}
                onChange={(e) => api.admin.requests.updateStatus(req.id, e.target.value).then(load)}
                className="rounded-lg border px-3 py-1.5 text-sm capitalize"
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
