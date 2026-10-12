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

/** Pull email, ship-to name/address, and chosen shipping rate from a completed Checkout Session. */
export function parseCheckoutShipping(session: Stripe.Checkout.Session): ParsedCheckoutShipping {
  const details = session.shipping_details
  const addr = details?.address
  const shippingName = details?.name?.trim() || ''
  const customerEmail =
    session.customer_details?.email?.trim() || session.customer_email?.trim() || ''
  const customerName =
    shippingName || session.customer_details?.name?.trim() || ''

  const shippingUsd =
    session.shipping_cost?.amount_total != null
      ? Math.round(session.shipping_cost.amount_total) / 100
      : 0

  let shippingMethod = ''
  const rate = session.shipping_cost?.shipping_rate
  if (rate && typeof rate === 'object' && 'display_name' in rate) {
    shippingMethod = String((rate as Stripe.ShippingRate).display_name || '')
  }
  // Webhook payloads usually only include the rate id — match amount to display names.
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
    shippingLine1: addr?.line1?.trim() || '',
    shippingLine2: addr?.line2?.trim() || '',
    shippingCity: addr?.city?.trim() || '',
    shippingState: addr?.state?.trim() || '',
    shippingPostal: addr?.postal_code?.trim() || '',
    shippingCountry: addr?.country?.trim() || '',
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
