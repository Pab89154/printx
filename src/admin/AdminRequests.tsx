import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAdminAuth } from '../context/AdminAuthContext'
import type { CustomRequest, RequestStatus } from '../types/api'

const statuses: RequestStatus[] = ['new', 'reviewing', 'approved', 'declined', 'completed']

const PRINTER_LABEL: Record<string, string> = {
  pablo_p1s: 'P1S',
  court_ender: 'Ender 3v2',
  josh_kobra: 'Kobra X',
}

export function AdminRequests() {
  const { isMainAdmin } = useAdminAuth()
  const [requests, setRequests] = useState<CustomRequest[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [shipTracking, setShipTracking] = useState<Record<string, string>>({})

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

  async function accept(id: string) {
    setBusyId(id)
    setError('')
    try {
      await api.admin.requests.updateStatus(id, 'approved')
      await api.admin.requests.downloadGcode(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Accept / download failed')
      try {
        await load()
      } catch {
        /* ignore */
      }
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete custom print request from ${name}? This cannot be undone.`)) return
    setBusyId(id)
    setError('')
    try {
      await api.admin.requests.delete(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Custom Print Requests</h1>
      <p className="mt-1 text-muted">
        Paid custom prints from the public site (estimate → Checkout). Accept downloads G-code; decline clears
        sliced artifacts but keeps contact info so you can follow up.
      </p>
      {error && <p className="mt-3 whitespace-pre-wrap text-sm text-red-600">{error}</p>}

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
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    slice {req.slice_status || 'idle'}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  <a href={`mailto:${req.email}`} className="text-electric hover:underline">
                    {req.email}
                  </a>
                  {req.school ? ` · ${req.school}` : ''}
                </p>
                {req.description && !req.description.startsWith('Custom model:') ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{req.description}</p>
                ) : null}
                {req.catalog_price_usd != null && (
                  <p className="mt-2 text-sm font-semibold text-electric">
                    Estimate ${req.catalog_price_usd.toFixed(2)}
                    {req.worst_printer_id
                      ? ` · worst: ${PRINTER_LABEL[req.worst_printer_id] || req.worst_printer_id}`
                      : ''}
                    {req.worst_cost_usd != null ? ` · cost $${req.worst_cost_usd.toFixed(2)}` : ''}
                  </p>
                )}
                {(req.shipping_line1 || req.shipping_method) && (
                  <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-navy">
                    <p className="font-semibold">Ship to</p>
                    {req.shipping_name ? <p>{req.shipping_name}</p> : null}
                    {req.shipping_line1 ? <p>{req.shipping_line1}</p> : null}
                    {req.shipping_line2 ? <p>{req.shipping_line2}</p> : null}
                    {(req.shipping_city || req.shipping_state || req.shipping_postal) && (
                      <p>
                        {[req.shipping_city, req.shipping_state].filter(Boolean).join(', ')}
                        {req.shipping_postal ? ` ${req.shipping_postal}` : ''}
                      </p>
                    )}
                    {req.shipping_country ? <p>{req.shipping_country}</p> : null}
                    {(req.shipping_method || req.shipping_usd > 0) && (
                      <p className="mt-1 text-muted">
                        {req.shipping_method || 'Shipping'}
                        {req.shipping_usd > 0 ? ` · $${req.shipping_usd.toFixed(2)}` : ''}
                      </p>
                    )}
                    {req.tracking_number || req.shipped_at ? (
                      <p className="mt-1 font-medium text-electric">
                        Shipped
                        {req.tracking_number
                          ? ` · ${req.tracking_carrier || 'UPS'} ${req.tracking_number}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                )}
                {req.paid_at && !req.shipped_at && !req.tracking_number && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="text-xs text-muted">
                        UPS tracking
                        <input
                          className="mt-1 block rounded-lg border px-2 py-1.5 text-sm text-navy"
                          placeholder="1Z…"
                          value={shipTracking[req.id] || ''}
                          onChange={(e) =>
                            setShipTracking((m) => ({ ...m, [req.id]: e.target.value }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={busyId === req.id}
                        onClick={() => {
                          const trackingNumber = (shipTracking[req.id] || '').trim()
                          if (!trackingNumber) {
                            setError('Enter a UPS tracking number.')
                            return
                          }
                          setBusyId(req.id)
                          setError('')
                          void api.catalog.orders
                            .shipCustom(req.id, { trackingNumber, carrier: 'UPS' })
                            .then(() => load())
                            .catch((e) =>
                              setError(e instanceof Error ? e.message : 'Ship update failed'),
                            )
                            .finally(() => setBusyId(null))
                        }}
                      >
                        Mark shipped
                      </button>
                    </div>
                  )}
                {(req.grams_pablo_p1s != null ||
                  req.grams_court_ender != null ||
                  req.grams_josh_kobra != null) && (
                  <p className="mt-1 text-xs text-muted">
                    P1S {req.grams_pablo_p1s ?? '—'}g / {req.hours_pablo_p1s ?? '—'}h · Ender{' '}
                    {req.grams_court_ender ?? '—'}g / {req.hours_court_ender ?? '—'}h · Kobra{' '}
                    {req.grams_josh_kobra ?? '—'}g / {req.hours_josh_kobra ?? '—'}h
                  </p>
                )}
                {req.slice_error ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-amber-700">{req.slice_error}</p>
                ) : null}
                {req.uploaded_file && (
                  <button
                    type="button"
                    className="mt-1 inline-block text-xs font-medium text-electric hover:underline"
                    disabled={busyId === req.id}
                    onClick={() => {
                      setBusyId(req.id)
                      setError('')
                      void api.admin.requests
                        .downloadSource(req.uploaded_file!)
                        .catch((e) =>
                          setError(e instanceof Error ? e.message : 'Source download failed'),
                        )
                        .finally(() => setBusyId(null))
                    }}
                  >
                    Download source model
                  </button>
                )}
                <p className="mt-2 text-xs text-muted">Submitted {new Date(req.created_at).toLocaleString()}</p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                {isMainAdmin && (req.status === 'new' || req.status === 'reviewing') && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      disabled={busyId === req.id || !req.has_gcode}
                      title={!req.has_gcode ? 'G-code not available yet (or cleared after decline)' : undefined}
                      onClick={() => void accept(req.id)}
                    >
                      Accept & download G-code
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
                {isMainAdmin && req.status === 'approved' && req.has_gcode && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    disabled={busyId === req.id}
                    onClick={() => {
                      setBusyId(req.id)
                      void api.admin.requests
                        .downloadGcode(req.id)
                        .catch((e) => setError(e instanceof Error ? e.message : 'Download failed'))
                        .finally(() => setBusyId(null))
                    }}
                  >
                    Download G-code again
                  </button>
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
                <button
                  type="button"
                  className="btn btn-ghost btn-compact text-red-600"
                  disabled={busyId === req.id}
                  onClick={() => void remove(req.id, req.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
