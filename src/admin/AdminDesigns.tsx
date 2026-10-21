import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../lib/api'
import { useAdminAuth } from '../context/AdminAuthContext'
import {
  MULTICOLOR_COLOR_ID,
  MULTICOLOR_SLOT_DEFAULT,
  MULTICOLOR_SLOT_MAX,
  MULTICOLOR_SLOT_MIN,
  clampMulticolorSlotCount,
  colorSwatchStyle,
  defaultMulticolorPartLabel,
  solidBuiltinColors,
} from '../../shared/colors'
import { MODEL_ACCEPT, modelLabel } from '../../shared/modelFormats'
import type { Design } from '../types/catalog'
import { formatSizeMm } from '../../shared/sizeLabel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MultiStlViewer, StlViewer } from '../components/StlViewer'

function realisticImageLabel(status: Design['realisticImageStatus']): string {
  switch (status) {
    case 'ready':
      return 'Realistic image ready'
    case 'pending':
      return 'Realistic image queued'
    case 'rendering':
      return 'Rendering model for realistic image…'
    case 'processing':
      return 'Generating realistic image…'
    case 'error':
      return 'Realistic image failed'
    default:
      return 'Realistic image not generated yet'
  }
}

function realisticColorSummary(d: Design): string {
  const rows = d.realisticColorImages ?? []
  if (!rows.length) return ''
  const ready = rows.filter((r) => r.status === 'ready').length
  const active = rows.filter((r) =>
    ['pending', 'rendering', 'processing'].includes(r.status),
  ).length
  const failed = rows.filter((r) => r.status === 'error').length
  return (
    `${ready}/${rows.length} color photos ready` +
    (active ? ` · ${active} generating` : '') +
    (failed ? ` · ${failed} failed` : '')
  )
}

type PartForm = {
  label: string
  stlPath: string
  hasStl: boolean
  modelExt: string
  localPreviewUrl: string
  /** Colors allowed for this part only. Empty = any design color. */
  colorIds: string[]
}


function emptyParts(count: number, existing?: PartForm[]): PartForm[] {
  const n = clampMulticolorSlotCount(count)
  return Array.from({ length: n }, (_, i) => {
    const prev = existing?.[i]
    return {
      label: prev?.label?.trim() || defaultMulticolorPartLabel(i),
      stlPath: prev?.stlPath || '',
      hasStl: Boolean(prev?.hasStl || prev?.stlPath),
      modelExt: prev?.modelExt || '',
      localPreviewUrl: prev?.localPreviewUrl || '',
      colorIds: [...(prev?.colorIds ?? [])],
    }
  })
}

const emptyForm = {
  name: '',
  skuBase: '',
  description: '',
  category: 'General',
  imageUrl: '',
  stlPath: '',
  hasStl: false,
  modelExt: '',
  sourceGcodePath: '',
  fromGcode: false,
  sizeXMm: null as number | null,
  sizeYMm: null as number | null,
  sizeZMm: null as number | null,
  availableColorIds: ['black', 'white'] as string[],
  mainColorId: 'black',
  multicolorOnly: false,
  multicolorSlotCount: MULTICOLOR_SLOT_DEFAULT,
  parts: emptyParts(MULTICOLOR_SLOT_DEFAULT) as PartForm[],
}

