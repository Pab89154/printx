import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PRODUCT_ICON_OPTIONS, WebIcon } from '../lib/webIcon'
import type { Product } from '../types/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-electric focus:ring-2 focus:ring-electric/20'

const gradients = [
  'from-navy to-electric',
  'from-electric to-cyan',
  'from-cyan to-electric',
  'from-navy via-navy-mid to-cyan',
  'from-electric to-navy',
  'from-cyan to-navy',
]

export function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [editing, setEditing] = useState<Partial<Product> | null>(null)

  async function load() {
    setProducts(await api.admin.products.list())
  }

  useEffect(() => {
    load()
  }, [])

  function newProduct() {
    setEditing({
      name: '',
      description: '',
      price: 5,
      category: 'General',
      emoji: 'package',
      imageGradient: gradients[0],
      available: true,
      featured: false,
      displayOrder: products.length + 1,
    })
  }

  async function save() {
    if (!editing) return
    const body = { ...editing }
    if (editing.id) await api.admin.products.update(editing.id, body)
    else await api.admin.products.create(body)
    setEditing(null)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Manage Products</h1>
        <button type="button" onClick={newProduct} className="rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">
          + Add Product
        </button>
      </div>

      {editing && (
        <div className="mt-6 rounded-2xl border bg-white p-6">
          <h2 className="mb-4 font-semibold">{editing.id ? 'Edit Product' : 'New Product'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Name<input className={inputClass} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>Price ($)<input type="number" step="0.01" className={inputClass} value={editing.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></label>
            <label>Category<input className={inputClass} value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></label>
            <label>Icon (from Lucide CDN)
              <select className={inputClass} value={editing.emoji ?? 'package'} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })}>
                {PRODUCT_ICON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label} ({opt.value})</option>
                ))}
              </select>
            </label>
            <label>Display order<input type="number" className={inputClass} value={editing.displayOrder ?? 0} onChange={(e) => setEditing({ ...editing, displayOrder: Number(e.target.value) })} /></label>
            <label>Gradient
              <select className={inputClass} value={editing.imageGradient ?? gradients[0]} onChange={(e) => setEditing({ ...editing, imageGradient: e.target.value })}>
                {gradients.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2">Product image URL (optional)
              <input className={inputClass} type="url" placeholder="https://example.com/photo.jpg" value={editing.image ?? ''} onChange={(e) => setEditing({ ...editing, image: e.target.value })} />
            </label>
            <label className="sm:col-span-2">Description<textarea className={inputClass} rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.available ?? true} onChange={(e) => setEditing({ ...editing, available: e.target.checked })} /> Available</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.featured ?? false} onChange={(e) => setEditing({ ...editing, featured: e.target.checked })} /> Featured</label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} className="rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-3">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border bg-white p-4">
            <div className="flex items-center gap-3">
              <WebIcon name={p.emoji} className="h-8 w-8" alt="" />
              <div>
                <p className="font-semibold text-navy">{p.name} — ${p.price}</p>
                <p className="text-sm text-muted">{p.description}</p>
                <div className="mt-1 flex gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${p.available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {p.available ? 'Available' : 'Unavailable'}
                  </span>
                  {p.featured && <span className="rounded-full bg-electric/10 px-2 py-0.5 text-xs text-electric">Featured</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(p)} className="rounded-lg border px-3 py-1.5 text-sm">Edit</button>
              <button type="button" onClick={() => api.admin.products.delete(p.id).then(load)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
