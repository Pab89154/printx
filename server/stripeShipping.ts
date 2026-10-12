import type Stripe from 'stripe'

/** Flat US shipping options for PrintX Checkout (pay UPS at the counter later). */

export const SHIP_FROM_POSTAL = '75072'

const STANDARD_CENTS = Number(process.env.PRINTX_SHIP_STANDARD_CENTS || 599)
const PRIORITY_CENTS = Number(process.env.PRINTX_SHIP_PRIORITY_CENTS || 1199)
const EXPRESS_CENTS = Number(process.env.PRINTX_SHIP_EXPRESS_CENTS || 1999)

function cents(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback
}

/**
 * Save card on the Stripe Customer after a successful Checkout payment,
 * and let Checkout show previously saved methods on the next buy.
 */
export function stripeAccountSavedPaymentFields(): Pick<
  Stripe.Checkout.SessionCreateParams,
  'payment_intent_data' | 'saved_payment_method_options'
> {
  return {
    payment_intent_data: {
      setup_future_usage: 'off_session',
    },
    saved_payment_method_options: {
      payment_method_save: 'enabled',
      payment_method_remove: 'enabled',
      allow_redisplay_filters: ['always', 'limited', 'unspecified'],
    },
  }
}

/** Fields to merge into checkout.sessions.create for shipping + name collection. */
export function stripeCheckoutShippingFields(): Pick<
  Stripe.Checkout.SessionCreateParams,
  | 'shipping_address_collection'
  | 'shipping_options'
  | 'billing_address_collection'
  | 'customer_update'
