/** Plain-language notices shown before Stripe Checkout or a school cash sale. */

export const STRIPE_TERMS_LABEL = 'I agree to the terms and conditions.'

export const STRIPE_TERMS_BODY = `Name, email, shipping address, and phone are entered on Stripe Checkout. Phone is used so Stripe can save the payment method.

PrintX stores the name, email, address, and order total on the order in its database to print, ship, and show the order. PrintX does not store the card number.

We store this in our database (GitHub and Supabase).

Stripe processes the card and can save the payment method. Stripe’s own terms apply to the card data.

This information is used to complete the order. It is not sold.

This is the notice shown before payment. It is not a lawyer-drafted privacy policy.`

export const CASH_PAYMENT_LABEL = 'I will pay cash.'

export const CASH_TERMS_LABEL = 'I agree to the terms and conditions.'

export const CASH_TERMS_BODY = `Your name and this agreement are stored in the PrintX order database so the sale can be filled and this agreement can be shown later. Card numbers are not collected on this screen. The record is kept for the order and is not sold.

We store this in our database (GitHub and Supabase).

This is a written record of the sale. It is not a lawyer-drafted contract, and it does not decide a court outcome.`

export function stripeAgreementText(): string {
  return `${STRIPE_TERMS_LABEL}\n${STRIPE_TERMS_BODY}`
}

export function cashSaleItemNotice(
  lines: { name: string; color: string; qty: number; lineUsd: number }[],
  totalUsd: number,
): string {
  const items = lines
    .map((l) => `${l.qty}× ${l.name} (${l.color}) $${l.lineUsd.toFixed(2)}`)
    .join('; ')
  return `${items}. Total $${totalUsd.toFixed(2)}. School pickup with no shipping.`
}

export function cashPaymentDetail(itemNotice: string): string {
  const items = itemNotice.trim()
  return `${items ? `${items} ` : ''}Cash is paid before the print is handed over.`
}

export function cashAgreementText(itemNotice: string): string {
  return `${CASH_PAYMENT_LABEL}\n${cashPaymentDetail(itemNotice)}\n\n${CASH_TERMS_LABEL}\n${CASH_TERMS_BODY}`
}
