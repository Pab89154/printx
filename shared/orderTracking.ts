/** Public 6-digit track codes + shipping business-day ETAs for PrintX orders. */

/** Zero-padded 6-digit code string. */
export function formatTrackCode(n: number): string {
  return String(Math.max(0, Math.min(999_999, Math.floor(n)))).padStart(6, '0')
}

export function normalizeTrackCode(raw: unknown): string {
  const digits = String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 6)
  if (digits.length !== 6) return ''
  return digits
}

/** Max business days until "arrived" from shipped_at, by Stripe shipping_method. */
export function businessDaysForShippingMethod(method: string | null | undefined): number {
  const m = String(method || '')
    .trim()
    .toLowerCase()
  if (m.includes('express')) return 2
  if (m.includes('priority')) return 4
  return 9
}

/** Add N business days (Mon–Fri) to a UTC/ISO date. */
export function addBusinessDays(fromIso: string, businessDays: number): Date {
  const start = new Date(fromIso)
  if (!Number.isFinite(start.getTime())) return new Date(NaN)
  const d = new Date(start.getTime())
  let left = Math.max(0, Math.floor(businessDays))
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const day = d.getUTCDay() // 0 Sun … 6 Sat
    if (day !== 0 && day !== 6) left -= 1
  }
  return d
}

export function hasBusinessDaysElapsed(
  shippedAtIso: string | null | undefined,
  shippingMethod: string | null | undefined,
  now = new Date(),
): boolean {
  if (!shippedAtIso) return false
  const eta = addBusinessDays(shippedAtIso, businessDaysForShippingMethod(shippingMethod))
  if (!Number.isFinite(eta.getTime())) return false
  return now.getTime() >= eta.getTime()
}

export function arrivedEtaIso(
  shippedAtIso: string | null | undefined,
  shippingMethod: string | null | undefined,
): string | null {
  if (!shippedAtIso) return null
  const eta = addBusinessDays(shippedAtIso, businessDaysForShippingMethod(shippingMethod))
  if (!Number.isFinite(eta.getTime())) return null
  return eta.toISOString()
}

/** Customer-facing status labels for track portal. */
export function publicOrderStatusLabel(status: string): string {
  switch (status) {
    case 'pending_payment':
      return 'Awaiting payment'
    case 'paid':
      return 'Paid — waiting to print'
    case 'in_production':
      return 'Printing'
    case 'printed':
      return 'Printed'
    case 'shipped':
      return 'Shipped'
    case 'arrived':
    case 'fulfilled':
      return 'Arrived'
    case 'cancelled':
      return 'Cancelled'
    case 'refunded':
      return 'Refunded'
    case 'ready':
      return 'Ready'
    default:
      return status.replace(/_/g, ' ')
  }
}

export function publicPrintStatusLabel(status: string): string {
  switch (status) {
    case 'unclaimed':
      return 'Queued'
    case 'claimed':
    case 'printing':
      return 'Printing'
    case 'printed':
    case 'done':
      return 'Printed'
    default:
      return status
  }
}