export function AdminDesigns() {
  const { isMainAdmin } = useAdminAuth()
  const [designs, setDesigns] = useState<Design[]>([])
  const [extraColors, setExtraColors] = useState<{ id: string; name: string; hex: string }[]>([])
  const [stockIds, setStockIds] = useState<string[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadingStl, setUploadingStl] = useState(false)
  /** 0–100 while a big (>40 MB) model uploads in pieces; null otherwise. */
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  /** Local blob preview for a just-uploaded STL (server preview only works after save). */
  const [localPreviewUrl, setLocalPreviewUrl] = useState('')
  /**
   * 3D previews are heavy on low-memory Chromebooks (a live viewer running
   * during an upload could black-screen the tab), so they only mount when
   * the admin explicitly asks. Any upload or edit switch disarms again.
   */
  const [previewArmed, setPreviewArmed] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const modelInputRef = useRef<HTMLInputElement>(null)
  const localPreviewUrlRef = useRef('')

  function clearLocalPreview() {
    if (localPreviewUrlRef.current) {
      URL.revokeObjectURL(localPreviewUrlRef.current)
      localPreviewUrlRef.current = ''
    }
    setLocalPreviewUrl('')
  }

  function revokePartPreviews(parts: PartForm[]) {
    for (const p of parts) {
      if (p.localPreviewUrl) URL.revokeObjectURL(p.localPreviewUrl)
    }
  }

  function resetForm() {
    revokePartPreviews(form.parts)
    clearLocalPreview()
    setPreviewArmed(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  async function load() {
    const [list, pricing, filaments] = await Promise.all([
      api.catalog.designs.list(),
      api.catalog.pricing.get().catch(() => null),
      api.admin.settings.filamentColors().catch(() => null),
    ])
    setDesigns(list)
    if (filaments) setStockIds(filaments.inStock)
    if (pricing) {
      setExtraColors(
        pricing.customColors.filter((c) => c.name.trim()).map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
      )
    }
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
    return () => clearLocalPreview()
  }, [])

  useEffect(() => {
    if (editingId || !stockIds.length) return
    setForm((f) => {
      const untouched =
        !f.name &&
        f.availableColorIds.length === 2 &&
        f.availableColorIds.includes('black') &&
        f.availableColorIds.includes('white')
      if (!untouched) return f
      return { ...f, availableColorIds: stockIds, mainColorId: stockIds[0] || f.mainColorId }
    })
  }, [stockIds, editingId])

  const realisticActive = designs.some(
    (d) =>
      ['pending', 'rendering', 'processing'].includes(d.realisticImageStatus || '') ||
      (d.realisticColorImages ?? []).some((r) =>
        ['pending', 'rendering', 'processing'].includes(r.status),
      ),
  )
  useEffect(() => {
    if (!realisticActive) return
    let running = false
    const timer = window.setInterval(() => {
      // Never stack refreshes — a slow one already in flight is enough.
      if (running) return
      running = true
      void load()
        .catch(() => undefined)
        .finally(() => {
          running = false
        })
    }, 30000)
    return () => window.clearInterval(timer)
  }, [realisticActive])

  const slicingId = designs.find((d) => d.sliceStatus === 'slicing')?.id ?? ''
  useEffect(() => {
    if (!slicingId) return
    let cancelled = false
    const pump = async () => {
      while (!cancelled) {
        try {
          const next = await api.catalog.designs.quoteTick(slicingId)
          if (cancelled) return
          setDesigns((prev) => prev.map((d) => (d.id === next.id ? next : d)))
          if (next.sliceStatus !== 'slicing') return
          await new Promise((r) => setTimeout(r, 15000))
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Quoting failed')
          await new Promise((r) => setTimeout(r, 4000))
        }
      }
    }
    void pump()
    return () => {
      cancelled = true
    }
  }, [slicingId])

  const stockedBasics = solidBuiltinColors().filter((c) => !stockIds.length || stockIds.includes(c.id))
  const colorOptions = [
    ...stockedBasics.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    ...extraColors,
  ]

  function togglePartColor(partIndex: number, colorId: string) {
    setForm((f) => {
      const parts = [...f.parts]
      const part = parts[partIndex]
      if (!part) return f
      const selected = part.colorIds.includes(colorId)
      parts[partIndex] = {
        ...part,
        colorIds: selected
          ? part.colorIds.filter((id) => id !== colorId)
          : [...part.colorIds, colorId],
      }
      // A part-specific color must also be one of the design's offered colors.
      const availableColorIds =
        selected || f.availableColorIds.includes(colorId)
          ? f.availableColorIds
          : [...f.availableColorIds, colorId]
      return {
        ...f,
        parts,
        availableColorIds,
        mainColorId: f.mainColorId || colorId,
      }
    })
  }

  function clearPartColors(partIndex: number) {
    setForm((f) => {
      const parts = [...f.parts]
      if (!parts[partIndex]) return f
      parts[partIndex] = { ...parts[partIndex]!, colorIds: [] }
      return { ...f, parts }
    })
  }

  function toPayload() {
    const parts = form.multicolorOnly
      ? form.parts.map((p) => ({
          label: p.label.trim() || 'Part',
          colorIds: [...p.colorIds],
          ...(p.stlPath ? { stlPath: p.stlPath } : {}),
        }))
      : []
    // Multicolor: no separate "main" upload — quote/slice uses the first part STL.
    const mainStlPath =
      form.stlPath ||
      (form.multicolorOnly ? form.parts.find((p) => p.stlPath)?.stlPath || '' : '')
    return {
      name: form.name,
      // No skuBase: the server makes it from the name (and never changes
      // an existing design's, so shop links stay put).
      description: form.description,
      category: form.category,
      imageUrl: '',
      // Only send when a new upload is pending — never send '' (that used to wipe stl_path).
      ...(mainStlPath ? { stlPath: mainStlPath } : {}),
      ...(form.sourceGcodePath ? { sourceGcodePath: form.sourceGcodePath } : {}),
      multicolorOnly: form.multicolorOnly,
      multicolorSlotCount: form.multicolorSlotCount,
      availableColorIds: form.availableColorIds.filter((id) => id !== MULTICOLOR_COLOR_ID),
      mainColorId: form.mainColorId,
      parts,
    }
  }

  function partsReady() {
    return form.parts.every((p) => Boolean(p.hasStl || p.stlPath))
  }

  function startEdit(d: Design) {
    clearLocalPreview()
    setPreviewArmed(false)
    setEditingId(d.id)
    const solids = d.availableColorIds.filter((id) => id !== MULTICOLOR_COLOR_ID)
    const slotCount = clampMulticolorSlotCount(d.multicolorSlotCount ?? MULTICOLOR_SLOT_DEFAULT)
    const parts = emptyParts(
      slotCount,
      (d.parts ?? []).map((p) => ({
        label: p.label,
        stlPath: '',
        hasStl: Boolean(p.hasStl),
        modelExt: p.modelExt || '',
        localPreviewUrl: '',
        colorIds: [...(p.colorIds ?? [])],
      })),
    )
    setForm({
      name: d.name,
      skuBase: d.skuBase,
      description: d.description,
      category: d.category,
      imageUrl: '',
      stlPath: '',
      hasStl: d.hasStl,
      modelExt: d.modelExt || '',
      sourceGcodePath: '',
      fromGcode: Boolean(d.fromGcode),
      sizeXMm: d.sizeXMm ?? null,
      sizeYMm: d.sizeYMm ?? null,
      sizeZMm: d.sizeZMm ?? null,
      availableColorIds: solids.length ? solids : ['black', 'white'],
      mainColorId:
        d.mainColorId && solids.includes(d.mainColorId) ? d.mainColorId : solids[0] || 'black',
      multicolorOnly: Boolean(d.multicolorOnly),
      multicolorSlotCount: slotCount,
      parts,
    })
  }

  async function uploadPartModel(index: number, file: File) {
    if (file.size > 100 * 1024 * 1024) {
      setError(
        `That file is ${(file.size / 1048576).toFixed(0)} MB — the biggest model we can take is 100 MB. In your design app, look for “decimate” or “reduce mesh” to shrink it, then try again.`,
      )
      return
    }
    setUploadingStl(true)
    setUploadPct(null)
    setPreviewArmed(false)
    setError('')
    setMessage('')
    try {
      if (file.name.toLowerCase().endsWith('.gcode')) {
        throw new Error('Multicolor parts must be STL files.')
      }
      const { stlPath, hasStl, modelExt } =
        file.size > 40 * 1024 * 1024
          ? await api.catalog.designs.directUploadModel(file, (f) =>
              setUploadPct(Math.round(f * 100)),
            )
          : await api.catalog.designs.uploadModel(file)
      if (!stlPath || !hasStl) {
        throw new Error('Upload finished but the server did not confirm the file. Try again.')
      }
      setForm((f) => {
        const parts = [...f.parts]
        const prev = parts[index]
        if (prev?.localPreviewUrl) URL.revokeObjectURL(prev.localPreviewUrl)
        const localPreviewUrl =
          modelExt === '.stl' || file.name.toLowerCase().endsWith('.stl')
            ? URL.createObjectURL(file)
            : ''
        parts[index] = {
          label: prev?.label || defaultMulticolorPartLabel(index),
          stlPath,
          hasStl: true,
          modelExt,
          localPreviewUrl,
        }
        return { ...f, parts }
      })
      setMessage(
        `${modelLabel(modelExt)} uploaded for ${defaultMulticolorPartLabel(index)} — Save draft to attach.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Part model upload failed')
    } finally {
      setUploadingStl(false)
      setUploadPct(null)
    }
  }

  async function uploadModel(file: File) {
    if (file.size > 100 * 1024 * 1024) {
      setError(
        `That file is ${(file.size / 1048576).toFixed(0)} MB — the biggest model we can take is 100 MB. In your design app, look for “decimate” or “reduce mesh” to shrink it, then try again.`,
      )
      return
    }
    setUploadingStl(true)
    setUploadPct(null)
    setPreviewArmed(false)
    setError('')
    setMessage('')
    try {
      const uploaded =
        file.size > 40 * 1024 * 1024
          ? file.name.toLowerCase().endsWith('.gcode')
            ? await Promise.reject(
                new Error('G-code files that big are not supported yet — please upload the STL instead.'),
              )
            : await api.catalog.designs.directUploadModel(file, (f) =>
                setUploadPct(Math.round(f * 100)),
              )
          : await api.catalog.designs.uploadModel(file)
      if (!uploaded.stlPath || !uploaded.hasStl) {
        throw new Error('Upload finished but the server did not confirm the file. Try again.')
      }
      clearLocalPreview()
      const fromGcode = Boolean(uploaded.fromGcode)
      if (!fromGcode && (uploaded.modelExt === '.stl' || file.name.toLowerCase().endsWith('.stl'))) {
        const blobUrl = URL.createObjectURL(file)
        localPreviewUrlRef.current = blobUrl
        setLocalPreviewUrl(blobUrl)
      }
      setForm((f) => ({
        ...f,
        stlPath: uploaded.stlPath,
        hasStl: true,
        modelExt: fromGcode ? '.gcode' : uploaded.modelExt,
        sourceGcodePath: uploaded.sourceGcodePath || '',
        fromGcode,
        sizeXMm: uploaded.sizeXMm ?? f.sizeXMm,
        sizeYMm: uploaded.sizeYMm ?? f.sizeYMm,
        sizeZMm: uploaded.sizeZMm ?? f.sizeZMm,
      }))
      const sliceNote = fromGcode
        ? 'Filament and time come from the file, so it will not be sliced. The 3D preview is the printed toolpath, not the original solid. Save draft to see it.'
        : 'Grams and hours fill automatically when you submit for approval.'
      setMessage(
        `${fromGcode ? 'G-code' : modelLabel(uploaded.modelExt)} uploaded — click Save draft to attach it to this design. ${sliceNote}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model upload failed')
    } finally {
      setUploadingStl(false)
      setUploadPct(null)
  }
  }

  const modelOnFile = Boolean(form.hasStl || form.stlPath)
  const canPreview3d =
    form.fromGcode || form.modelExt === '.stl' || (!form.modelExt && form.hasStl)
  // Prefer local blob right after upload; otherwise load from server once the design is saved.
  const previewStlUrl = canPreview3d
    ? localPreviewUrl ||
      (editingId && form.hasStl && !form.stlPath ? api.catalog.designs.stlUrl(editingId) : '')
    : ''
  const multicolorColorCount = new Set([
    ...form.availableColorIds.filter((id) => id !== MULTICOLOR_COLOR_ID),
    ...form.parts.flatMap((p) => p.colorIds),
  ]).size
  const canSave = form.multicolorOnly
    ? partsReady() && multicolorColorCount >= 1
    : modelOnFile

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-navy">Designs</h1>
        <p className="mt-1 text-sm text-muted">
          Same catalog for the online shop and in-person stands. Upload .stl or .gcode.
          An STL is quoted when you submit. G-code already has filament and time, so it is not sliced.
        </p>
      </div>

      {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-electric">{message}</p>}
      {uploadingStl && uploadPct !== null && (
        <p className="text-sm font-medium text-navy">
          Uploading big file… {uploadPct}% — keep this tab open.
        </p>
      )}

      <form
        className="rounded-2xl border bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (form.multicolorOnly) {
            if (!partsReady()) {
              setError('Upload an STL for every color part before saving.')
              return
            }
            if (multicolorColorCount < 1) {
              setError('Pick at least one solid filament color customers can choose from.')
              return
            }
          } else if (!modelOnFile) {
            setError('Upload a 3D model before saving.')
            return
          }
          setBusy(true)
          setError('')
          setMessage('')
          const wasEditing = editingId
          const pendingUpload = Boolean(
            form.stlPath || (form.multicolorOnly && form.parts.some((p) => p.stlPath)),
          )
          const run = wasEditing
            ? api.catalog.designs.update(wasEditing, toPayload())
            : api.catalog.designs.create(toPayload())
          void run
            .then((saved) => {
              if (!saved.hasStl) {
                throw new Error(
                  pendingUpload
                    ? 'Save completed but the model was not attached. Re-upload and save again.'
                    : 'This design has no model on file. Re-upload the model, then save.',
                )
              }
              if (saved.multicolorOnly) {
                const missing = (saved.parts ?? []).filter((p) => !p.hasStl)
                if (missing.length || (saved.parts ?? []).length < (saved.multicolorSlotCount ?? 2)) {
                  throw new Error(
                    'Save completed but some part STLs were not attached. Re-upload each part and save again.',
                  )
                }
              }
              // Keep editing so Submit for approval is available after first save.
              setEditingId(saved.id)
              clearLocalPreview()
              setForm((f) => {
                revokePartPreviews(f.parts)
                const slotCount = clampMulticolorSlotCount(
                  saved.multicolorSlotCount ?? f.multicolorSlotCount,
                )
                const savedParts = saved.parts ?? []
                return {
                  ...f,
                  stlPath: '',
                  hasStl: true,
                  modelExt: saved.fromGcode ? '.gcode' : saved.modelExt || f.modelExt,
                  sourceGcodePath: '',
                  fromGcode: Boolean(saved.fromGcode),
                  sizeXMm: saved.sizeXMm ?? f.sizeXMm,
                  sizeYMm: saved.sizeYMm ?? f.sizeYMm,
                  sizeZMm: saved.sizeZMm ?? f.sizeZMm,
                  skuBase: saved.skuBase,
                  multicolorOnly: Boolean(saved.multicolorOnly),
                  multicolorSlotCount: slotCount,
                  parts: emptyParts(
                    slotCount,
                    savedParts.map((p) => ({
                      label: p.label,
                      stlPath: '',
                      hasStl: Boolean(p.hasStl),
                      modelExt: p.modelExt || '',
                      localPreviewUrl: '',
                    })),
                  ),
                }
              })
              const realisticNote =
                saved.realisticImageStatus === 'pending' ||
                saved.realisticImageStatus === 'rendering' ||
                saved.realisticImageStatus === 'processing'
                  ? ' A realistic white-background catalog photo is generating and will appear in the shop automatically.'
                  : ''
              setMessage(
                (wasEditing
                  ? saved.multicolorOnly
                    ? 'Multicolor design updated. Customers pick a filament color for each part. Submit for approval when ready.'
                    : 'Design updated (model on file). Click Submit for approval to send it to the main admin.'
                  : saved.multicolorOnly
                    ? 'Multicolor draft saved. Customers pick a filament color for each part. Submit for approval when ready.'
                    : 'Draft saved (model on file). Click Submit for approval to send it to the main admin.') +
                  realisticNote,
              )
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
          {editingId ? (
            <div className="text-sm font-medium">
              SKU base
              <p className="mt-1 rounded-xl border bg-slate-50 px-3 py-2 font-mono text-sm text-navy">
                {form.skuBase || '—'}
              </p>
              <span className="mt-1 block text-xs font-normal text-muted">
                Made from the name — shop links use it, so it stays fixed.
              </span>
            </div>
          ) : (
            <div className="text-sm font-medium">
              SKU base
              <p className="mt-1 rounded-xl border border-dashed px-3 py-2 text-sm font-normal text-muted">
                Made for you from the name when you save ✨
              </p>
            </div>
          )}
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
        {formatSizeMm(form.sizeXMm, form.sizeYMm, form.sizeZMm) ? (
          <p className="mt-3 text-sm font-medium text-navy">
            Size {formatSizeMm(form.sizeXMm, form.sizeYMm, form.sizeZMm)}
          </p>
        ) : null}

        <h3 className="mt-6 text-sm font-semibold text-navy">Print type</h3>
        <label className="mt-2 flex items-start gap-2 text-sm text-navy">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.multicolorOnly}
            onChange={(e) => {
              const on = e.target.checked
              if (on) {
                clearLocalPreview()
                setForm((f) => ({
                  ...f,
                  multicolorOnly: true,
                  stlPath: '',
                  hasStl: false,
                  modelExt: '',
                  sourceGcodePath: '',
                  fromGcode: false,
                  availableColorIds: f.availableColorIds.filter((id) => id !== MULTICOLOR_COLOR_ID)
                    .length
                    ? f.availableColorIds.filter((id) => id !== MULTICOLOR_COLOR_ID)
                    : ['black', 'white', 'red', 'blue'],
                  parts: emptyParts(f.multicolorSlotCount, f.parts),
                }))
                return
              }
              setForm((f) => {
                revokePartPreviews(f.parts)
                return {
                  ...f,
                  multicolorOnly: false,
                  parts: emptyParts(f.multicolorSlotCount),
                }
              })
            }}
          />
          <span>
            <span className="font-medium">Multicolor print</span>
            <span className="mt-0.5 block text-xs text-muted">
              Upload one STL per color region. Shop customers pick a filament color for each part (SKU
              stays MLT). Single-color model upload is hidden in this mode.
            </span>
          </span>
        </label>

        {!form.multicolorOnly ? (
          <div className="mt-4">
            <p className="text-sm font-medium">3D model (required)</p>
            <p className="mt-1 text-xs text-muted">
              Shop catalog shows this model (no photo upload). Customers open the product page to rotate
              it. For multicolor, turn on Multicolor print above instead.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                ref={modelInputRef}
                type="file"
                accept={MODEL_ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadModel(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="btn btn-secondary inline-flex items-center gap-2"
                disabled={uploadingStl}
                onClick={() => modelInputRef.current?.click()}
              >
                <Upload size={16} aria-hidden />
                {uploadingStl ? 'Uploading…' : 'Upload model'}
              </button>
              {modelOnFile ? (
                <span className="rounded-full bg-electric/10 px-2.5 py-1 text-xs font-semibold text-electric">
                  {form.stlPath
                    ? `${modelLabel(form.modelExt || '.stl')} uploaded — save to attach`
                    : `${modelLabel(form.modelExt || '.stl')} on file`}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-muted">
                  No model yet
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              {uploadingStl
                ? 'Uploading…'
                : modelOnFile
                  ? form.fromGcode
                    ? 'G-code on file. The 3D preview is the printed toolpath, not the original solid. Download STL saves that preview.'
                    : form.modelExt === '.stl' || (!form.modelExt && form.hasStl)
                      ? previewStlUrl
                        ? '3D preview below. Save draft if you just uploaded, then submit for approval.'
                        : 'Model attached. Save draft, then open Edit again if the preview does not appear.'
                      : 'Stored on this design. Upload .stl or .gcode.'
                  : 'Accepts .stl and .gcode — max 100MB. Multicolor parts stay STL only.'}
            </p>
            {previewStlUrl ? (
              previewArmed ? (
                <StlViewer
                  url={previewStlUrl}
                  className="mt-3 max-w-xl"
                  credentials={localPreviewUrl ? 'omit' : 'same-origin'}
                  colorHex={colorOptions.find((c) => c.id === form.mainColorId)?.hex}
                  maxBytes={12 * 1024 * 1024}
                />
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-compact mt-3"
                  onClick={() => setPreviewArmed(true)}
                >
                  Show 3D preview
                </button>
              )
            ) : null}
          </div>
        ) : null}

        <h3 className="mt-6 text-sm font-semibold text-navy">Colors</h3>
        {form.multicolorOnly ? (
          <>
            <label className="mt-3 flex items-center gap-3 text-sm text-navy">
              <span className="font-medium">Parts / colors to pick</span>
              <select
                className="rounded-lg border px-2 py-1.5"
                value={form.multicolorSlotCount}
                onChange={(e) => {
                  const n = clampMulticolorSlotCount(e.target.value)
                  setForm((f) => ({
                    ...f,
                    multicolorSlotCount: n,
                    parts: emptyParts(n, f.parts),
                  }))
                }}
              >
                {Array.from(
                  { length: MULTICOLOR_SLOT_MAX - MULTICOLOR_SLOT_MIN + 1 },
                  (_, i) => MULTICOLOR_SLOT_MIN + i,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <div>
                <p className="text-sm font-semibold text-navy">Part STLs (one per color region)</p>
                <p className="mt-0.5 text-xs text-muted">
                  Upload each separate model. Shop customers pick a filament color for each part; the
                  preview tints that part. You can optionally limit the colors for a part below — a
                  part with no colors selected can use every design color. Quoting uses the first
                  part (Body) file.
                </p>
              </div>
              {form.parts.map((part, index) => {
                const partPreview =
                  part.localPreviewUrl ||
                  (editingId && part.hasStl && !part.stlPath
                    ? `/api/admin/designs/${editingId}/parts/${index}/stl`
                    : '')
                return (
                  <div
                    key={`part-${index}`}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[8rem] flex-1 text-xs font-medium text-navy">
                        Slot {index + 1} label
                        <input
                          className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                          value={part.label}
                          onChange={(e) =>
                            setForm((f) => {
                              const parts = [...f.parts]
                              parts[index] = { ...parts[index]!, label: e.target.value }
                              return { ...f, parts }
                            })
                          }
                          placeholder={defaultMulticolorPartLabel(index)}
                        />
                      </label>
                      <label className="btn btn-ghost btn-compact cursor-pointer">
                        <Upload size={14} className="mr-1 inline" />
                        {part.hasStl || part.stlPath ? 'Replace STL' : 'Upload STL'}
                        <input
                          type="file"
                          accept=".stl,model/stl"
                          className="hidden"
                          disabled={uploadingStl}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            e.target.value = ''
                            if (file) void uploadPartModel(index, file)
                          }}
                        />
                      </label>
                      {(part.hasStl || part.stlPath) && (
                        <span className="text-xs text-muted">
                          {part.modelExt ? modelLabel(part.modelExt) : 'STL'} attached
                        </span>
                      )}
                    </div>
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-navy">
                          Colors for {part.label.trim() || defaultMulticolorPartLabel(index)}{' '}
                          <span className="font-normal text-muted">(optional)</span>
                        </p>
                        {part.colorIds.length ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-electric"
                            onClick={() => clearPartColors(index)}
                          >
                            Use all design colors
                          </button>
                        ) : (
                          <span className="text-xs text-muted">All design colors</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {part.colorIds.length
                          ? 'Customers can only pick these colors for this part.'
                          : 'Select colors to limit this part, or leave it unselected to allow every design color.'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {colorOptions.map((c) => {
                          const selected = part.colorIds.includes(c.id)
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                                selected
                                  ? 'border-electric bg-electric/10 text-electric'
                                  : 'border-slate-200 text-navy'
                              }`}
                              onClick={() => togglePartColor(index, c.id)}
                            >
                              <span
                                className="h-3 w-3 rounded-full border"
                                style={{ background: c.hex }}
                              />
                              {c.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {partPreview && previewArmed ? (
                      <StlViewer
                        url={partPreview}
                        className="mt-2 max-w-sm"
                        height={160}
                        credentials={part.localPreviewUrl ? 'omit' : 'same-origin'}
                        maxBytes={12 * 1024 * 1024}
                      />
                    ) : null}
                  </div>
                )
              })}
              {form.parts.every((p) => p.hasStl || p.stlPath || p.localPreviewUrl) &&
              form.parts.some((p) => p.localPreviewUrl || (editingId && p.hasStl)) ? (
                previewArmed ? (
                  <MultiStlViewer
                    className="max-w-xl"
                    height={240}
                    credentials="same-origin"
                    maxBytes={12 * 1024 * 1024}
                    parts={form.parts.map((p, i) => ({
                      url:
                        p.localPreviewUrl ||
                        (editingId && p.hasStl
                          ? `/api/admin/designs/${editingId}/parts/${i}/stl`
                          : ''),
                      colorHex: ['#E11D48', '#2563EB', '#16A34A', '#EAB308'][i],
                    }))}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    onClick={() => setPreviewArmed(true)}
                  >
                    Show 3D preview
                  </button>
                )
              ) : null}
            </div>
          </>
        ) : null}
        <p className="mt-3 text-xs text-muted">
          {stockIds.length
            ? 'These are the basic colors admins have. Change that in Settings.'
            : 'No admin has marked colors yet, so every basic color is listed. Mark what you have in Settings.'}{' '}
          {form.multicolorOnly
            ? 'These are the design colors. A part with its own colors above only uses those; a part with none selected uses all of these.'
            : 'Choose which of them this design can be ordered in.'}{' '}
          The main color is the one the shop model starts in.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {colorOptions.map((c) => {
            const on = form.availableColorIds.includes(c.id)
            const main = on && form.mainColorId === c.id
            return (
              <span key={c.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                    on ? 'border-electric bg-electric/10 text-electric' : 'border-slate-200'
                  }`}
                  onClick={() =>
                    setForm((f) => {
                      const nextIds = on
                        ? f.availableColorIds.filter((x) => x !== c.id)
                        : [...f.availableColorIds, c.id]
                      let mainColorId = f.mainColorId
                      if (!nextIds.includes(mainColorId)) mainColorId = nextIds[0] || ''
                      if (!on && !f.mainColorId) mainColorId = c.id
                      const parts = on
                        ? f.parts.map((p) => ({
                            ...p,
                            colorIds: p.colorIds.filter((id) => id !== c.id),
                          }))
                        : f.parts
                      return { ...f, availableColorIds: nextIds, mainColorId, parts }
                    })
                  }
                >
                  <span className="h-3 w-3 rounded-full border" style={{ background: c.hex }} />
                  {c.name}
                  {main ? ' · Main' : ''}
                </button>
                {on && !main ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-medium text-navy"
                    onClick={() => setForm((f) => ({ ...f, mainColorId: c.id }))}
                  >
                    Set main
                  </button>
                ) : null}
              </span>
            )
          })}
        </div>
        {form.multicolorOnly ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-electric bg-electric/10 px-3 py-1.5 text-xs font-medium text-electric">
            <span
              className="h-3 w-3 rounded-full border"
              style={colorSwatchStyle({ id: MULTICOLOR_COLOR_ID, hex: '#7C3AED' })}
            />
            Shop badge: Multicolor · {form.multicolorSlotCount} picks
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={busy || uploadingStl || !canSave}
          >
            {busy ? 'Saving…' : editingId ? 'Update draft' : 'Save draft'}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || uploadingStl}
              onClick={() => {
                setBusy(true)
                setError('')
                setMessage(
                  isMainAdmin ? 'Publishing (skipping Approvals)…' : 'Submitting for approval…',
                )
                void api.catalog.designs
                  .update(editingId, toPayload())
                  .then(() => api.catalog.designs.submit(editingId))
                  .then((res) => {
                    setMessage(
                      res.sliceWarning
                        ? isMainAdmin
                          ? res.sliceWarning
                          : `Submitted for approval. ${res.sliceWarning}`
                        : isMainAdmin
                          ? 'Published — quoting started (main admin skip Approvals).'
                          : 'Submitted for approval — main admin can review it now.',
                    )
                    resetForm()
                    return load()
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : 'Submit failed'))
                  .finally(() => setBusy(false))
              }}
            >
              {busy
                ? isMainAdmin
                  ? 'Publishing…'
                  : 'Submitting…'
                : isMainAdmin
                  ? 'Publish & quote'
                  : 'Submit for approval'}
            </button>
          )}
          {editingId && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => resetForm()}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="font-semibold text-navy">All designs</h2>
        {editingId ? (
          <p className="mt-2 text-xs text-muted">
            The design you are editing is hidden from this list until you save, submit, or cancel.
          </p>
        ) : null}
        <div className="mt-4 space-y-3">
          {designs.filter((d) => d.id !== editingId).map((d) => (
            <div
              key={d.id}
              className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-slate-100 px-3 py-3 sm:px-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface text-[10px] font-bold text-muted">
                  {d.realisticImageUrl ? (
                    <img
                      src={d.realisticImageUrl}
                      alt={`${d.name} realistic preview`}
                      className="h-full w-full object-cover"
                    />
                  ) : d.hasStl ? (
                    d.fromGcode ? 'G-code' : modelLabel(d.modelExt || '.stl')
                  ) : (
                    '—'
                  )}
                </div>
                <div className="min-w-0">
                  <p className="break-words font-medium text-navy">{d.name}</p>
                  <p className="text-xs text-muted">
                    {d.skuBase} · <span className="uppercase">{d.status.replace('_', ' ')}</span>
                    {d.hasStl ? ` · ${d.fromGcode ? 'G-code' : modelLabel(d.modelExt || '')}` : ' · no model'}
                    {d.sliceStatus !== 'idle' ? ` · slice ${d.sliceStatus}` : ''}
                    {d.catalogPriceUsd != null ? ` · $${d.catalogPriceUsd.toFixed(2)}` : ''}
                    {formatSizeMm(d.sizeXMm, d.sizeYMm, d.sizeZMm)
                      ? ` · ${formatSizeMm(d.sizeXMm, d.sizeYMm, d.sizeZMm)}`
                      : ''}
                    {` · ${d.buyerCount || 0} ${(d.buyerCount || 0) === 1 ? 'person bought' : 'people bought'}`}
                    {d.popular ? ' · Popular' : ''}
                  </p>
                  {d.fromGcode ? (
                    <p className="text-xs text-muted">
                      Preview and Download STL use the printed toolpath, not the original solid.
                    </p>
                  ) : null}
                  {d.sliceStatus === 'ready' ? (
                    <p className="text-xs text-muted">
                      P1S {d.gramsPabloP1s}g / {d.hoursPabloP1s}h · Ender 3v2 {d.gramsCourtEnder}g /{' '}
                      {d.hoursCourtEnder}h · Kobra X {d.gramsJoshKobra}g / {d.hoursJoshKobra}h
                    </p>
                  ) : null}
                  <p className="text-xs text-muted">
                    {realisticImageLabel(d.realisticImageStatus)}
                    {d.realisticImageStatus === 'ready' ? ' · shown in the shop' : ''}
                    {realisticColorSummary(d) ? ` · ${realisticColorSummary(d)}` : ''}
                  </p>
                  {d.realisticImageError ? (
                    <p className="text-xs text-amber-700">{d.realisticImageError}</p>
                  ) : null}
                  {(d.realisticColorImages ?? []).length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(d.realisticColorImages ?? []).map((img) => {
                        const active = ['pending', 'rendering', 'processing'].includes(img.status)
                        const known =
                          img.colorId === 'multicolor'
                            ? { name: 'Multicolor', hex: '#7C3AED' }
                            : (solidBuiltinColors().find((c) => c.id === img.colorId) ??
                              extraColors.find((c) => c.id === img.colorId) ?? {
                                name: img.colorId,
                                hex: '#94A3B8',
                              })
                        const statusText =
                          img.status === 'ready'
                            ? 'ready'
                            : active
                              ? 'generating…'
                              : img.status === 'error'
                                ? 'failed'
                                : img.status
                        return (
                          <span
                            key={img.colorId}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1.5 pr-1 text-[11px] font-medium text-navy"
                          >
                            {img.imageUrl ? (
                              <img
                                src={img.imageUrl}
                                alt=""
                                className="h-4 w-4 rounded-full border object-cover"
                              />
                            ) : (
                              <span
                                className="h-3.5 w-3.5 rounded-full border"
                                style={{ background: known.hex }}
                              />
                            )}
                            {known.name} · {statusText}
                            <button
                              type="button"
                              disabled={busy || active}
                              title={`Redo only the ${known.name} photo`}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-electric hover:bg-slate-200 disabled:opacity-50"
                              onClick={() => {
                                setBusy(true)
                                setError('')
                                void api.catalog.designs
                                  .regenerateRealisticImage(d.id, img.colorId)
                                  .then(() => {
                                    setMessage(
                                      `Redoing the ${known.name} photo only. The current one stays in the shop until the new one is ready.`,
                                    )
                                    return load()
                                  })
                                  .catch((err) =>
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : 'Could not redo that color photo',
                                    ),
                                  )
                                  .finally(() => setBusy(false))
                              }}
                            >
                              Redo
                            </button>
                            <label
                              title={`Upload your own ${known.name} photo instead of generating one`}
                              className={`rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-electric hover:bg-slate-200 ${busy || active ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
                            >
                              Upload
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={busy || active}
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  e.target.value = ''
                                  if (!file) return
                                  if (file.size > 12 * 1024 * 1024) {
                                    setError('That photo is too big — please pick one under 12 MB.')
                                    return
                                  }
                                  setBusy(true)
                                  setError('')
                                  void api.catalog.designs
                                    .uploadRealisticImage(d.id, img.colorId, file)
                                    .then(() => {
                                      setMessage(
                                        `Your photo is now the ${known.name} picture for ${d.name} in the shop.`,
                                      )
                                      return load()
                                    })
                                    .catch((err) =>
                                      setError(
                                        err instanceof Error
                                          ? err.message
                                          : 'Could not upload that photo',
                                      ),
                                    )
                                    .finally(() => setBusy(false))
                                }}
                              />
                            </label>
                          </span>
                        )
                      })}
                    </div>
                  ) : null}
                  {(d.realisticColorImages ?? []).length ? (
                    <p className="mt-1 text-[11px] text-muted">
                      Redo makes a new generated photo; Upload uses your own picture instead.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted">
                    G-code:{' '}
                    {(d.gcodeReadyPrinters || []).length
                      ? (d.gcodeReadyPrinters || []).join(', ')
                      : 'not prepared'}
                  </p>
                  {d.sliceError ? <p className="whitespace-pre-wrap text-xs text-amber-700">{d.sliceError}</p> : null}
                  {d.reviewNote ? <p className="text-xs text-amber-700">{d.reviewNote}</p> : null}
                </div>
              </div>
              <div className="action-row">
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => startEdit(d)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    setError('')
                    void api.catalog.designs
                      .setPopular(d.id, !d.popular)
                      .then(() => {
                        setMessage(d.popular ? 'Removed from popular.' : 'Marked popular. It stays at the top of the shop.')
                        return load()
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Could not update popular'))
                      .finally(() => setBusy(false))
                  }}
                >
                  {d.popular ? 'Remove popular' : 'Make popular'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    setError('')
                    void api.catalog.designs
                      .setManualPhotos(d.id, !d.manualPhotos)
                      .then(() => {
                        setMessage(
                          d.manualPhotos
                            ? 'Paid API photos are back ON for this design.'
                            : 'Paid API photos are OFF for this design — it will only use uploaded photos.',
                        )
                        return load()
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : 'Could not update photo setting'))
                      .finally(() => setBusy(false))
                  }}
                >
                  {d.manualPhotos ? 'API photos: OFF' : 'API photos: ON'}
                </button>
                {d.hasStl || (d.multicolorOnly && (d.parts ?? []).some((p) => p.hasStl)) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    disabled={
                      busy ||
                      ['pending', 'rendering', 'processing'].includes(d.realisticImageStatus || '')
                    }
                    onClick={() => {
                      setBusy(true)
                      setError('')
                      void api.catalog.designs
                        .regenerateRealisticImage(d.id)
                        .then(() => {
                          setMessage('Realistic photo generation started for every color. They will appear in the shop as each one finishes.')
                          return load()
                        })
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : 'Could not start realistic image'),
                        )
                        .finally(() => setBusy(false))
                    }}
                  >
                    {['pending', 'rendering', 'processing'].includes(d.realisticImageStatus || '')
                      ? 'Generating photos…'
                      : d.realisticImageStatus === 'ready'
                        ? 'Regenerate all color photos'
                        : 'Generate color photos'}
                  </button>
                ) : null}
                {d.hasStl || (d.multicolorOnly && (d.parts ?? []).some((p) => p.hasStl)) ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      setError('')
                      setMessage(
                        d.multicolorOnly ? 'Downloading STLs…' : 'Downloading model…',
                      )
                      void api.catalog.designs
                        .downloadModel(d)
                        .then(() =>
                          setMessage(
                            d.multicolorOnly
                              ? 'STLs downloaded.'
                              : `${modelLabel(d.modelExt || '.stl')} downloaded.`,
                          ),
                        )
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : 'Download failed'),
                        )
                        .finally(() => setBusy(false))
                    }}
                  >
                    {d.multicolorOnly ? 'Download STLs' : 'Download STL'}
                  </button>
                ) : null}
                {d.hasStl ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      setMessage('Starting G-code prepare (GitHub Actions)…')
                      setError('')
                      void api.catalog.designs
                        .prepareGcode(d.id, 'pablo_p1s')
                        .then(async (res) => {
                          if (res.status === 'ready') {
                            setMessage('G-code already stored for Pablo P1S.')
                            return load()
                          }
                          setMessage('Slicing in GitHub Actions… leave this page open.')
                          const deadline = Date.now() + 20 * 60_000
                          while (Date.now() < deadline) {
                            await new Promise((r) => setTimeout(r, 8000))
                            const st = await api.catalog.designs.gcodeStatus(d.id, 'pablo_p1s')
                            if (st.status === 'ready') {
                              setMessage('G-code ready for Pablo P1S — Orders Download will work.')
                              return load()
                            }
                          }
                          throw new Error(
                            'Still preparing after ~20 min. Check GitHub → Actions → Prepare G-code.',
                          )
                        })
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : 'Prepare G-code failed'),
                        )
                        .finally(() => setBusy(false))
                    }}
                  >
                    Prepare G-code
                  </button>
                ) : null}
                {d.status === 'draft' || d.status === 'rejected' ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={() => {
                      setBusy(true)
                      setMessage(
                        isMainAdmin ? 'Publishing (skipping Approvals)…' : 'Submitting for approval…',
                      )
                      void api.catalog.designs
                        .submit(d.id)
                        .then((res) => {
                          setMessage(
                            res.sliceWarning
                              ? res.sliceWarning
                              : isMainAdmin
                                ? 'Published — quoting started.'
                                : 'Submitted for approval.',
                          )
                          return load()
                        })
                        .catch((err) => setError(err instanceof Error ? err.message : 'Submit failed'))
                        .finally(() => setBusy(false))
                    }}
                  >
                    {isMainAdmin ? 'Publish & quote' : 'Submit'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-compact text-red-600"
                  onClick={() => setPendingDelete({ id: d.id, name: d.name })}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {designs.length === 0 && <p className="text-sm text-muted">No designs yet.</p>}
          {designs.length > 0 && designs.every((d) => d.id === editingId) && (
            <p className="text-sm text-muted">No other designs — finish or cancel the edit above.</p>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete design?"
        message={pendingDelete ? `Delete “${pendingDelete.name}”?` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={() => {
          if (!pendingDelete) return
          setDeleting(true)
          setError('')
          setMessage('')
          void api.catalog.designs
            .remove(pendingDelete.id)
            .then((res) => {
              setPendingDelete(null)
              setMessage(
                res.archived
                  ? 'Archived (linked to orders) — hidden from this list.'
                  : 'Deleted.',
              )
              return load()
            })
            .catch((err) => setError(err instanceof Error ? err.message : 'Delete failed'))
            .finally(() => setDeleting(false))
        }}
      />
    </div>
  )
}
