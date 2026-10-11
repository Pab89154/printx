import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
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
        if (hit?.availableColors[0]) setColorId(hit.availableColors[0].id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [skuBase])

  const color = design?.availableColors.find((c) => c.id === colorId)

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
                  colorHex={color?.hex}
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
                    <span className="h-3.5 w-3.5 rounded-full border" style={{ background: c.hex }} />
                    {c.name}
                  </button>
                ))}
              </div>

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
                disabled={!color || design.catalogPriceUsd == null}
                onClick={() => {
                  if (!color || design.catalogPriceUsd == null) return
                  add(
                    {
                      designId: design.id,
                      skuBase: design.skuBase,
                      name: design.name,
                      imageUrl: '',
                      colorId: color.id,
                      colorName: color.name,
                      colorHex: color.hex,
                      unitPrice: design.catalogPriceUsd,
                    },
                    qty,
                  )
                  setAdded(true)
                }}
              >
                Add to cart
              </button>
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
