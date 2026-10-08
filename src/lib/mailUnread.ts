/** Fired after inbox read/unread changes so the nav badge can refresh immediately. */
export const MAIL_UNREAD_REFRESH_EVENT = 'printx:mail-unread-refresh'

/** `silent` skips browser notifications (e.g. you marked a message unread yourself). */
export function bumpMailUnread(opts?: { silent?: boolean }) {
  window.dispatchEvent(
    new CustomEvent(MAIL_UNREAD_REFRESH_EVENT, { detail: { silent: Boolean(opts?.silent) } }),
  )
}
