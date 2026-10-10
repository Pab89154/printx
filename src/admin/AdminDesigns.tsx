import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { BUILTIN_COLORS } from '../../shared/colors'
import type { Design } from '../types/catalog'
import { resolveImageUrl } from '../lib/imageUrl'
import { StlViewer } from './StlViewer'

const emptyForm = {
  name: '',
  skuBase: '',
  description: '',
  category: 'General',
  imageUrl: '',
  stlPath: '',
  hasStl: false,
  availableColorIds: ['black', 'white'] as string[],
}

export function AdminDesigns() {
  const [designs, setDesigns] = useState<Design[]>([])
  const [extraColors, setExtraColors] = useState<{ id: string; name: string; hex: string }[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadingStl, setUploadingStl] = useState(false)

  async function load() {
    const [list, pricing] = await Promise.all([
      api.catalog.designs.list(),
      api.catalog.pricing.get().catch(() => null),
    ])
    setDesigns(list)
    if (pricing) {
      setExtraColors(
        pricing.customColors.filter((c) => c.name.trim()).map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
      )
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  const colorOptions = [
    ...BUILTIN_COLORS.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    ...extraColors,
  ]

  function toPayload() {
    return {
      name: form.name,
      skuBase: form.skuBase || undefined,
      description: form.description,
      category: form.category,
      imageUrl: form.imageUrl,
      stlPath: form.stlPath || undefined,
      availableColorIds: form.availableColorIds,
    }
  }

  function startEdit(d: Design) {
    setEditingId(d.id)
    setForm({
      name: d.name,
      skuBase: d.skuBase,
      description: d.description,
      category: d.category,
      imageUrl: d.imageUrl,
      stlPath: '',
      hasStl: d.hasStl,
      availableColorIds: d.availableColorIds,
    })
  }

  async function uploadImage(file: File) {
    const { url } = await api.admin.products.uploadImage(file)
    setForm((f) => ({ ...f, imageUrl: resolveImageUrl(url) }))
  }

  async function uploadStl(file: File) {
    setUploadingStl(true)
    setError('')
    try {
      const { stlPath, hasStl } = await api.catalog.designs.uploadStl(file)
      setForm((f) => ({ ...f, stlPath, hasStl }))
      setMessage('STL uploaded. Grams/hours fill automatically when you submit for approval.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'STL upload failed')
    } finally {
      setUploadingStl(false)
    }
  }

  const previewStlUrl =
    editingId && form.hasStl && !form.stlPath ? api.catalog.designs.stlUrl(editingId) : ''

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-navy">Designs</h1>
        <p className="mt-1 text-sm text-muted">
          Same catalog for the online shop and in-person stands. Upload an STL — on submit, PrintX quotes
          Pablo / Court / Josh via Cloud Slicer and fills grams/hours.
        </p>
      </div>

      {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-electric">{message}</p>}

      <form
        className="rounded-2xl border bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.hasStl && !form.stlPath) {
            setError('Upload an STL before saving.')
            return
          }
          setBusy(true)
          setError('')
          setMessage('')
          const run = editingId
            ? api.catalog.designs.update(editingId, toPayload())
            : api.catalog.designs.create(toPayload())
          void run
            .then(() => {
              setForm(emptyForm)
              setEditingId(null)
              setMessage(editingId ? 'Design updated.' : 'Design saved as draft.')
              return load()
            })
            .catch((err) => setError(err instanceof Error ? err.message : 'Save failed'))
            .finally(() => setBusy(false))
        }}
      >
        <h2 className="font-semibold text-navy">{editingId ? 'Edit design' : 'New design'}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Name
            <input
              required
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="text-sm font-medium">
            SKU base (optional)
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="PX-FIDGET-STAR"
              value={form.skuBase}
              onChange={(e) => setForm({ ...form, skuBase: e.target.value })}
            />
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium">
          Description
          <textarea
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label className="text-sm font-medium">
              STL file (required)
              <input
                type="file"
                accept=".stl,model/stl"
                className="mt-1 block text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadStl(f)
                }}
              />
            </label>
            <p className="mt-1 text-xs text-muted">
              {uploadingStl
                ? 'Uploading…'
                : form.hasStl || form.stlPath
                  ? 'STL on file.'
                  : 'Max 50MB binary/ASCII STL.'}
            </p>
            {previewStlUrl ? <StlViewer url={previewStlUrl} className="mt-3" /> : null}
          </div>
          <div>
            <label className="text-sm font-medium">
              Shop image (optional)
              <input
                type="file"
                accept="image/*"
                className="mt-1 block text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadImage(f).catch((err) => setError(err instanceof Error ? err.message : 'Upload failed'))
                }}
              />
            </label>
            {form.imageUrl ? (
              <img src={form.imageUrl} alt="" className="mt-3 h-24 w-24 rounded-lg object-cover" />
            ) : null}
          </div>
        </div>

        <h3 className="mt-6 text-sm font-semibold text-navy">Available colors</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {colorOptions.map((c) => {
            const on = form.availableColorIds.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  on ? 'border-electric bg-electric/10 text-electric' : 'border-slate-200'
                }`}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    availableColorIds: on
                      ? f.availableColorIds.filter((x) => x !== c.id)
                      : [...f.availableColorIds, c.id],
                  }))
                }
              >
                <span className="h-3 w-3 rounded-full border" style={{ background: c.hex }} />
                {c.name}
              </button>
            )
          })}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy || uploadingStl}>
            {busy ? 'Saving…' : editingId ? 'Update draft' : 'Save draft'}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || uploadingStl}
              onClick={() => {
                setBusy(true)
                setError('')
                setMessage('Submitting — quoting all 3 printers via Cloud Slicer…')
                void api.catalog.designs
                  .update(editingId, toPayload())
                  .then(() => api.catalog.designs.submit(editingId))
                  .then(() => {
                    setMessage('Submitted for approval (grams/hours filled from Cloud Slicer).')
                    setEditingId(null)
                    setForm(emptyForm)
                    return load()
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : 'Submit failed'))
                  .finally(() => setBusy(false))
              }}
            >
              Submit for approval
            </button>
          )}
          {editingId && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditingId(null)
                setForm(emptyForm)
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="font-semibold text-navy">All designs</h2>
        <div className="mt-4 space-y-3">
          {designs.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {d.imageUrl ? (
                  <img src={d.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-[10px] font-bold text-muted">
                    {d.hasStl ? 'STL' : '—'}
                  </div>
                )}
                <div>
                  <p className="font-medium text-navy">{d.name}</p>
                  <p className="text-xs text-muted">
                    {d.skuBase} · <span className="uppercase">{d.status.replace('_', ' ')}</span>
                    {d.hasStl ? ' · STL' : ' · no STL'}
                    {d.sliceStatus !== 'idle' ? ` · slice ${d.sliceStatus}` : ''}
                    {d.catalogPriceUsd != null ? ` · $${d.catalogPriceUsd.toFixed(2)}` : ''}
                  </p>
                  {d.sliceStatus === 'ready' ? (
                    <p className="text-xs text-muted">
                      P1S {d.gramsPabloP1s}g / {d.hoursPabloP1s}h · Ender {d.gramsCourtEnder}g /{' '}
                      {d.hoursCourtEnder}h · Kobra {d.gramsJoshKobra}g / {d.hoursJoshKobra}h
                    </p>
                  ) : null}
                  {d.sliceError ? <p className="whitespace-pre-wrap text-xs text-amber-700">{d.sliceError}</p> : null}
                  {d.reviewNote ? <p className="text-xs text-amber-700">{d.reviewNote}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => startEdit(d)}>
                  Edit
                </button>
                {d.status === 'draft' || d.status === 'rejected' ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={() => {
                      setBusy(true)
                      setMessage('Submitting — quoting all 3 printers…')
                      void api.catalog.designs
                        .submit(d.id)
                        .then(() => {
                          setMessage('Submitted for approval.')
                          return load()
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : 'Submit failed'))
                        .finally(() => setBusy(false))
                    }}
                  >
                    Submit
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-compact text-red-600"
                  onClick={() =>
                    void api.catalog.designs
                      .remove(d.id)
                      .then(() => load())
                      .catch((err) => setError(err instanceof Error ? err.message : 'Delete failed'))
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {designs.length === 0 && <p className="text-sm text-muted">No designs yet.</p>}
        </div>
      </section>
    </div>
  )
}
