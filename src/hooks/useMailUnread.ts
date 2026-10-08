import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { MAIL_UNREAD_REFRESH_EVENT } from '../lib/mailUnread'
import { adminPath } from '../lib/portal'

const POLL_MS = 20_000

type UnreadSnapshot = {
  count: number
  latestId: string | null
  latestSubject: string | null
  latestFrom: string | null
}

function showBrowserNotification(input: {
  title: string
  body: string
  onClick: () => void
}) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(input.title, {
      body: input.body,
      tag: 'printx-mail-unread',
      renotify: true,
    })
    n.onclick = () => {
      window.focus()
      input.onClick()
      n.close()
    }
  } catch {
    /* unsupported / blocked */
  }
}

/** Polls unread mail count for the nav badge + browser notifications while admin is open. */
export function useMailUnread(enabled: boolean) {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const baselineRef = useRef<UnreadSnapshot | null>(null)
  const permissionAskedRef = useRef(false)

  const ensurePermission = useCallback(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'default' || permissionAskedRef.current) return
    permissionAskedRef.current = true
    void Notification.requestPermission().catch(() => {})
  }, [])

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!enabled) {
      setCount(0)
      return
    }
    try {
      const next = await api.admin.mail.unreadCount()
      setCount(next.count)

      const prev = baselineRef.current
      if (!prev) {
        baselineRef.current = next
        return
      }

      const grew = next.count > prev.count
      const newLatest = Boolean(next.latestId && next.latestId !== prev.latestId)
      if (!opts?.silent && (grew || newLatest) && next.count > 0) {
        const subject = next.latestSubject?.trim() || 'New message'
        const from = next.latestFrom?.trim() || 'PrintX Mail'
        showBrowserNotification({
          title: next.count === 1 ? 'New PrintX mail' : `${next.count} unread PrintX messages`,
          body: `${from}: ${subject}`,
          onClick: () => navigate(adminPath('mail')),
        })
      }
      baselineRef.current = next
    } catch {
      /* session expired / offline — keep last known count */
    }
  }, [enabled, navigate])

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      baselineRef.current = null
      return
    }

    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, POLL_MS)

    const onBump = (event: Event) => {
      const silent = Boolean((event as CustomEvent<{ silent?: boolean }>).detail?.silent)
      void refresh({ silent })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh({ silent: true })
    }

    window.addEventListener(MAIL_UNREAD_REFRESH_EVENT, onBump)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(id)
      window.removeEventListener(MAIL_UNREAD_REFRESH_EVENT, onBump)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, refresh])

  return { unreadCount: count, refreshMailUnread: refresh, ensureMailNotificationPermission: ensurePermission }
}
