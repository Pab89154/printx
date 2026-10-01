import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ContactMessage } from '../types/api'
import { mailtoHref } from '../lib/mailto'

export function AdminMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([])

  async function load() {
    setMessages(await api.admin.messages.list())
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Inbox</h1>
      <p className="mt-1 text-muted">
        Feedback and contact form messages. Also emailed to hello@printx.pw when email is configured.
      </p>

      <div className="mt-6 space-y-4">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed bg-white p-8 text-center text-muted">
            No messages yet.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`rounded-xl border bg-white p-5 ${msg.status === 'new' ? 'border-electric/40' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-navy">{msg.name}</p>
                  {msg.status === 'new' && (
                    <span className="rounded-full bg-electric/15 px-2 py-0.5 text-xs font-semibold text-electric">
                      New
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted">
                  <a
                    href={mailtoHref(msg.email, { subject: `Re: ${msg.inquiry_type || 'PrintX'}` })}
                    className="text-electric hover:underline"
                  >
                    {msg.email}
                  </a>
                  {msg.inquiry_type ? ` · ${msg.inquiry_type}` : ''}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-navy">{msg.message}</p>
                <p className="mt-2 text-xs text-muted">
                  Received {new Date(msg.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {msg.status === 'new' && (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-navy hover:border-electric"
                    onClick={() => api.admin.messages.updateStatus(msg.id, 'read').then(load)}
                  >
                    Mark read
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-red-600 hover:border-red-300"
                  onClick={() => {
                    if (confirm('Delete this message?')) {
                      api.admin.messages.delete(msg.id).then(load)
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
