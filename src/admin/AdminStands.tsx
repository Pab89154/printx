import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Product, School, Stand } from '../types/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-electric focus:ring-2 focus:ring-electric/20'

export function AdminStands() {
  const [stands, setStands] = useState<Stand[]>([])
  const [schools, setSchools] = useState<School[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [editing, setEditing] = useState<Partial<Stand> | null>(null)

  async function load() {
    const [s, sc, p] = await Promise.all([
      api.admin.stands.list(),
      api.admin.schools.list(),
      api.admin.products.list(),
    ])
    setStands(s)
    setSchools(sc)
    setProducts(p)
  }

  useEffect(() => {
    load()
  }, [])

  function newStand() {
    setEditing({
      schoolName: '',
      date: '',
      startTime: '3:00 PM',
      endTime: '4:00 PM',
      location: '',
      description: '',
      notes: '',
      products: [],
      status: 'upcoming',
    })
  }

  async function save() {
    if (!editing) return
    const body = {
      schoolId: editing.schoolId,
      schoolName: editing.schoolName,
      date: editing.date,
      startTime: editing.startTime,
      endTime: editing.endTime,
      location: editing.location,
      description: editing.description,
      notes: editing.notes,
      products: editing.products,
      status: editing.status,
    }
    if (editing.id) await api.admin.stands.update(editing.id, body)
    else await api.admin.stands.create(body)
    setEditing(null)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Manage Stands</h1>
        <button type="button" onClick={newStand} className="rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">
          + Add Stand
        </button>
      </div>

      {editing && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 font-semibold">{editing.id ? 'Edit Stand' : 'New Stand'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>School
              <select
                className={inputClass}
                value={editing.schoolId ?? ''}
                onChange={(e) => {
                  const school = schools.find((s) => s.id === e.target.value)
                  setEditing({
                    ...editing,
                    schoolId: e.target.value || undefined,
                    schoolName: school?.name ?? editing.schoolName,
                  })
                }}
              >
                <option value="">Select a school…</option>
                {schools.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>School name (display)<input className={inputClass} value={editing.schoolName ?? ''} onChange={(e) => setEditing({ ...editing, schoolName: e.target.value })} /></label>
            <label>Date<input type="date" className={inputClass} value={editing.date ?? ''} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></label>
            <label>Start time<input className={inputClass} value={editing.startTime ?? ''} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })} /></label>
            <label>End time<input className={inputClass} value={editing.endTime ?? ''} onChange={(e) => setEditing({ ...editing, endTime: e.target.value })} /></label>
            <label className="sm:col-span-2">Location<input className={inputClass} value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></label>
            <label className="sm:col-span-2">Description<textarea className={inputClass} rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label className="sm:col-span-2">Notes<textarea className={inputClass} rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
            <label>Status
              <select className={inputClass} value={editing.status ?? 'upcoming'} onChange={(e) => setEditing({ ...editing, status: e.target.value as Stand['status'] })}>
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="past">Past</option>
              </select>
            </label>
            <label className="sm:col-span-2">Products available
              <div className="mt-2 flex flex-wrap gap-2">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={(editing.products ?? []).includes(p.name)}
                      onChange={(e) => {
                        const list = editing.products ?? []
                        setEditing({
                          ...editing,
                          products: e.target.checked ? [...list, p.name] : list.filter((n) => n !== p.name),
                        })
                      }}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} className="rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {stands.map((stand) => (
          <div key={stand.id} className="flex items-center justify-between rounded-xl border bg-white p-4">
            <div>
              <p className="font-semibold text-navy">{stand.schoolName}</p>
              <p className="text-sm text-muted">{stand.date} · {stand.startTime} – {stand.endTime} · {stand.location}</p>
              <span className="mt-1 inline-block rounded-full bg-electric/10 px-2 py-0.5 text-xs font-medium text-electric">{stand.status}</span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(stand)} className="rounded-lg border px-3 py-1.5 text-sm">Edit</button>
              <button type="button" onClick={() => api.admin.stands.delete(stand.id).then(load)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
