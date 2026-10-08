import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Pencil } from 'lucide-react'
import { api } from '../lib/api'
import { bumpMailUnread } from '../lib/mailUnread'
import type { MailMessage, MailRecipientOption } from '../types/api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAdminAuth } from '../context/AdminAuthContext'

type Tab = 'inbox' | 'sent' | 'scheduled' | 'archived' | 'trash' | 'compose'
type ComposeMode = 'new' | 'reply' | 'reply-all' | 'forward'

function daysLeftInTrash(msg: MailMessage) {
  const stamped = msg.deletedAt || msg.senderDeletedAt
  if (!stamped) return null
  const expires = new Date(stamped).getTime() + 30 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000)))
}

function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultScheduleLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  return toDatetimeLocalValue(d)
}

function labelFor(user: { email: string; displayName?: string | null }) {
  return user.displayName?.trim() || user.email
}

function withPrefix(subject: string, prefix: 'Re:' | 'Fwd:') {
  const trimmed = subject.trim() || '(no subject)'
  const re = new RegExp(`^${prefix}\\s*`, 'i')
  return re.test(trimmed) ? trimmed : `${prefix} ${trimmed}`
}

function signatureBlock(signature: string) {
  const trimmed = signature.trim()
  if (!trimmed) return ''
  return `\n\n--\n${trimmed}`
}

function quotedOriginal(msg: MailMessage) {
  const when = new Date(msg.createdAt).toLocaleString()
  const from = labelFor({ email: msg.senderEmail, displayName: msg.senderDisplayName })
  const to = msg.recipients.map(labelFor).join(', ') || '—'
  return [
    '',
    '---------- Original message ----------',
    `From: ${from}`,
    `To: ${to}`,
    `Date: ${when}`,
    `Subject: ${msg.subject}`,
    '',
    msg.body || '(empty message)',
  ].join('\n')
}

