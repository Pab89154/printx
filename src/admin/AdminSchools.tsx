import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { School } from '../types/api'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm'

export function AdminSchools() {
  const [schools, setSchools] = useState<School[]>([])
  const [editing, setEditing] = useState<Partial<School> | null>(null)

  async function load() {
    setSchools(await api.admin.schools.list())
  }

  useEffect(() => {
    load()
  }, [])

  function newSchool() {
    setEditing({ name: '', address: '', description: '', image: '', active: 1 })
  }

  async function save() {
    if (!editing) return
    const body = {
      name: editing.name,
      address: editing.address,
      description: editing.description,
      image: editing.image,
      active: editing.active !== 0,
    }
    if (editing.id) await api.admin.schools.update(editing.id, body)
    else await api.admin.schools.create(body)
    setEditing(null)
    load()
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-navy">Manage Schools</h1>
        <button type="button" onClick={newSchool} className="rounded-xl bg-electric px-4 py-2.5 text-sm font-semibold text-white">
          + Add School
        </button>
      </div>

      {editing && (
        <div className="mt-6 rounded-2xl border bg-white p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Name<input className={inputClass} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>Address<input className={inputClass} value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></label>
            <label className="sm:col-span-2">Description<textarea className={inputClass} rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label className="sm:col-span-2">Logo / image URL (optional)
              <input className={inputClass} type="url" placeholder="https://example.com/logo.png" value={editing.image ?? ''} onChange={(e) => setEditing({ ...editing, image: e.target.value })} />
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.active !== 0} onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })} /> Active</label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} className="rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {schools.map((school) => (
          <div
            key={school.id}
            className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold text-navy">{school.name}</p>
              <p className="break-words text-sm text-muted">{school.address}</p>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${school.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {school.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => setEditing(school)} className="flex-1 rounded-lg border px-3 py-2 text-sm sm:flex-none sm:py-1.5">
                Edit
              </button>
              <button
                type="button"
                onClick={() => api.admin.schools.delete(school.id).then(load)}
                className="flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 sm:flex-none sm:py-1.5"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
