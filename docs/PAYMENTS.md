# PrintX payments (Stripe)

**Decision:** Stripe is the only payment platform for PrintX. Catalog and custom-print prices live in **Supabase** only. Stripe processes charges; it is not a second product database.

## Architecture

1. PrintX calculates the price (shop catalog or custom Cloud Slicer estimate).
2. The server creates a Stripe Checkout Session with ad-hoc `price_data` (name + amount). Do **not** create Stripe Products/Prices for designs.
3. The customer pays on Stripe Checkout.
4. The webhook `checkout.session.completed` marks the order / custom request paid in Supabase.

Relevant code: `server/catalogApi.ts` (shop), `server/router.ts` (custom prints).

## Do not

- Sync Designs into Stripe Products.
- Migrate the shop to Square (or similar) if the goal is only a simpler card reader — that splits the catalog.
- Run two processors unless Checkout needs an extra wallet method (optional later), still without a second catalog.

## In-person (later, same Stripe account)

1. Start with **Stripe Dashboard app + Tap to Pay** (phone only, enter amount).
2. Add **Reader M2** (~$59) if you need chip/swipe.
3. Integrate **Stripe Terminal** into the admin portal when stands should create PrintX orders automatically (PaymentIntent + same webhooks/orders model).

## Env vars

See `.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional success/cancel URLs.
