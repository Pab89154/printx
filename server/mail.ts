/**
 * Notify hello@printx.pw (or PRINTX_NOTIFY_EMAIL) via Resend.
 * Requires RESEND_API_KEY. Domain printx.pw must be verified in Resend
 * before From: hello@printx.pw works in production.
 */

export type NotifyPayload = {
  subject: string
  replyTo: string
  text: string
  html?: string
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

export async function sendInboxNotification(payload: NotifyPayload): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const to = process.env.PRINTX_NOTIFY_EMAIL?.trim() || 'hello@printx.pw'
  const from =
    process.env.PRINTX_MAIL_FROM?.trim() || 'PrintX <hello@printx.pw>'

  if (!apiKey) {
    console.warn('[printx] RESEND_API_KEY not set — message saved, email not sent')
    return { sent: false }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: payload.replyTo,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[printx] Resend email failed:', res.status, detail.slice(0, 500))
      return { sent: false }
    }

    return { sent: true }
  } catch (err) {
    console.error('[printx] Resend email error:', err)
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
        <strong>Size:</strong> ${escapeHtml(input.size || '(not given)')}
br/>
      </p>
      <p style="white-space:pre-wrap">${escapeHtml(input.description)}</p>
    </div>
  `

  await sendInboxNotification({
    subject,
    replyTo: input.email,
    text,
    html,
  })
}
