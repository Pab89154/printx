/** Carrier tracking deep-links (kept separate so catalog does not import customer routes). */
export function upsTrackUrl(trackingNumber: string): string {
  const t = trackingNumber.trim()
  if (!t) return ''
  return `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`
}
