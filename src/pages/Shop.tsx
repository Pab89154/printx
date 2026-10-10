import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { PublicCatalogDesign } from '../types/catalog'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { CartLink } from '../components/CartLink'

export function Shop() {
  const [designs, setDesigns] = useState<PublicCatalogDesign[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void api.catalog
      .public()
      .then((d) => setDesigns(d.designs))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load catalog'))
  }, [])

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

        {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {designs.map((d) => (
            <Link
              key={d.id}
              to={`/shop/${encodeURIComponent(d.skuBase)}`}
              className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:shadow-md"
            >
              <div className="aspect-square bg-slate-50">
                {d.imageUrl ? (
                  <img
                    src={d.imageUrl}
                    alt={d.name}
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                ) : null}
              </div>
              <div className="p-4">
                <p className="font-semibold text-navy">{d.name}</p>
                <p className="mt-1 text-sm text-muted line-clamp-2">{d.description}</p>
                <p className="mt-3 text-lg font-bold text-electric">
                  {d.catalogPriceUsd != null ? `$${d.catalogPriceUsd.toFixed(2)}` : '—'}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {designs.length === 0 && !error && (
          <p className="mt-10 text-sm text-muted">No approved designs in the catalog yet.</p>
        )}
      </main>
      <Footer />
    </div>
  )
}
