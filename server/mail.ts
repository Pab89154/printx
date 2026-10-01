/**
 * Notify hello@printx.pw (and PRINTX_NOTIFY_EMAIL) via Resend.
 * Messages are always saved in the portal first; email is best-effort.
 * If email fails or RESEND_API_KEY is missing, open the portal inbox instead.
 */

const DEFAULT_NOTIFY = 'hello@printx.pw'
const PORTAL_MESSAGES = 'https://portal.printx.pw/messages'
const PORTAL_REQUESTS = 'https://portal.printx.pw/requests'
const FALLBACK_FROM = 'PrintX <onboarding@resend.dev>'

export type NotifyPayload = {
  subject: string
  replyTo: string
  text: string
  html?: string
  /** Portal page where this item also appears */
  portalPath?: 'messages' | 'requests'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function notifyConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

/** Always includes hello@printx.pw; PRINTX_NOTIFY_EMAIL can add more (comma-separated). */
function notifyRecipients(): string[] {
  const recipients = new Set<string>([DEFAULT_NOTIFY])
  const extra = process.env.PRINTX_NOTIFY_EMAIL?.trim()
  if (extra) {
    for (const part of extra.split(/[,;]/)) {
      const email = part.trim().toLowerCase()
      if (email.includes('@')) recipients.add(email)
    }
  }
  return [...recipients]
}

function portalUrlFor(path: 'messages' | 'requests' = 'messages'): string {
  return path === 'requests' ? PORTAL_REQUESTS : PORTAL_MESSAGES
}

function withPortalFooter(text: string, portalPath: 'messages' | 'requests'): string {
  const url = portalUrlFor(portalPath)
  return [
    text,
    ``,
    `---`,
    `Also saved in the PrintX portal (fallback if email fails):`,
    url,
  ].join('\n')
}

function withPortalHtmlFooter(html: string, portalPath: 'messages' | 'requests'): string {
  const url = portalUrlFor(portalPath)
  return `${html}
    <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">
      Also saved in the <a href="${url}">PrintX portal</a> — use this if email delivery fails.
    </p>`
}

async function postResendEmail(input: {
  apiKey: string
  from: string
  to: string[]
  payload: NotifyPayload
}): Promise<{ ok: boolean; status: number; detail: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      reply_to: input.payload.replyTo,
      subject: input.payload.subject,
      text: input.payload.text,
      html: input.payload.html,
    }),
  })
  const detail = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, detail }
}

export async function sendInboxNotification(payload: NotifyPayload): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const to = notifyRecipients()
  const preferredFrom =
    process.env.PRINTX_MAIL_FROM?.trim() || `PrintX <${DEFAULT_NOTIFY}>`
  const portalPath = payload.portalPath ?? 'messages'

  const enriched: NotifyPayload = {
    ...payload,
    text: withPortalFooter(payload.text, portalPath),
    html: payload.html ? withPortalHtmlFooter(payload.html, portalPath) : undefined,
  }

  if (!apiKey) {
    console.warn(
      `[printx] RESEND_API_KEY not set — message kept in portal only (${portalUrlFor(portalPath)})`,
    )
    return { sent: false }
  }

  try {
    let result = await postResendEmail({ apiKey, from: preferredFrom, to, payload: enriched })

    // Unverified domain / bad From → retry with Resend's shared sender
    if (!result.ok && preferredFrom !== FALLBACK_FROM) {
      console.warn(
        `[printx] Resend rejected From "${preferredFrom}" (${result.status}). Retrying with ${FALLBACK_FROM}`,
      )
      result = await postResendEmail({ apiKey, from: FALLBACK_FROM, to, payload: enriched })
    }

    if (!result.ok) {
      console.error(
        `[printx] Resend email failed (${result.status}) — open portal: ${portalUrlFor(portalPath)}`,
        result.detail.slice(0, 500),
      )
      return { sent: false }
    }

    console.log(`[printx] Email sent to ${to.join(', ')}`)
    return { sent: true }
  } catch (err) {
    console.error(
      `[printx] Resend email error — open portal: ${portalUrlFor(portalPath)}`,
      err,
    )
    return { sent: false }
  }
}

export async function notifyContactMessage(input: {
  name: string
  email: string
  inquiryType: string
  message: string
}): Promise<void> {
  const subject = `[PrintX] ${input.inquiryType || 'Contact'}: ${input.name}`
  const text = [
    `New message from the PrintX website`,
    ``,
    `Type: ${input.inquiryType}`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    ``,
    input.message,
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0b1220">
      <p><strong>New message from the PrintX website</strong></p>
      <p>
        <strong>Type:</strong> ${escapeHtml(input.inquiryType)}<br/>
        <strong>Name:</strong> ${escapeHtml(input.name)}<br/>
        <strong>Email:</strong> <a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a>
      </p>
      <p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>
    </div>
  `

  await sendInboxNotification({
    subject,
    replyTo: input.email,
    text,
    html,
    portalPath: 'messages',
  })
}

export async function notifyCustomRequest(input: {
  name: string
  email: string
  school: string
  description: string
  size: string
}): Promise<void> {
  const subject = `[PrintX] Custom print request: ${input.name}`
  const text = [
    `New custom print request`,
    ``,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `School: ${input.school || '(not given)'}`,
    `Size: ${input.size || '(not given)'}`,
    ``,
    input.description,
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0b1220">
      <p><strong>New custom print request</strong></p>
      <p>
        <strong>Name:</strong> ${escapeHtml(input.name)}<br/>
        <strong>Email:</strong> <a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a><br/>
        <strong>School:</strong> ${escapeHtml(input.school || '(not given)')}<br/>
        <strong>Size:</strong> ${escapeHtml(input.size || '(not given)')}<br/>
      </p>
      <p style="white-space:pre-wrap">${escapeHtml(input.description)}</p>
    </div>
  `

  await sendInboxNotification({
    subject,
    replyTo: input.email,
    text,
    html,
    portalPath: 'requests',
  })
}
