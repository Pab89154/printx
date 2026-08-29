/** Build a mailto link that opens the user's mail app with To (and optional subject) filled in. */
export function mailtoHref(
  email: string,
  options?: { subject?: string; body?: string },
): string {
  const address = (email || 'hello@printx.pw').replace(/^mailto:/i, '').trim()
  const params = new URLSearchParams()
  if (options?.subject) params.set('subject', options.subject)
  if (options?.body) params.set('body', options.body)
  const query = params.toString()
  return query ? `mailto:${address}?${query}` : `mailto:${address}`
}
