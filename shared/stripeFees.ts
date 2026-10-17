/**
 * Stripe standard US online card fees: 2.9% + $0.30 per successful charge.
 * Applied to the full amount the customer pays (items + shipping).
 */

export const STRIPE_CARD_FEE_RATE = 0.029
export const STRIPE_CARD_FEE_FIXED_USD = 0.3

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Fee Stripe takes from a successful charge of `chargeUsd`. */
export function stripeFeeOnChargeUsd(chargeUsd: number): number {
  const charge = Math.max(0, Number(chargeUsd) || 0)
  if (charge <= 0) return 0
  return roundMoney(charge * STRIPE_CARD_FEE_RATE + STRIPE_CARD_FEE_FIXED_USD)
}

/** What lands in Stripe balance after fees. */
export function stripeNetFromChargeUsd(chargeUsd: number): number {
  const charge = Math.max(0, Number(chargeUsd) || 0)
  return roundMoney(Math.max(0, charge - stripeFeeOnChargeUsd(charge)))
}
