import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../lib/api'
import { colorSwatchStyle } from '../../shared/colors'
import type { CatalogColor, PublicCatalogDesign } from '../types/catalog'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { CartLink } from '../components/CartLink'
import { StlViewer } from '../components/StlViewer'

function designMatchesQuery(design: PublicCatalogDesign, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [design.name, design.description, design.category, design.skuBase]
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((term) => haystack.includes(term))
}

function ShopCard({ design }: { design: PublicCatalogDesign }) {
  const [previewColor, setPreviewColor] = useState<CatalogColor | undefined>(
    () => design.availableColors[0],
  )

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:shadow-md">
      <Link
        to={`/shop/${encodeURIComponent(design.skuBase)}`}
        className="group block"
      >
        <div className="relative aspect-square overflow-hidden bg-slate-100">
          {design.modelUrl ? (
            <StlViewer
              url={design.modelUrl}
              credentials="same-origin"
              interactive={false}
              eager={false}
              height="100%"
              colorHex={previewColor?.hex}
              className="absolute inset-0 [&_>div]:h-full [&_>div]:min-h-0 [&_>div]:rounded-none [&_>div]:border-0 [&_>div]:border-transparent"
            />
          ) : (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-muted">
              {design.hasModel ? 'Preview needs .stl' : 'No 3D model'}
            </div>
          )}
        </div>
        <div className="px-4 pt-4">
          <p className="font-semibold text-navy">{design.name}</p>
          <p className="mt-1 text-sm text-muted line-clamp-2">{design.description}</p>
        </div>
      </Link>

      <div className="px-4 pb-4 pt-3">
        {design.multicolorOnly ||
        (design.availableColors.length === 1 && design.availableColors[0]?.id === 'multicolor') ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="h-5 w-5 rounded-full border border-slate-200 shadow-sm"
              style={colorSwatchStyle(design.availableColors[0] ?? { id: 'multicolor', hex: '#7C3AED' })}
              title="Multicolor"
              aria-hidden
            />
            <span className="text-xs text-muted">Multicolor</span>
          </div>
        ) : design.availableColors.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {design.availableColors.map((c) => {
              const selected = previewColor?.id === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  title={c.name}
                  aria-label={`Preview ${c.name}`}
                  aria-pressed={selected}
                  className={`h-5 w-5 rounded-full border shadow-sm transition ${
                    selected
                      ? 'scale-110 ring-2 ring-electric ring-offset-1'
                      : 'border-slate-200 hover:scale-105'
                  }`}
                  style={colorSwatchStyle(c)}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setPreviewColor(c)
                  }}
                />
              )
            })}
            <span className="text-xs text-muted">{previewColor?.name ?? 'Colors'}</span>
          </div>
        ) : null}
        <p className="mt-3 text-lg font-bold text-electric">
          {design.catalogPriceUsd != null ? `$${design.catalogPriceUsd.toFixed(2)}` : '—'}
        </p>
      </div>
    </article>
  )
}

export function Shop() {
  const [designs, setDesigns] = useState<PublicCatalogDesign[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void api.catalog
      .public()
      .then((d) => setDesigns(d.designs))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load catalog'))
  }, [])

  const filtered = designs.filter((d) => designMatchesQuery(d, query))

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-navy">Shop PrintX</h1>
            <p className="mt-2 text-muted">Pick a design and color — pay online, we print it.</p>
          </div>
          <CartLink primary />
        </div>

        <label className="relative mt-8 block max-w-xl">
          <span className="sr-only">Search catalog</span>
          <Search
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, category, or SKU…"
            autoComplete="off"
            className="field-input w-full !py-3 !pl-10 pr-4"
          />
        </label>

        {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <ShopCard key={d.id} design={d} />
          ))}
        </div>

        {designs.length === 0 && !error && (
          <p className="mt-10 text-sm text-muted">No designs yet.</p>
        )}
        {designs.length > 0 && filtered.length === 0 && !error && (
          <p className="mt-10 text-sm text-muted">No designs match “{query.trim()}”.</p>
        )}
      </main>
      <Footer />
    </div>
  )
}
