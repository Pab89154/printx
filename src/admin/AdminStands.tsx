import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Product, Stand } from '../types/api'
import { validateStandSchedule } from '../../shared/standSchedule'

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm'

function todayInputValue(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function AdminStands() {
  const [stands, setStands] = useState<Stand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [editing, setEditing] = useState<Partial<Stand> | null>(null)
  const [formError, setFormError] = useState('')

  async function load() {
    const [s, p] = await Promise.all([api.admin.stands.list(), api.admin.products.list()])
    setStands(s)
    setProducts(p)
  }

  useEffect(() => {
    load()
  }, [])

  function newStand() {
    setFormError('')
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
    setFormError('')
    const name = (editing.schoolName ?? '').trim()
    const address = (editing.location ?? '').trim()
    if (!name || !address) {
      setFormError('Please enter a name and an address.')
      return
    }
    const scheduleError = validateStandSchedule({
      date: editing.date ?? '',
      startTime: editing.startTime ?? '',
      endTime: editing.endTime ?? '',
      status: editing.status,
    })
    if (scheduleError) {
      setFormError(scheduleError)
      return
    }
    const body = {
      schoolId: null,
      schoolName: name,
      date: editing.date,
      startTime: editing.startTime,
      endTime: editing.endTime,
      location: address,
      description: editing.description,
      notes: editing.notes,
      products: editing.products,
      status: editing.status,
    }
    try {
      if (editing.id) await api.admin.stands.update(editing.id, body)
      else await api.admin.stands.create(body)
      setEditing(null)
      load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save stand')
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-navy">Manage Stands</h1>
        <button type="button" onClick={newStand} className="rounded-xl bg-electric px-4 py-2.5 text-sm font-semibold text-white">
          + Add Stand
        </button>
      </div>

      {editing && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="mb-4 font-semibold">{editing.id ? 'Edit Stand' : 'New Stand'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Name
              <input
                className={inputClass}
                placeholder="The Funky Club"
                value={editing.schoolName ?? ''}
                onChange={(e) => setEditing({ ...editing, schoolName: e.target.value })}
              />
            </label>
            <label>
              Address
              <input
                className={inputClass}
                placeholder="1234 Main St."
                value={editing.location ?? ''}
                onChange={(e) => setEditing({ ...editing, location: e.target.value })}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                min={editing.status === 'past' ? undefined : todayInputValue()}
                className={inputClass}
                value={editing.date ?? ''}
                onChange={(e) => setEditing({ ...editing, date: e.target.value })}
              />
            </label>
            <label>
              Start time
              <input
                className={inputClass}
                value={editing.startTime ?? ''}
                onChange={(e) => setEditing({ ...editing, startTime: e.target.value })}
              />
            </label>
            <label>
              End time
              <input
                className={inputClass}
                value={editing.endTime ?? ''}
                onChange={(e) => setEditing({ ...editing, endTime: e.target.value })}
              />
            </label>
            <label>
              Status
              <select
                className={inputClass}
                value={editing.status ?? 'upcoming'}
                onChange={(e) => setEditing({ ...editing, status: e.target.value as Stand['status'] })}
              >
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="past">Past</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              Description
              <textarea
                className={inputClass}
                rows={2}
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2">
              Notes (admin only)
              <textarea
                className={inputClass}
                rows={2}
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2">
              Products available
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
          {formError && <p className="mt-4 text-sm text-red-600">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} className="rounded-xl bg-electric px-4 py-2 text-sm font-semibold text-white">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setFormError('')
              }}
              className="rounded-xl border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {stands.map((stand) => {
          const isPast = stand.status === 'past'
          return (
            <div
              key={stand.id}
              className={`flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between ${
                isPast ? 'border-slate-200 opacity-90' : 'border-slate-100'
              }`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-navy">{stand.schoolName}</p>
                <p className="break-words text-sm text-muted">{stand.location}</p>
                <p className="text-sm text-muted">
                  {stand.date} · {stand.startTime} – {stand.endTime}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                    isPast
                      ? 'bg-slate-100 text-slate-600'
                      : stand.status === 'active'
                        ? 'bg-cyan/10 text-cyan'
                        : 'bg-electric/10 text-electric'
                  }`}
                >
                  {isPast ? 'Past' : stand.status}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormError('')
                    setEditing(stand)
                  }}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm sm:flex-none sm:py-1.5"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => api.admin.stands.delete(stand.id).then(load)}
                  className="flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 sm:flex-none sm:py-1.5"
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
        {stands.length === 0 && (
          <p className="rounded-xl border border-dashed bg-white p-8 text-center text-muted">
            No stands yet. Add an upcoming stand to show it on the public site.
          </p>
        )}
      </div>
    </div>
  )
}
