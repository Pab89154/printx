import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { MailMessage, MailRecipientOption } from '../types/api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAdminAuth } from '../context/AdminAuthContext'

type Tab = 'inbox' | 'sent' | 'compose'

function labelFor(user: { email: string; displayName?: string | null }) {
  return user.displayName?.trim() || user.email
}

export function AdminMail() {
  const { email: myEmail } = useAdminAuth()
  const [tab, setTab] = useState<Tab>('inbox')
  const [inbox, setInbox] = useState<MailMessage[]>([])
  const [sent, setSent] = useState<MailMessage[]>([])
  const [recipients, setRecipients] = useState<MailRecipientOption[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MailMessage | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function loadLists() {
    const [inboxRows, sentRows, people] = await Promise.all([
      api.admin.mail.inbox(),
      api.admin.mail.sent(),
      api.admin.mail.recipients(),
    ])
    setInbox(inboxRows)
    setSent(sentRows)
    setRecipients(people)
  }

  useEffect(() => {
    void loadLists().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load mail'))
  }, [])

  const openMessage = useMemo(() => {
    const list = tab === 'sent' ? sent : inbox
    return list.find((m) => m.id === openId) ?? null
  }, [tab, sent, inbox, openId])

  const unreadCount = inbox.filter((m) => !m.readAt).length

  async function openAndMark(msg: MailMessage) {
    setOpenId(msg.id)
    if (tab === 'inbox' && !msg.readAt) {
      const updated = await api.admin.mail.markRead(msg.id)
      setInbox((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    }
  }

  function toggleRecipient(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function sendMail() {
    setError('')
    setSending(true)
    try {
      await api.admin.mail.send({ subject, body, recipientIds: selectedIds })
      setSubject('')
      setBody('')
      setSelectedIds([])
      await loadLists()
      setTab('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.admin.mail.delete(pendingDelete.id)
      if (openId === pendingDelete.id) setOpenId(null)
      setPendingDelete(null)
      await loadLists()
    } finally {
      setDeleting(false)
    }
  }

  const list = tab === 'sent' ? sent : inbox

  return (
    <div>
      <h1 className="text-2xl font-bold text-navy">Mail</h1>
      <p className="mt-1 text-muted">
        In-app messages between PrintX admins. Separate from the public contact Inbox — nothing is sent as real email.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            { id: 'inbox', label: unreadCount ? `Inbox (${unreadCount})` : 'Inbox' },
            { id: 'sent', label: 'Sent' },
            { id: 'compose', label: 'Compose' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setTab(t.id)
              setOpenId(null)
              setError('')
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {tab === 'compose' ? (
        <div className="mt-6 rounded-2xl border bg-white p-6">
          <h2 className="font-semibold text-navy">New message</h2>
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-navy">To</p>
              <div className="flex flex-wrap gap-2">
                {recipients.map((person) => {
                  const selected = selectedIds.includes(person.id)
                  const isMe = person.email.toLowerCase() === (myEmail ?? '').toLowerCase()
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => toggleRecipient(person.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        selected
                          ? 'border-electric bg-electric/10 text-electric'
                          : 'border-slate-200 bg-white text-navy hover:border-electric/40'
                      }`}
                    >
                      {labelFor(person)}
                      {isMe ? ' (you)' : ''}
                    </button>
                  )
                })}
              </div>
              {recipients.length === 0 && (
                <p className="text-sm text-muted">No admin accounts found.</p>
              )}
            </div>
            <label className="block text-sm font-medium text-navy">
              Subject
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
              />
            </label>
            <label className="block text-sm font-medium text-navy">
              Message
              <textarea
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:text-sm"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending || selectedIds.length === 0}
              onClick={() => void sendMail()}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            {list.length === 0 && (
              <p className="rounded-xl border border-dashed bg-white p-8 text-center text-muted">
                {tab === 'sent' ? 'No sent messages yet.' : 'No mail yet.'}
              </p>
            )}
            {list.map((msg) => {
              const unread = tab === 'inbox' && !msg.readAt
              return (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => void openAndMark(msg)}
                  className={`w-full rounded-xl border bg-white p-4 text-left transition-colors hover:border-electric/40 ${
                    openId === msg.id ? 'border-electric/50' : ''
                  } ${unread ? 'border-electric/40' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-navy">{msg.subject}</p>
                    {unread && (
                      <span className="rounded-full bg-electric/15 px-2 py-0.5 text-xs font-semibold text-electric">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {tab === 'sent'
                      ? `To ${msg.recipients.map(labelFor).join(', ') || '—'}`
                      : `From ${labelFor({ email: msg.senderEmail, displayName: msg.senderDisplayName })}`}
                  </p>
                  <p className="mt-1 text-xs text-muted">{new Date(msg.createdAt).toLocaleString()}</p>
                </button>
              )
            })}
          </div>

          <div className="rounded-xl border bg-white p-5">
            {!openMessage ? (
              <p className="text-sm text-muted">Select a message to read it.</p>
            ) : (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-navy">{openMessage.subject}</h2>
                    <p className="mt-1 text-sm text-muted">
                      From {labelFor({ email: openMessage.senderEmail, displayName: openMessage.senderDisplayName })}
                    </p>
                    <p className="text-sm text-muted">
                      To {openMessage.recipients.map(labelFor).join(', ')}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(openMessage.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setPendingDelete(openMessage)}
                  >
                    Delete
                  </button>
                </div>
                <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-navy">
                  {openMessage.body || '(empty message)'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete message?"
        message={
          pendingDelete
            ? tab === 'sent'
              ? `Delete “${pendingDelete.subject}” for everyone?`
              : `Remove “${pendingDelete.subject}” from your inbox?`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}
