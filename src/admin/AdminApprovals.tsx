import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import { adminHomePath } from '../lib/portal'
import { BUILTIN_COLORS } from '../../shared/colors'
import type { Design, PricingSettingsDto, PrinterDto } from '../types/catalog'
import { StlViewer } from './StlViewer'

/** Approve when at least one printer has grams/hours (others can fill in later). */
function hasQuoteInputs(d: Design): boolean {
  if (d.availableColorIds.length === 0) return false
  return (
    (d.gramsPabloP1s != null && d.hoursPabloP1s != null) ||
    (d.gramsCourtEnder != null && d.hoursCourtEnder != null) ||
    (d.gramsJoshKobra != null && d.hoursJoshKobra != null)
  )
}

function designHasAllThree(d: Design): boolean {
  return (
    d.gramsPabloP1s != null &&
    d.hoursPabloP1s != null &&
    d.gramsCourtEnder != null &&
    d.hoursCourtEnder != null &&
    d.gramsJoshKobra != null &&
    d.hoursJoshKobra != null
  )
}

export function AdminApprovals() {
  const { isMainAdmin } = useAdminAuth()
  const [designs, setDesigns] = useState<Design[]>([])
  const [settings, setSettings] = useState<PricingSettingsDto | null>(null)
  const [printers, setPrinters] = useState<PrinterDto[]>([])
  const [customColors, setCustomColors] = useState<
    { id: string; name: string; hex: string; code: string }[]
  >([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const [d, p] = await Promise.all([api.catalog.designs.list(), api.catalog.pricing.get()])
    setDesigns(d)
    setSettings(p.settings)
    setPrinters(p.printers)
    setCustomColors(p.customColors)
  }

  useEffect(() => {
    if (isMainAdmin) void load().catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [isMainAdmin])

  if (!isMainAdmin) return <Navigate to={adminHomePath()} replace />

  const pending = designs.filter((d) => d.status === 'pending_review')
  const drafts = designs.filter((d) => (d.status === 'draft' || d.status === 'rejected') && d.hasStl)
  const approved = designs.filter((d) => d.status === 'approved')

  async function savePricing() {
    if (!settings) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const next = await api.catalog.pricing.update({
        filamentUsdPerGram: settings.filamentUsdPerGram,
        electricityUsdPerKwh: settings.electricityUsdPerKwh,
        marginPct: settings.marginPct,
        unproductiveAdderUsd: settings.unproductiveAdderUsd,
        fixingAdderUsd: settings.fixingAdderUsd,
        salesTaxPct: settings.salesTaxPct,
        customColors,
        printers: printers.map((p) => ({ id: p.id, avgPowerKw: p.avgPowerKw })),
      })
      setSettings(next.settings)
      setPrinters(next.printers)
      setCustomColors(next.customColors)
      setMessage('Pricing settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function DesignPreview({ d }: { d: Design }) {
    if (d.hasStl && (d.modelExt === '.stl' || !d.modelExt)) {
      return (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">3D preview</p>
          <StlViewer url={api.catalog.designs.stlUrl(d.id)} height={240} />
        </div>
      )
    }
    if (d.hasStl) {
      return (
        <p className="self-center text-sm text-muted">
          Model on file ({(d.modelExt || '').replace('.', '').toUpperCase() || '3D'}) — preview is
          STL-only.
        </p>
      )
    }
    return <p className="self-center text-sm text-muted">No model on file.</p>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-navy">Approvals & Pricing</h1>
        <p className="mt-1 text-sm text-muted">
          Main admin only — review models first, then pricing inputs below.
        </p>
      </div>

      {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}
      {message && <p className="whitespace-pre-wrap text-sm text-electric">{message}</p>}

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="font-semibold text-navy">Pending approval ({pending.length})</h2>
        <div className="mt-4 space-y-4">
          {pending.length === 0 && <p className="text-sm text-muted">No designs waiting.</p>}
          {pending.map((d) => {
            const ready = hasQuoteInputs(d)
            return (
              <div key={d.id} className="rounded-xl border border-slate-100 p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-navy">{d.name}</p>
                        <p className="text-xs text-muted">
                          SKU {d.skuBase} · colors {d.availableColorIds.join(', ') || '—'}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          P1S {d.gramsPabloP1s ?? '—'}g / {d.hoursPabloP1s ?? '—'}h · Ender 3v2{' '}
                          {d.gramsCourtEnder ?? '—'}g / {d.hoursCourtEnder ?? '—'}h · Kobra X{' '}
                          {d.gramsJoshKobra ?? '—'}g / {d.hoursJoshKobra ?? '—'}h
                        </p>
                        {d.sliceError ? (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-amber-700">{d.sliceError}</p>
                        ) : null}
                        {!ready ? (
                          <p className="mt-2 text-xs text-amber-700">
                            No printer quotes yet — link at least one admin Cloud Slicer account, then
                            Re-quote missing. You can approve once any printer has grams/hours.
                          </p>
                        ) : !designHasAllThree(d) ? (
                          <p className="mt-2 text-xs text-muted">
                            Pricing uses the worst quoted printer so far. Missing printers can fill in
                            later when their Cloud Slicer is set up.
                          </p>
                        ) : null}
                        {d.description ? (
                          <p className="mt-2 text-sm text-muted line-clamp-3">{d.description}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-primary btn-compact"
                          disabled={!ready || busyId === d.id}
                          onClick={() => {
                            setBusyId(d.id)
                            setError('')
                            void api.catalog.designs
                              .approve(d.id)
                              .then(() => load())
                              .catch((e) => setError(e instanceof Error ? e.message : 'Approve failed'))
                              .finally(() => setBusyId(null))
                          }}
                        >
                          Approve + price
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={busyId === d.id}
                          onClick={() => {
                            setBusyId(d.id)
                            setError('')
                            setMessage('Re-quoting via Cloud Slicer…')
                            void api.catalog.designs
                              .requote(d.id)
                              .then((res) => {
                                setMessage(
                                  res.sliceWarning
                                    ? `Filled missing quotes. Note:\n${res.sliceWarning}`
                                    : 'Missing quotes filled (existing printer quotes kept).',
                                )
                                return load()
                              })
                              .catch((e) => setError(e instanceof Error ? e.message : 'Re-quote failed'))
                              .finally(() => setBusyId(null))
                          }}
                        >
                          Re-quote missing
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={busyId === d.id}
                          onClick={() => {
                            setBusyId(d.id)
                            void api.catalog.designs
                              .reject(d.id, 'Needs changes')
                              .then(() => load())
                              .catch((e) => setError(e instanceof Error ? e.message : 'Reject failed'))
                              .finally(() => setBusyId(null))
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                  <DesignPreview d={d} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {drafts.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6">
          <h2 className="font-semibold text-navy">Drafts with a model ({drafts.length})</h2>
          <p className="mt-1 text-sm text-muted">
            Saved but not submitted yet — send them here to appear under Pending approval.
          </p>
          <div className="mt-4 space-y-3">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
              >
                <div>
                  <p className="font-medium text-navy">{d.name}</p>
                  <p className="text-xs text-muted">
                    {d.skuBase} · {d.status.replace('_', ' ')}
                    {d.sliceError ? ' · quote error' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  disabled={busyId === d.id}
                  onClick={() => {
                    setBusyId(d.id)
                    setError('')
                    setMessage('Submitting for approval…')
                    void api.catalog.designs
                      .submit(d.id)
                      .then((res) => {
                        setMessage(
                          res.sliceWarning
                            ? `Queued for approval. Quote note: ${res.sliceWarning}`
                            : 'Queued for approval.',
                        )
                        return load()
                      })
                      .catch((e) => setError(e instanceof Error ? e.message : 'Submit failed'))
                      .finally(() => setBusyId(null))
                  }}
                >
                  Submit for approval
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="font-semibold text-navy">Approved in catalog ({approved.length})</h2>
        <div className="mt-4 space-y-3">
          {approved.length === 0 && <p className="text-sm text-muted">None approved yet.</p>}
          {approved.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3"
            >
              <div>
                <p className="font-medium text-navy">{d.name}</p>
                <p className="text-xs text-muted">
                  Worst cost ${d.worstCostUsd?.toFixed(2)} → catalog ${d.catalogPriceUsd?.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() =>
                  void api.catalog.designs
                    .reprice(d.id)
                    .then(() => load())
                    .catch((e) => setError(e instanceof Error ? e.message : 'Reprice failed'))
                }
              >
                Recalculate price
              </button>
            </div>
          ))}
        </div>
      </section>

      {settings && (
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="font-semibold text-navy">Pricing</h2>
          <p className="mt-1 text-sm text-muted">Cost model used when you approve a design.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['filamentUsdPerGram', 'Filament $/gram'],
                ['electricityUsdPerKwh', 'Electricity $/kWh'],
                ['marginPct', 'Margin (0.5 = 50%)'],
                ['unproductiveAdderUsd', 'Unproductive adder $'],
                ['fixingAdderUsd', 'Fixing adder $'],
                ['salesTaxPct', 'Sales tax (0 = off)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm font-medium text-navy">
                {label}
                <input
                  type="number"
                  step="any"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>

          <h3 className="mt-6 text-sm font-semibold text-navy">Printer power (kW)</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {printers.map((p) => (
              <label key={p.id} className="block text-sm text-navy">
                {p.ownerLabel} — {p.modelName}
                <input
                  type="number"
                  step="0.01"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={p.avgPowerKw}
                  onChange={(e) =>
                    setPrinters((list) =>
                      list.map((x) =>
                        x.id === p.id ? { ...x, avgPowerKw: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>

          <h3 className="mt-6 text-sm font-semibold text-navy">
            Extra color slots (5) — leave name blank to hide
          </h3>
          <div className="mt-3 space-y-3">
            {customColors.map((c, i) => (
              <div key={c.id} className="grid gap-2 sm:grid-cols-4">
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder={`Custom color ${i + 1} name`}
                  value={c.name}
                  onChange={(e) =>
                    setCustomColors((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Code"
                  value={c.code}
                  onChange={(e) =>
                    setCustomColors((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, code: e.target.value } : x)),
                    )
                  }
                />
                <input
                  type="color"
                  className="h-10 w-full rounded-xl border border-slate-200"
                  value={c.hex}
                  onChange={(e) =>
                    setCustomColors((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, hex: e.target.value } : x)),
                    )
                  }
                />
                <p className="self-center text-xs text-muted">{c.hex}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted">
            Built-ins always available: {BUILTIN_COLORS.map((c) => c.name).join(', ')}.
          </p>

          <button
            type="button"
            className="btn btn-primary mt-6"
            disabled={saving}
            onClick={() => void savePricing()}
          >
            {saving ? 'Saving…' : 'Save pricing'}
          </button>
        </section>
      )}
    </div>
  )
}
