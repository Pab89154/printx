/** Default public inbox — all visitor email CTAs open this address. */
export const PRINTX_CONTACT_EMAIL = 'hello@printx.pw'

/** Build a mailto link that opens the user's mail app with To (and optional subject) filled in. */
export function mailtoHref(
  email: string,
  options?: { subject?: string; body?: string },
): string {
  const address = (email || PRINTX_CONTACT_EMAIL).replace(/^mailto:/i, '').trim()
  const params = new URLSearchParams()
  if (options?.subject) params.set('subject', options.subject)
  if (options?.body) params.set('body', options.body)
  const query = params.toString()
  return query ? `mailto:${address}?${query}` : `mailto:${address}`
}

/** Open the visitor's mail app addressed to PrintX. */
export function openPrintXMailto(
  options?: { subject?: string; body?: string; email?: string },
) {
  const href = mailtoHref(options?.email || PRINTX_CONTACT_EMAIL, {
    subject: options?.subject,
    body: options?.body,
  })
  window.location.href = href
}
