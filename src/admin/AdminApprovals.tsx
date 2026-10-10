import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { api } from '../lib/api'
import { adminHomePath } from '../lib/portal'
import { BUILTIN_COLORS } from '../../shared/colors'
import type { Design, PricingSettingsDto, PrinterDto } from '../types/catalog'
import { StlViewer } from './StlViewer'

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-navy">Approvals & Pricing</h1>
        <p className="mt-1 text-sm text-muted">
          Main admin only — review STL previews, cost inputs, custom colors, and approve designs for the shop.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-electric">{message}</p>}

      {settings && (
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="font-semibold text-navy">Cost model inputs</h2>
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
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: Number(e.target.value) })
                  }
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

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="font-semibold text-navy">Pending approval ({pending.length})</h2>
        <div className="mt-4 space-y-4">
          {pending.length === 0 && <p className="text-sm text-muted">No designs waiting.</p>}
          {pending.map((d) => (
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
                        P1S {d.gramsPabloP1s}g / {d.hoursPabloP1s}h · Ender {d.gramsCourtEnder}g /{' '}
                        {d.hoursCourtEnder}h · Kobra {d.gramsJoshKobra}g / {d.hoursJoshKobra}h
                      </p>
                      {d.description ? (
                        <p className="mt-2 text-sm text-muted line-clamp-3">{d.description}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        onClick={() =>
                          void api.catalog.designs
                            .approve(d.id)
                            .then(() => load())
                            .catch((e) => setError(e instanceof Error ? e.message : 'Approve failed'))
                        }
                      >
                        Approve + price
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() =>
                          void api.catalog.designs
                            .reject(d.id, 'Needs changes')
                            .then(() => load())
                            .catch((e) => setError(e instanceof Error ? e.message : 'Reject failed'))
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
                {d.hasStl ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      3D preview
                    </p>
                    <StlViewer url={api.catalog.designs.stlUrl(d.id)} height={240} />
                  </div>
                ) : (
                  <p className="self-center text-sm text-muted">No STL on file.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="font-semibold text-navy">Approved in catalog ({approved.length})</h2>
        <div className="mt-4 space-y-3">
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
    </div>
  )
}
