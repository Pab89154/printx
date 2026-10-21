import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import {
  MULTICOLOR_COLOR_ID,
  MULTICOLOR_SLOT_DEFAULT,
  clampMulticolorSlotCount,
  colorSwatchStyle,
  defaultMulticolorPartLabel,
    formatMulticolorSelection,
  isMulticolorColorId,
} from '../../shared/colors'
import { Box, Image as ImageIcon, Rotate3d } from 'lucide-react'
import { useCart } from '../context/CartContext'
import type { PublicCatalogDesign } from '../types/catalog'
import { formatSizeMm } from '../../shared/sizeLabel'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { CartLink } from '../components/CartLink'
import { MultiStlViewer, StlViewer } from '../components/StlViewer'

export function ShopProduct() {
  const { skuBase = '' } = useParams()
  const [design, setDesign] = useState<PublicCatalogDesign | null>(null)
  const [colorId, setColorId] = useState('')
  const [slotColorIds, setSlotColorIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const [visual, setVisual] = useState<'photo' | 'model'>('photo')
  const [error, setError] = useState('')
  const [added, setAdded] = useState(false)
  const { add } = useCart()

  useEffect(() => {
    void api.catalog
      .public()
      .then((d) => {
        const hit =
          d.designs.find((x) => x.skuBase.toLowerCase() === decodeURIComponent(skuBase).toLowerCase()) ??
          null
        setDesign(hit)
        if (!hit) return
        const multi =
          Boolean(hit.multicolorOnly) ||
          (hit.availableColors.length === 1 && isMulticolorColorId(hit.availableColors[0]?.id))
        if (multi) {
          const slots = clampMulticolorSlotCount(hit.multicolorSlotCount ?? MULTICOLOR_SLOT_DEFAULT)
          const solids = hit.availableColors.filter((c) => !isMulticolorColorId(c.id))
          setSlotColorIds(
            Array.from({ length: slots }, (_, i) => {
              const allowed = hit.parts?.[i]?.colorIds ?? []
              const restricted = solids.filter((c) => allowed.includes(c.id))
              // A part limited to one color is already decided by the designer.
              return restricted.length === 1 ? restricted[0]!.id : ''
            }),
          )
          setColorId(MULTICOLOR_COLOR_ID)
        } else if (hit.availableColors[0]) {
          setColorId(hit.availableColors[0].id)
          setSlotColorIds([])
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [skuBase])

  const multicolorOnly =
    Boolean(design?.multicolorOnly) ||
    (design?.availableColors.length === 1 && isMulticolorColorId(design.availableColors[0]?.id))

  const solidChoices = useMemo(
    () => (design?.availableColors ?? []).filter((c) => !isMulticolorColorId(c.id)),
    [design],
  )

  const slotLabels = useMemo(() => {
    const n = clampMulticolorSlotCount(design?.multicolorSlotCount ?? MULTICOLOR_SLOT_DEFAULT)
    return Array.from({ length: n }, (_, i) => {
      const fromParts = design?.parts?.[i]?.label?.trim()
      return fromParts || defaultMulticolorPartLabel(i)
    })
  }, [design])

  const slotChoices = useMemo(
    () =>
      slotLabels.map((_, i) => {
        const allowed = design?.parts?.[i]?.colorIds ?? []
        const restricted = solidChoices.filter((c) => allowed.includes(c.id))
        return restricted.length ? restricted : solidChoices
      }),
    [design, slotLabels, solidChoices],
  )

  const slotColors = slotColorIds.map(
    (id, i) => slotChoices[i]?.find((c) => c.id === id) ?? null,
  )
  const multicolorReady =
    multicolorOnly &&
    slotColorIds.length > 0 &&
    slotColorIds.every((id) => Boolean(id)) &&
    slotColors.every(Boolean)

  const multiParts = useMemo(() => {
    if (!design?.parts?.length) return []
    return design.parts
      .map((p, i) => {
        const hex = solidChoices.find((c) => c.id === slotColorIds[i])?.hex
        return {
          url: p.modelUrl || '',
          colorHex: hex || '#94A3B8',
          label: p.label,
        }
      })
      .filter((p) => p.url)
  }, [design, slotColorIds, solidChoices])

  const useMultiPreview = multicolorOnly && multiParts.length >= 2

  const previewColor = multicolorOnly
    ? slotColors.find(Boolean) ?? { id: MULTICOLOR_COLOR_ID, hex: '#7C3AED', name: 'Multicolor' }
    : design?.availableColors.find((c) => c.id === colorId)

  const singleColor = design?.availableColors.find((c) => c.id === colorId)
  const canAdd = Boolean(
    design?.catalogPriceUsd != null && (multicolorOnly ? multicolorReady : singleColor),
  )

  // One photo per color: show the picked color's photo when ready.
  // Multicolor prints get one photo per color COMBO: the key is the picked
  // colors in part order joined with '+', skipping parts whose color
  // "does not matter" (they never change the photo). Until the exact combo
  // has a photo, fall back to the generic multicolor photo.
  const comboPhotoKey = useMemo(() => {
    if (!multicolorOnly || !design) return ''
    const ids: string[] = []
    for (let i = 0; i < slotColorIds.length; i++) {
      if (/does not matter/i.test(design.parts?.[i]?.label || '')) continue
      const id = slotColorIds[i]
      if (!id) return ''
      ids.push(id)
    }
    return ids.length >= 2 ? ids.join('+') : ''
  }, [multicolorOnly, design, slotColorIds])

  const activePhotoKey = multicolorOnly ? comboPhotoKey || 'multicolor' : colorId
  const activePhoto =
    (activePhotoKey ? design?.colorImages?.[activePhotoKey] : '') ||
    (multicolorOnly ? design?.colorImages?.['multicolor'] : '') ||
    design?.imageUrl ||
    ''
  const activePhotoStatus = activePhotoKey
    ? design?.colorImageStatuses?.[activePhotoKey]
    : undefined
  const colorPhotoPending =
    !multicolorOnly &&
    Boolean(colorId) &&
    !design?.colorImages?.[colorId] &&
    Boolean(activePhotoStatus) &&
    activePhotoStatus !== 'ready'

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link to="/shop" className="text-electric hover:underline">
            ← Shop
          </Link>
          <CartLink />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!design && !error && <p className="text-sm text-muted">Loading…</p>}
        {design && (
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <div className="relative">
                {activePhoto && visual === 'photo' ? (
                  <>
                    <img
                      src={activePhoto}
                      alt={`${design.name} realistic preview`}
                      className="aspect-square w-full cursor-pointer rounded-2xl border bg-white object-cover"
                      title="View the interactive 3D model"
                      onClick={() => {
                        if (useMultiPreview || design.modelUrl) setVisual('model')
                      }}
                    />
                    {useMultiPreview || design.modelUrl ? (
                      <button
                        type="button"
                        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-navy/90 px-3 py-1.5 text-xs font-semibold text-white shadow"
                        onClick={() => setVisual('model')}
                      >
                        <Rotate3d size={14} />
                        View in 3D
                      </button>
                    ) : null}
                  </>
                ) : useMultiPreview ? (
                  <MultiStlViewer
                    parts={multiParts}
                    credentials="same-origin"
                    interactive
                    eager
                    height={420}
                    className="overflow-hidden rounded-2xl border bg-white [&_>div]:rounded-2xl [&_>div]:border-0"
                  />
                ) : design.modelUrl ? (
                  <StlViewer
                    url={design.modelUrl}
                    credentials="same-origin"
                    interactive
                    eager
                    colorHex={previewColor?.hex}
                    height={420}
                    className="overflow-hidden rounded-2xl border bg-white [&_>div]:rounded-2xl [&_>div]:border-0"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-2xl border bg-white text-muted">
                    No interactive model available
                  </div>
                )}
                {activePhoto && visual === 'model' ? (
                  <button
                    type="button"
                    className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-navy/90 px-3 py-1.5 text-xs font-semibold text-white shadow"
                    onClick={() => setVisual('photo')}
                  >
                    <ImageIcon size={14} />
                    View photo
                  </button>
                ) : null}
              </div>
              {activePhoto && (useMultiPreview || design.modelUrl) ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label="Show real-life photo"
                    className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 ${
                      visual === 'photo' ? 'border-electric' : 'border-slate-200'
                    }`}
                    onClick={() => setVisual('photo')}
                  >
                    <img
                      src={activePhoto}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-navy/80 py-0.5 text-[10px] font-semibold text-white">
                      Photo
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Show interactive 3D model"
                    className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 bg-navy text-white ${
                      visual === 'model' ? 'border-electric' : 'border-navy'
                    }`}
                    onClick={() => setVisual('model')}
                  >
                    <Box size={22} />
                    <span className="text-[10px] font-semibold">3D model</span>
                  </button>
                  <p className="min-w-[10rem] flex-1 text-xs text-muted">
                    {visual === 'photo'
                      ? 'Real-life photo of the printed object. Click the photo or the 3D thumbnail to spin the actual model.'
                      : 'Drag to rotate · scroll to zoom. The model updates in the colors you pick.'}
                  </p>
                </div>
              ) : activePhoto ? (
                <p className="mt-2 text-xs text-muted">
                  Realistic preview of the printed object on a white background.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted">Drag to rotate · scroll to zoom</p>
              )}
              {colorPhotoPending ? (
                <p className="mt-2 text-xs text-amber-700">
                  {activePhotoStatus === 'error'
                    ? `The ${singleColor?.name ?? 'picked'} photo could not be generated, so the main color photo is shown.`
                    : `The ${singleColor?.name ?? 'picked'} photo is being generated — showing the main color photo for now. Pick it again soon to see it.`}
                </p>
              ) : null}
            </div>
            <div>
              <h1 className="text-3xl font-extrabold text-navy">
                {design.name}
                {design.popular || (design.buyerCount ?? 0) > 0 ? (
                  <span className="ml-3 align-middle text-sm font-semibold uppercase tracking-wide text-electric">
                    Popular
                  </span>
                ) : null}
              </h1>
              <p className="mt-2 text-muted">{design.description}</p>
              {formatSizeMm(design.sizeXMm, design.sizeYMm, design.sizeZMm) ? (
                <p className="mt-3 text-sm text-navy">
                  Size {formatSizeMm(design.sizeXMm, design.sizeYMm, design.sizeZMm)}
                </p>
              ) : null}
              <p className="mt-4 text-2xl font-bold text-electric">
                ${design.catalogPriceUsd?.toFixed(2) ?? '—'}
              </p>

              {multicolorOnly ? (
                <div className="mt-6 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-navy">Color for each part</p>
                    <p className="mt-1 text-xs text-muted">
                      This print has separate models — pick a filament color for each one. Some
                      parts only offer the colors picked for that part. The preview updates as you
                      choose.
                    </p>
                  </div>
                  {slotColorIds.map((selectedId, index) => {
                    const choices = slotChoices[index] ?? solidChoices
                    const restricted = (design.parts?.[index]?.colorIds ?? []).length > 0
                    return (
                    <div key={`slot-${index}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {slotLabels[index] || defaultMulticolorPartLabel(index)}
                        {!selectedId ? (
                          <span className="ml-1 font-normal normal-case text-amber-700">
                            — pick a color
                          </span>
                        ) : restricted && choices.length === 1 ? (
                          <span className="ml-1 font-normal normal-case text-muted">
                            — set for this part
                          </span>
                        ) : restricted ? (
                          <span className="ml-1 font-normal normal-case text-muted">
                            — only these colors
                          </span>
                        ) : null}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {choices.map((c) => (
                          <button
                            key={`${index}-${c.id}`}
                            type="button"
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                              selectedId === c.id
                                ? 'border-electric bg-electric/10 text-electric'
                                : 'border-slate-200'
                            }`}
                            onClick={() =>
                              setSlotColorIds((prev) => {
                                const next = [...prev]
                                next[index] = c.id
                                return next
                              })
                            }
                          >
                            <span
                              className="h-3.5 w-3.5 rounded-full border"
                              style={colorSwatchStyle(c)}
                            />
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  <p className="mt-6 text-sm font-semibold text-navy">Color</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {design.availableColors.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                          colorId === c.id
                            ? 'border-electric bg-electric/10 text-electric'
                            : 'border-slate-200'
                        }`}
                        onClick={() => setColorId(c.id)}
                      >
                        <span className="h-3.5 w-3.5 rounded-full border" style={colorSwatchStyle(c)} />
                        {c.name}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <label className="mt-6 flex items-center gap-4 text-sm font-semibold text-navy">
                <span>Quantity</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  className="w-14 rounded-xl border px-2 py-2 text-center tabular-nums"
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value) || 1)}
                />
              </label>

              <button
                type="button"
                className="btn btn-primary mt-6"
                disabled={!canAdd}
                onClick={() => {
                  if (!design.catalogPriceUsd) return
                  if (multicolorOnly) {
                    const names = slotColors.map((c) => c!.name)
                    add(
                      {
                        designId: design.id,
                        skuBase: design.skuBase,
                        name: design.name,
                        imageUrl: '',
                        colorId: MULTICOLOR_COLOR_ID,
                        colorName: formatMulticolorSelection(names, slotLabels),
                        colorHex: slotColors[0]?.hex ?? '#7C3AED',
                        filamentColorIds: [...slotColorIds],
                        unitPrice: design.catalogPriceUsd,
                      },
                      qty,
                    )
                  } else {
                    if (!singleColor) return
                    add(
                      {
                        designId: design.id,
                        skuBase: design.skuBase,
                        name: design.name,
                        imageUrl: '',
                        colorId: singleColor.id,
                        colorName: singleColor.name,
                        colorHex: singleColor.hex,
                        unitPrice: design.catalogPriceUsd,
                      },
                      qty,
                    )
                  }
                  setAdded(true)
                }}
              >
                Add to cart
              </button>
              {multicolorOnly && !multicolorReady ? (
                <p className="mt-2 text-xs text-amber-700">Select every filament color to continue.</p>
              ) : null}
              {added && (
                <p className="mt-3 text-sm text-electric">
                  Added.{' '}
                  <Link to="/cart" className="underline">
                    View cart
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