export function AdminMail() {
  const { email: myEmail } = useAdminAuth()
  const myEmailLower = (myEmail ?? '').toLowerCase()
  const [tab, setTab] = useState<Tab>('inbox')
  const [composeMode, setComposeMode] = useState<ComposeMode>('new')
  const [inbox, setInbox] = useState<MailMessage[]>([])
  const [archived, setArchived] = useState<MailMessage[]>([])
  const [sent, setSent] = useState<MailMessage[]>([])
  const [scheduled, setScheduled] = useState<MailMessage[]>([])
  const [trash, setTrash] = useState<MailMessage[]>([])
  const [recipients, setRecipients] = useState<MailRecipientOption[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [signature, setSignature] = useState('')
  const [sending, setSending] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleLocal, setScheduleLocal] = useState(defaultScheduleLocal)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MailMessage | null>(null)
  const [pendingCancelSchedule, setPendingCancelSchedule] = useState<MailMessage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [cancellingSchedule, setCancellingSchedule] = useState(false)
  const [sendingNow, setSendingNow] = useState(false)

  async function loadLists() {
    const [inboxRows, archivedRows, sentRows, scheduledRows, trashRows, people, sig] = await Promise.all([
      api.admin.mail.inbox(),
      api.admin.mail.archived(),
      api.admin.mail.sent(),
      api.admin.mail.scheduled(),
      api.admin.mail.trash(),
      api.admin.mail.recipients(),
      api.admin.mail.getSignature(),
    ])
    setInbox(inboxRows)
    setArchived(archivedRows)
    setSent(sentRows)
    setScheduled(scheduledRows)
    setTrash(trashRows)
    setRecipients(people)
    setSignature(sig.signature)
  }

  useEffect(() => {
    void loadLists()
      .then(() => bumpMailUnread({ silent: true }))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load mail'))
  }, [])

  // Pick up deliveries after scheduled_at without a full page refresh.
  useEffect(() => {
    if (tab !== 'scheduled' && tab !== 'inbox' && tab !== 'sent') return
    const id = window.setInterval(() => {
      void loadLists()
        .then(() => bumpMailUnread({ silent: true }))
        .catch(() => {})
    }, 30_000)
    return () => window.clearInterval(id)
  }, [tab])

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {})
    }
  }, [])

  const openMessage = useMemo(() => {
    const list =
      tab === 'sent'
        ? sent
        : tab === 'archived'
          ? archived
          : tab === 'scheduled'
            ? scheduled
            : tab === 'trash'
              ? trash
              : tab === 'inbox'
                ? inbox
                : [...inbox, ...archived, ...sent, ...scheduled, ...trash]
    return list.find((m) => m.id === openId) ?? null
  }, [tab, sent, inbox, archived, scheduled, trash, openId])

  const unreadCount = inbox.filter((m) => !m.readAt).length

  const meId = useMemo(
    () => recipients.find((r) => r.email.toLowerCase() === myEmailLower)?.id ?? null,
    [recipients, myEmailLower],
  )

  async function openAndMark(msg: MailMessage) {
    setOpenId(msg.id)
    if ((tab === 'inbox' || tab === 'archived') && !msg.readAt) {
      const updated = await api.admin.mail.markRead(msg.id)
      if (tab === 'inbox') setInbox((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      else setArchived((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      bumpMailUnread({ silent: true })
    }
  }

  async function setReadState(msg: MailMessage, read: boolean) {
    setError('')
    try {
      const updated = read
        ? await api.admin.mail.markRead(msg.id)
        : await api.admin.mail.markUnread(msg.id)
      if (tab === 'archived' || updated.archivedAt) {
        setArchived((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      } else {
        setInbox((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      }
      bumpMailUnread({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update read state')
    }
  }

  async function setArchiveState(msg: MailMessage, archive: boolean) {
    setError('')
    try {
      const updated = archive
        ? await api.admin.mail.archive(msg.id)
        : await api.admin.mail.unarchive(msg.id)
      setInbox((prev) => prev.filter((m) => m.id !== updated.id))
      setArchived((prev) => prev.filter((m) => m.id !== updated.id))
      if (updated.archivedAt) {
        setArchived((prev) => [updated, ...prev])
        setTab('archived')
      } else {
        setInbox((prev) =>
          [updated, ...prev].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
        )
        setTab('inbox')
      }
      setOpenId(updated.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update archive')
    }
  }

  function toggleRecipient(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function resetCompose() {
    setComposeMode('new')
    setSubject('')
    setBody(signatureBlock(signature))
    setSelectedIds([])
    setScheduleOpen(false)
    setScheduleLocal(defaultScheduleLocal())
  }

  function startCompose() {
    setTab('compose')
    setOpenId(null)
    setError('')
    if (composeMode === 'new' && !subject.trim() && !body.trim()) {
      setBody(signatureBlock(signature))
    } else if (composeMode !== 'new' && !subject && !body) {
      resetCompose()
    }
  }

  function startReply(msg: MailMessage, all: boolean) {
    const ids = new Set<string>()
    if (all) {
      if (msg.senderId) ids.add(msg.senderId)
      for (const r of msg.recipients) ids.add(r.id)
      if (meId) ids.delete(meId)
      if (ids.size === 0 && msg.senderId && msg.senderId !== meId) ids.add(msg.senderId)
    } else if (msg.senderId && msg.senderId !== meId) {
      ids.add(msg.senderId)
    }

    setComposeMode(all ? 'reply-all' : 'reply')
    setSelectedIds([...ids])
    setSubject(withPrefix(msg.subject, 'Re:'))
    setBody(`${signatureBlock(signature)}${quotedOriginal(msg)}`)
    setOpenId(null)
    setError('')
    setTab('compose')
  }

  function startForward(msg: MailMessage) {
    setComposeMode('forward')
    setSelectedIds([])
    setSubject(withPrefix(msg.subject, 'Fwd:'))
    setBody(`${signatureBlock(signature)}${quotedOriginal(msg)}`)
    setOpenId(null)
    setError('')
    setTab('compose')
  }

  async function sendMail(opts?: { scheduledAt?: string }) {
    setError('')
    setSending(true)
    try {
      const recipientIds = selectedIds
      await api.admin.mail.send({
        subject,
        body,
        recipientIds,
        scheduledAt: opts?.scheduledAt,
      })
      resetCompose()
      await loadLists()
      bumpMailUnread({ silent: true })
      const onlySelf = Boolean(meId && recipientIds.length === 1 && recipientIds[0] === meId)
      setTab(opts?.scheduledAt ? 'scheduled' : onlySelf ? 'inbox' : 'sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function scheduleMail() {
    setError('')
    const when = new Date(scheduleLocal)
    if (Number.isNaN(when.getTime())) {
      setError('Pick a valid date and time.')
      return
    }
    if (when.getTime() < Date.now() + 60_000) {
      setError('Schedule time must be at least 1 minute from now.')
      return
    }
    await sendMail({ scheduledAt: when.toISOString() })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const forever = tab === 'trash'
      const mailbox =
        tab === 'inbox' || tab === 'archived' || tab === 'sent' || tab === 'trash' ? tab : 'inbox'
      const trashedId = pendingDelete.id
      await api.admin.mail.delete(trashedId, { mailbox, forever })
      setPendingDelete(null)
      await loadLists()
      bumpMailUnread({ silent: true })
      if (forever) {
        if (openId === trashedId) setOpenId(null)
      } else {
        setTab('trash')
        setOpenId(trashedId)
      }
    } finally {
      setDeleting(false)
    }
  }

  async function restoreMessage(msg: MailMessage) {
    setError('')
    setRestoring(true)
    try {
      const updated = await api.admin.mail.restore(msg.id)
      await loadLists()
      bumpMailUnread({ silent: true })
      const source = updated.trashSource ?? msg.trashSource
      if (source === 'sent') setTab('sent')
      else if (updated.archivedAt) setTab('archived')
      else setTab('inbox')
      setOpenId(updated.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore message')
    } finally {
      setRestoring(false)
    }
  }

  async function confirmCancelSchedule() {
    if (!pendingCancelSchedule) return
    setCancellingSchedule(true)
    try {
      await api.admin.mail.cancelSchedule(pendingCancelSchedule.id)
      if (openId === pendingCancelSchedule.id) setOpenId(null)
      setPendingCancelSchedule(null)
      await loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel scheduled send')
    } finally {
      setCancellingSchedule(false)
    }
  }

  async function sendScheduledNow(msg: MailMessage) {
    setError('')
    setSendingNow(true)
    try {
      const updated = await api.admin.mail.sendNow(msg.id)
      await loadLists()
      setTab('sent')
      setOpenId(updated.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send now')
    } finally {
      setSendingNow(false)
    }
  }

  const list =
    tab === 'sent'
      ? sent
      : tab === 'archived'
        ? archived
        : tab === 'scheduled'
          ? scheduled
          : tab === 'trash'
            ? trash
            : inbox
  const composeTitle =
    composeMode === 'reply'
      ? 'Reply'
      : composeMode === 'reply-all'
        ? 'Reply all'
        : composeMode === 'forward'
          ? 'Forward'
          : 'New message'

  const readingOnMobile = Boolean(openMessage) && tab !== 'compose'

  return (
    <div className="min-w-0 max-w-full">
      <div className={readingOnMobile ? 'hidden lg:block' : ''}>
        <h1 className="text-2xl font-bold text-navy">Mail</h1>
        <p className="mt-1 text-sm text-muted sm:text-base">
          In-app messages between PrintX admins. Separate from the public contact Inbox — nothing is sent as real
          email.
        </p>
      </div>

      <div className={`mt-4 min-w-0 sm:mt-6 ${readingOnMobile ? 'hidden lg:block' : ''}`}>
        {/* Extra y-padding so hover lift / shadows aren’t clipped by the scrollport */}
        <div className="flex items-center gap-3 py-1.5">
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max min-w-full gap-2 px-0.5 py-1">
              {(
                [
                  { id: 'inbox' as const, label: unreadCount ? `Inbox (${unreadCount})` : 'Inbox' },
                  { id: 'sent' as const, label: 'Sent' },
                  {
                    id: 'scheduled' as const,
                    label: scheduled.length ? `Scheduled (${scheduled.length})` : 'Scheduled',
                  },
                  { id: 'archived' as const, label: archived.length ? `Archive (${archived.length})` : 'Archive' },
                  { id: 'trash' as const, label: trash.length ? `Trash (${trash.length})` : 'Trash' },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`btn btn-compact shrink-0 ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
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
          </div>
          <button
            type="button"
            className={`btn btn-compact shrink-0 ${tab === 'compose' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={startCompose}
          >
            <Pencil size={14} />
            Compose
          </button>
        </div>
      </div>

      {error && <p className="mt-4 break-words text-sm text-red-600">{error}</p>}

      {tab === 'compose' ? (
        <div className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:mt-6 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-navy">{composeTitle}</h2>
            {composeMode !== 'new' && (
              <button type="button" className="btn btn-ghost" onClick={resetCompose}>
                Start fresh
              </button>
            )}
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-navy">To</p>
              <div className="flex flex-wrap gap-2">
                {recipients.map((person) => {
                  const isMe = person.email.toLowerCase() === myEmailLower
                  const selected = selectedIds.includes(person.id)
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
                      {isMe ? `${labelFor(person)} (you)` : labelFor(person)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-muted">
                You can include yourself. Self-mail shows in Inbox; other sends also appear in Sent.
              </p>
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
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
              />
            </label>
            {signature.trim() ? (
              <p className="text-xs text-muted">
                Your signature is included below (edit under Settings if needed).
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={sending || selectedIds.length === 0}
                onClick={() => void sendMail()}
              >
                {sending && !scheduleOpen ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={sending || selectedIds.length === 0}
                onClick={() => {
                  setScheduleOpen((open) => !open)
                  setScheduleLocal(defaultScheduleLocal())
                }}
              >
                Schedule send
              </button>
            </div>
            {scheduleOpen && (
              <div className="rounded-xl border border-dashed bg-surface/60 p-4">
                <label className="block text-sm font-medium text-navy">
                  Send on
                  <input
                    type="datetime-local"
                    className="mt-1 w-full max-w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 sm:max-w-xs sm:text-sm"
                    value={scheduleLocal}
                    min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
                    onChange={(e) => setScheduleLocal(e.target.value)}
                  />
                </label>
                <p className="mt-2 text-xs text-muted">Uses your local timezone. Cancel anytime from Scheduled.</p>
                <button
                  type="button"
                  className="btn btn-primary mt-3"
                  disabled={sending || selectedIds.length === 0 || !scheduleLocal}
                  onClick={() => void scheduleMail()}
                >
                  {sending ? 'Scheduling…' : 'Confirm schedule'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid min-w-0 gap-4 sm:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className={`min-w-0 space-y-3 ${openMessage ? 'hidden lg:block' : ''}`}>
            {list.length === 0 && (
              <p className="rounded-xl border border-dashed bg-white p-8 text-center text-muted">
                {tab === 'sent'
                  ? 'No sent messages yet.'
                  : tab === 'archived'
                    ? 'No archived messages.'
                    : tab === 'scheduled'
                      ? 'No scheduled sends.'
                      : tab === 'trash'
                        ? 'Trash is empty.'
                        : 'No mail yet.'}
              </p>
            )}
            {tab === 'trash' && list.length > 0 && (
              <p className="text-xs text-muted">Messages are permanently deleted after 30 days.</p>
            )}
            {tab === 'scheduled' && list.length > 0 && (
              <p className="text-xs text-muted">These send automatically at the scheduled time.</p>
            )}
            {list.map((msg) => {
              const unread = (tab === 'inbox' || tab === 'archived') && !msg.readAt
              const left = tab === 'trash' ? daysLeftInTrash(msg) : null
              return (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => void openAndMark(msg)}
                  className={`w-full max-w-full rounded-xl border bg-white p-4 text-left transition-colors hover:border-electric/40 ${
                    openId === msg.id ? 'border-electric/50' : 'border-slate-200'
                  } ${unread ? 'border-electric/40' : ''}`}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-semibold text-navy">{msg.subject}</p>
                    {unread && (
                      <span className="rounded-full bg-electric/15 px-2 py-0.5 text-xs font-semibold text-electric">
                        New
                      </span>
                    )}
                    {left != null && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-muted">
                        {left === 0 ? 'Expires today' : `${left}d left`}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-words text-sm text-muted">
                    {tab === 'sent' || tab === 'scheduled' || msg.trashSource === 'sent'
                      ? `To ${msg.recipients.map(labelFor).join(', ') || '—'}`
                      : `From ${labelFor({ email: msg.senderEmail, displayName: msg.senderDisplayName })}`}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {tab === 'scheduled' && msg.scheduledAt
                      ? `Sends ${new Date(msg.scheduledAt).toLocaleString()}`
                      : new Date(msg.createdAt).toLocaleString()}
                  </p>
                </button>
              )
            })}
          </div>

          <div
            className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 ${
              openMessage ? '' : 'hidden lg:block'
            }`}
          >
            {!openMessage ? (
              <p className="text-sm text-muted">Select a message to read it.</p>
            ) : (
              <div className="min-w-0">
                <button
                  type="button"
                  className="btn btn-ghost btn-compact mb-3 !justify-start lg:hidden"
                  onClick={() => setOpenId(null)}
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-bold text-navy">{openMessage.subject}</h2>
                  <p className="mt-1 break-words text-sm text-muted">
                    From {labelFor({ email: openMessage.senderEmail, displayName: openMessage.senderDisplayName })}
                  </p>
                  <p className="break-words text-sm text-muted">
                    To {openMessage.recipients.map(labelFor).join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {tab === 'scheduled' && openMessage.scheduledAt
                      ? `Scheduled for ${new Date(openMessage.scheduledAt).toLocaleString()}`
                      : new Date(openMessage.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="mt-4 flex w-full min-w-0 flex-wrap gap-2">
                  {tab === 'trash' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={restoring}
                        onClick={() => void restoreMessage(openMessage)}
                      >
                        {restoring ? 'Restoring…' : 'Restore'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        onClick={() => setPendingDelete(openMessage)}
                      >
                        Delete forever
                      </button>
                    </>
                  ) : tab === 'scheduled' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={sendingNow}
                        onClick={() => void sendScheduledNow(openMessage)}
                      >
                        {sendingNow ? 'Sending…' : 'Send now'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        onClick={() => setPendingCancelSchedule(openMessage)}
                      >
                        Cancel send
                      </button>
                    </>
                  ) : (
                    <>
                      {(tab === 'inbox' || tab === 'archived') && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => void setReadState(openMessage, !openMessage.readAt)}
                        >
                          {openMessage.readAt ? 'Mark unread' : 'Mark read'}
                        </button>
                      )}
                      {tab === 'inbox' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => void setArchiveState(openMessage, true)}
                        >
                          Archive
                        </button>
                      )}
                      {tab === 'archived' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => void setArchiveState(openMessage, false)}
                        >
                          Move to inbox
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => startReply(openMessage, false)}
                      >
                        Reply
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => startReply(openMessage, true)}
                      >
                        Reply all
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => startForward(openMessage)}
                      >
                        Forward
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        onClick={() => setPendingDelete(openMessage)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
                <p className="mt-5 break-words whitespace-pre-wrap text-sm leading-relaxed text-navy">
                  {openMessage.body || '(empty message)'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={tab === 'trash' ? 'Delete forever?' : 'Move to Trash?'}
        message={
          pendingDelete
            ? tab === 'trash'
              ? `Permanently delete “${pendingDelete.subject}”? This cannot be undone.`
              : `Move “${pendingDelete.subject}” to Trash? You can restore it within 30 days.`
            : ''
        }
        confirmLabel={tab === 'trash' ? 'Delete forever' : 'Move to Trash'}
        danger
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={Boolean(pendingCancelSchedule)}
        title="Cancel scheduled send?"
        message={
          pendingCancelSchedule
            ? `Cancel “${pendingCancelSchedule.subject}”? It will not be sent and will be removed from Scheduled.`
            : ''
        }
        confirmLabel="Cancel send"
        danger
        busy={cancellingSchedule}
        onCancel={() => setPendingCancelSchedule(null)}
        onConfirm={() => void confirmCancelSchedule()}
      />
    </div>
  )
}
