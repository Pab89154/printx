import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ContactMessage } from '../types/api'
import { mailtoHref } from '../lib/mailto'
import { ConfirmDialog } from '../components/ConfirmDialog'

export function AdminMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [pendingDelete, setPendingDelete] = useState<ContactMessage | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setMessages(await api.admin.messages.list())
  }

  useEffect(() => {
    load()
  }, [])

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.admin.messages.delete(pendingDelete.id)
      setPendingDelete(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

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
            <div className="flex flex-wrap items-center justify-between gap-3">
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
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {msg.status === 'new' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => api.admin.messages.updateStatus(msg.id, 'read').then(load)}
                  >
                    Mark read
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setPendingDelete(msg)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete message?"
        message={
          pendingDelete
            ? `Remove the message from ${pendingDelete.name}? This can’t be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