> {
  return {
    // Always collect a billing address so we have a street even if ship-to is missing in API.
    billing_address_collection: 'required',
    // Checkout always passes an existing Stripe Customer (signed-in account).
    customer_update: {
      name: 'auto',
      address: 'auto',
      shipping: 'auto',
    },
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

function summarizeAddress(addr: AddrLike): Record<string, string> | null {
  if (!addressHasStreet(addr)) return null
  return {
    line1: trimStr(addr?.line1),
    line2: trimStr(addr?.line2),
    city: trimStr(addr?.city),
    state: trimStr(addr?.state),
    postal_code: trimStr(addr?.postal_code),
    country: trimStr(addr?.country),
  }
}

/** Prefer the first address that includes a street/city/postal. */
function pickAddress(...candidates: AddrLike[]): AddrLike {
  for (const addr of candidates) {
    if (addressHasStreet(addr)) return addr
  }
  return candidates.find((a) => a) || null
}

function asPlain<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

/**
 * Stripe API 2025+ stores ship-to under collected_information.shipping_details.
 * Older payloads used top-level shipping_details. After pay, address may also appear on
 * PaymentIntent.shipping, Charge.shipping, customer.shipping, or billing_details.
 */
function sessionShippingDetails(session: Stripe.Checkout.Session): ShippingDetailsLike {
  const raw = asPlain(session) as Stripe.Checkout.Session & {
    collected_information?: { shipping_details?: ShippingDetailsLike } | null
    shipping_details?: ShippingDetailsLike
  }
  return raw.collected_information?.shipping_details || raw.shipping_details || null
}

function paymentMethodBillingAddress(
  paymentIntent: Stripe.PaymentIntent | null | undefined,
): AddrLike {
  const pm = paymentIntent?.payment_method
  if (pm && typeof pm === 'object' && 'billing_details' in pm) {
    return (pm.billing_details?.address as AddrLike) ?? null
  }
  return null
}

function chargeBillingAddress(paymentIntent: Stripe.PaymentIntent | null | undefined): AddrLike {
  const charge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge
      : null
  if (charge && 'billing_details' in charge) {
    return (charge.billing_details?.address as AddrLike) ?? null
  }
  return null
}

function chargeShippingDetails(
  paymentIntent: Stripe.PaymentIntent | null | undefined,
): ShippingDetailsLike {
  const charge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge
      : null
  if (charge && 'shipping' in charge) {
    return (charge.shipping as ShippingDetailsLike) ?? null
  }
  return null
}

function customerShippingDetails(customer: Stripe.Customer | null | undefined): ShippingDetailsLike {
  if (!customer || customer.deleted) return null
  return (customer.shipping as ShippingDetailsLike) ?? null
}

/** Walk a Stripe object for the first hash that looks like a street address. */
function findAddressDeep(value: unknown, depth = 0): AddrLike {
  if (value == null || depth > 8) return null
  if (typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAddressDeep(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.line1 === 'string' && obj.line1.trim()) {
    return obj as AddrLike
  }
  for (const nested of Object.values(obj)) {
    const found = findAddressDeep(nested, depth + 1)
    if (found) return found
  }
  return null
}

export type ShippingSourceProbe = {
  collectedShipping: ReturnType<typeof summarizeAddress>
  collectedName: string
  piShipping: ReturnType<typeof summarizeAddress>
  piShippingName: string
  chargeShipping: ReturnType<typeof summarizeAddress>
  chargeBilling: ReturnType<typeof summarizeAddress>
  customerDetails: ReturnType<typeof summarizeAddress>
  paymentMethodBilling: ReturnType<typeof summarizeAddress>
  customerShipping: ReturnType<typeof summarizeAddress>
  deepFound: ReturnType<typeof summarizeAddress>
  sessionStatus: string | null
  hasCollectedInformation: boolean
  shippingCostCents: number | null
}

export function probeCheckoutShippingSources(
  session: Stripe.Checkout.Session,
  paymentIntent?: Stripe.PaymentIntent | null,
  customer?: Stripe.Customer | null,
): ShippingSourceProbe {
  const plainSession = asPlain(session)
  const plainPi = paymentIntent ? asPlain(paymentIntent) : null
  const details = sessionShippingDetails(plainSession)
  const piShipping = plainPi?.shipping ?? null
  const chargeShip = chargeShippingDetails(plainPi)
  const custShip = customerShippingDetails(customer)

  return {
    collectedShipping: summarizeAddress(details?.address ?? null),
    collectedName: trimStr(details?.name),
    piShipping: summarizeAddress(piShipping?.address ?? null),
    piShippingName: trimStr(piShipping?.name),
    chargeShipping: summarizeAddress(chargeShip?.address ?? null),
    chargeBilling: summarizeAddress(chargeBillingAddress(plainPi)),
    customerDetails: summarizeAddress(plainSession.customer_details?.address ?? null),
    paymentMethodBilling: summarizeAddress(paymentMethodBillingAddress(plainPi)),
    customerShipping: summarizeAddress(custShip?.address ?? null),
    deepFound: summarizeAddress(findAddressDeep({ session: plainSession, paymentIntent: plainPi, customer })),
    sessionStatus: plainSession.status ?? null,
    hasCollectedInformation: Boolean(
      (plainSession as { collected_information?: unknown }).collected_information,
    ),
    shippingCostCents: plainSession.shipping_cost?.amount_total ?? null,
  }
}

/** Pull email, ship-to name/address, and chosen shipping rate from a completed Checkout Session. */
export function parseCheckoutShipping(
  session: Stripe.Checkout.Session,
  paymentIntent?: Stripe.PaymentIntent | null,
  customer?: Stripe.Customer | null,
): ParsedCheckoutShipping {
  const plainSession = asPlain(session)
  const plainPi = paymentIntent ? asPlain(paymentIntent) : null
  const details = sessionShippingDetails(plainSession)
  const piShipping = plainPi?.shipping ?? null
  const chargeShip = chargeShippingDetails(plainPi)
  const custShip = customerShippingDetails(customer)

  const addr = pickAddress(
    details?.address ?? null,
    piShipping?.address ?? null,
    chargeShip?.address ?? null,
    custShip?.address ?? null,
    plainSession.customer_details?.address ?? null,
    paymentMethodBillingAddress(plainPi),
    chargeBillingAddress(plainPi),
    findAddressDeep({ session: plainSession, paymentIntent: plainPi, customer }),
  )

  const shippingName =
    trimStr(details?.name) ||
    trimStr(piShipping?.name) ||
    trimStr(chargeShip?.name) ||
    trimStr(custShip?.name) ||
    ''

  const customerEmail =
    trimStr(plainSession.customer_details?.email) || trimStr(plainSession.customer_email) || ''
  const customerName =
    shippingName || trimStr(plainSession.customer_details?.name) || ''

  const shippingUsd =
    plainSession.shipping_cost?.amount_total != null
      ? Math.round(plainSession.shipping_cost.amount_total) / 100
      : 0

  let shippingMethod = ''
  const rate = plainSession.shipping_cost?.shipping_rate
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
    plainSession.amount_total != null ? Math.round(plainSession.amount_total) / 100 : null

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

async function retrievePaymentIntent(
  stripe: Stripe,
  paymentIntentRef: string | Stripe.PaymentIntent | null | undefined,
): Promise<Stripe.PaymentIntent | null> {
  if (!paymentIntentRef) return null
  if (typeof paymentIntentRef === 'object') {
    // Re-fetch with expands so billing/shipping nested objects are present.
    try {
      return await stripe.paymentIntents.retrieve(paymentIntentRef.id, {
        expand: ['latest_charge', 'payment_method'],
      })
    } catch {
      return paymentIntentRef
    }
  }
  return stripe.paymentIntents.retrieve(paymentIntentRef, {
    expand: ['latest_charge', 'payment_method'],
  })
}

async function retrieveCustomer(
  stripe: Stripe,
  customerRef: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): Promise<Stripe.Customer | null> {
  if (!customerRef) return null
  if (typeof customerRef === 'object') {
    if ('deleted' in customerRef && customerRef.deleted) return null
    return customerRef as Stripe.Customer
  }
  try {
    const customer = await stripe.customers.retrieve(customerRef)
    if (customer.deleted) return null
    return customer
  } catch {
    return null
  }
}

/** Retrieve session + PaymentIntent (+ customer) and parse ship-to from every Stripe location. */
export async function loadCheckoutShipping(
  stripe: Stripe,
  sessionId: string,
): Promise<{
  ship: ParsedCheckoutShipping
  session: Stripe.Checkout.Session
  paymentIntent: Stripe.PaymentIntent | null
  customer: Stripe.Customer | null
  probe: ShippingSourceProbe
}> {
  // Avoid nested expands (they can fail silently on some accounts); fetch related objects next.
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const paymentIntent = await retrievePaymentIntent(stripe, session.payment_intent)
  const customer = await retrieveCustomer(stripe, session.customer)

  // Legacy API shape: some Dashboard views still mirror top-level shipping_details.
  let legacyShip: ParsedCheckoutShipping | null = null
  try {
    const legacy = await stripe.checkout.sessions.retrieve(
      sessionId,
      {},
      // Older version that still exposes top-level shipping_details.
      { apiVersion: '2024-06-20' as Stripe.StripeConfig['apiVersion'] },
    )
    legacyShip = parseCheckoutShipping(legacy, paymentIntent, customer)
  } catch {
    legacyShip = null
  }

  let ship = parseCheckoutShipping(session, paymentIntent, customer)
  if (!ship.shippingLine1 && !ship.shippingCity && !ship.shippingPostal && legacyShip) {
    if (legacyShip.shippingLine1 || legacyShip.shippingCity || legacyShip.shippingPostal) {
      ship = {
        ...ship,
        shippingName: ship.shippingName || legacyShip.shippingName,
        shippingLine1: legacyShip.shippingLine1,
        shippingLine2: legacyShip.shippingLine2,
        shippingCity: legacyShip.shippingCity,
        shippingState: legacyShip.shippingState,
        shippingPostal: legacyShip.shippingPostal,
        shippingCountry: legacyShip.shippingCountry || ship.shippingCountry,
      }
    }
  }

  const probe = probeCheckoutShippingSources(session, paymentIntent, customer)
  return { ship, session, paymentIntent, customer, probe }
}
