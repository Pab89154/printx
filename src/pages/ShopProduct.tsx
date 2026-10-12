import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import {
  MULTICOLOR_COLOR_ID,
  MULTICOLOR_SLOT_DEFAULT,
  clampMulticolorSlotCount,
  colorSwatchStyle,
  formatMulticolorSelection,
  isMulticolorColorId,
} from '../../shared/colors'
import { useCart } from '../context/CartContext'
import type { PublicCatalogDesign } from '../types/catalog'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { CartLink } from '../components/CartLink'
import { StlViewer } from '../components/StlViewer'

export function ShopProduct() {
  const { skuBase = '' } = useParams()
  const [design, setDesign] = useState<PublicCatalogDesign | null>(null)
  const [colorId, setColorId] = useState('')
  const [slotColorIds, setSlotColorIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)
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
          setSlotColorIds(Array.from({ length: slots }, () => ''))
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

  const slotColors = slotColorIds.map((id) => solidChoices.find((c) => c.id === id) ?? null)
  const multicolorReady =
    multicolorOnly &&
    slotColorIds.length > 0 &&
    slotColorIds.every((id) => Boolean(id)) &&
    slotColors.every(Boolean)

  const previewColor = multicolorOnly
    ? slotColors.find(Boolean) ?? { id: MULTICOLOR_COLOR_ID, hex: '#7C3AED', name: 'Multicolor' }
    : design?.availableColors.find((c) => c.id === colorId)

  const singleColor = design?.availableColors.find((c) => c.id === colorId)
  const canAdd = Boolean(
    design?.catalogPriceUsd != null && (multicolorOnly ? multicolorReady : singleColor),
  )

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
              {design.modelUrl ? (
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
              <p className="mt-2 text-xs text-muted">Drag to rotate · scroll to zoom</p>
            </div>
            <div>
              <h1 className="text-3xl font-extrabold text-navy">{design.name}</h1>
              <p className="mt-2 text-muted">{design.description}</p>
              <p className="mt-4 text-2xl font-bold text-electric">
                ${design.catalogPriceUsd?.toFixed(2) ?? '—'}
              </p>

              {multicolorOnly ? (
                <div className="mt-6 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-navy">Filament colors</p>
                    <p className="mt-1 text-xs text-muted">
                      This is a multicolor print — pick each filament color before adding to cart.
                    </p>
                  </div>
                  {slotColorIds.map((selectedId, index) => (
                    <div key={`slot-${index}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Color {index + 1}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {solidChoices.map((c) => (
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
                  ))}
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
                    if (!multicolorReady) return
                    const names = slotColors.map((c) => c!.name)
                    add(
                      {
                        designId: design.id,
                        skuBase: design.skuBase,
                        name: design.name,
                        imageUrl: '',
                        colorId: MULTICOLOR_COLOR_ID,
                        colorName: formatMulticolorSelection(names),
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
