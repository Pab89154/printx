import type Stripe from 'stripe'

/** Flat US shipping options for PrintX Checkout (pay UPS at the counter later). */

export const SHIP_FROM_POSTAL = '75072'

const STANDARD_CENTS = Number(process.env.PRINTX_SHIP_STANDARD_CENTS || 599)
const PRIORITY_CENTS = Number(process.env.PRINTX_SHIP_PRIORITY_CENTS || 1199)
const EXPRESS_CENTS = Number(process.env.PRINTX_SHIP_EXPRESS_CENTS || 1999)

function cents(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback
}

/** Fields to merge into checkout.sessions.create for shipping + name collection. */
export function stripeCheckoutShippingFields(): Pick<
  Stripe.Checkout.SessionCreateParams,
  'shipping_address_collection' | 'shipping_options' | 'billing_address_collection'
> {
  return {
    billing_address_collection: 'auto',
    shipping_address_collection: {
      allowed_countries: ['US'],
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: cents(STANDARD_CENTS, 599), currency: 'usd' },
          display_name: 'Standard',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 5 },
            maximum: { unit: 'business_day', value: 9 },
          },
        },
      },
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: cents(PRIORITY_CENTS, 1199), currency: 'usd' },
          display_name: 'Priority',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 4 },
          },
        },
      },
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: cents(EXPRESS_CENTS, 1999), currency: 'usd' },
          display_name: 'Express',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 1 },
            maximum: { unit: 'business_day', value: 2 },
          },
        },
      },
    ],
  }
}

export type ParsedCheckoutShipping = {
  shippingName: string
  shippingLine1: string
  shippingLine2: string
  shippingCity: string
  shippingState: string
  shippingPostal: string
  shippingCountry: string
  shippingMethod: string
  shippingUsd: number
  customerName: string
  customerEmail: string
  amountTotalUsd: number | null
}

type AddrLike = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
} | null

type ShippingDetailsLike = {
  name?: string | null
  address?: AddrLike
} | null

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function addressHasStreet(addr: AddrLike): boolean {
  return Boolean(trimStr(addr?.line1) || trimStr(addr?.city) || trimStr(addr?.postal_code))
}

/** Prefer the first address that includes a street/city/postal. */
function pickAddress(...candidates: AddrLike[]): AddrLike {
  for (const addr of candidates) {
    if (addressHasStreet(addr)) return addr
  }
  return candidates.find((a) => a) || null
}

/**
 * Stripe API 2025+ stores ship-to under collected_information.shipping_details.
 * Older payloads used top-level shipping_details. After pay, address is also copied
 * onto PaymentIntent.shipping / Charge.shipping.
 */
function sessionShippingDetails(session: Stripe.Checkout.Session): ShippingDetailsLike {
  const raw = session as Stripe.Checkout.Session & {
    collected_information?: { shipping_details?: ShippingDetailsLike } | null
    shipping_details?: ShippingDetailsLike
  }
  return raw.collected_information?.shipping_details || raw.shipping_details || null
}

/** Pull email, ship-to name/address, and chosen shipping rate from a completed Checkout Session. */
export function parseCheckoutShipping(
  session: Stripe.Checkout.Session,
  paymentIntent?: Stripe.PaymentIntent | null,
): ParsedCheckoutShipping {
  const details = sessionShippingDetails(session)
  const piShipping = paymentIntent?.shipping ?? null
  const charge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge
      : null
  const chargeShipping = charge && 'shipping' in charge ? (charge.shipping as ShippingDetailsLike) : null

  const addr = pickAddress(
    details?.address ?? null,
    piShipping?.address ?? null,
    chargeShipping?.address ?? null,
    // Last resort: customer_details.address (often matches ship-to when shipping was collected).
    session.customer_details?.address ?? null,
  )

  const shippingName =
    trimStr(details?.name) ||
    trimStr(piShipping?.name) ||
    trimStr(chargeShipping?.name) ||
    ''

  const customerEmail =
    trimStr(session.customer_details?.email) || trimStr(session.customer_email) || ''
  const customerName =
    shippingName || trimStr(session.customer_details?.name) || ''

  const shippingUsd =
    session.shipping_cost?.amount_total != null
      ? Math.round(session.shipping_cost.amount_total) / 100
      : 0

  let shippingMethod = ''
  const rate = session.shipping_cost?.shipping_rate
  if (rate && typeof rate === 'object' && 'display_name' in rate) {
    shippingMethod = String((rate as Stripe.ShippingRate).display_name || '')
  }
  if (!shippingMethod) {
    const centsPaid = Math.round(shippingUsd * 100)
    if (centsPaid === cents(STANDARD_CENTS, 599)) shippingMethod = 'Standard'
    else if (centsPaid === cents(PRIORITY_CENTS, 1199)) shippingMethod = 'Priority'
    else if (centsPaid === cents(EXPRESS_CENTS, 1999)) shippingMethod = 'Express'
    else if (shippingUsd > 0) shippingMethod = 'Shipping'
  }

  const amountTotalUsd =
    session.amount_total != null ? Math.round(session.amount_total) / 100 : null

  return {
    shippingName,
    shippingLine1: trimStr(addr?.line1),
    shippingLine2: trimStr(addr?.line2),
    shippingCity: trimStr(addr?.city),
    shippingState: trimStr(addr?.state),
    shippingPostal: trimStr(addr?.postal_code),
    shippingCountry: trimStr(addr?.country),
    shippingMethod,
    shippingUsd,
    customerName,
    customerEmail,
    amountTotalUsd,
  }
}

/** Resolve display name when webhook only has a shipping_rate id. */
export async function resolveShippingMethodName(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  fallback: string,
): Promise<string> {
  if (fallback && fallback !== 'Shipping') return fallback
  const rate = session.shipping_cost?.shipping_rate
  if (typeof rate !== 'string' || !rate) return fallback
  try {
    const retrieved = await stripe.shippingRates.retrieve(rate)
    return retrieved.display_name?.trim() || fallback
  } catch {
    return fallback
  }
}

/** Retrieve session + PaymentIntent and parse ship-to from every Stripe location. */
export async function loadCheckoutShipping(
  stripe: Stripe,
  sessionId: string,
): Promise<{ ship: ParsedCheckoutShipping; session: Stripe.Checkout.Session }> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent', 'payment_intent.latest_charge'],
  })
  let paymentIntent: Stripe.PaymentIntent | null = null
  if (session.payment_intent && typeof session.payment_intent === 'object') {
    paymentIntent = session.payment_intent
  } else if (typeof session.payment_intent === 'string' && session.payment_intent) {
    paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent, {
      expand: ['latest_charge'],
    })
  }
  return { ship: parseCheckoutShipping(session, paymentIntent), session }
}
