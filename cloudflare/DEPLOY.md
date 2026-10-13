# Deploy PrintX on Cloudflare (free)

No domain transfer. DNS for `printx.pw` already lives on Cloudflare. This replaces the Render origin.

## One-time setup

1. Install deps: `npm ci`
2. Copy secrets from Render → Environment into Workers (Dashboard or CLI).
3. Create Hyperdrive (free) for Postgres:

```bash
npx wrangler login
npx wrangler hyperdrive create printx-db --connection-string="$DATABASE_URL"
```

Paste the Hyperdrive `id` into [`wrangler.toml`](../wrangler.toml) under `[[hyperdrive]]`.

4. Set secrets (repeat for each):

```bash
npx wrangler secret put DATABASE_URL   # session pooler URI (fallback if no Hyperdrive)
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put PRINTX_SESSION_SECRET
npx wrangler secret put PRINTX_ADMIN_PASSWORD
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put PRINTX_GITHUB_TOKEN   # PAT with Actions:write for Prepare G-code
```

5. GitHub repo secrets for the slicer workflow: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

6. Deploy:

```bash
npm run cf:deploy
```

7. Workers → **printx** → **Settings** → **Domains** → add `printx.pw` and `portal.printx.pw`.

8. DNS: point `@` and `portal` to the Worker (Cloudflare will offer the correct records). Remove any CNAME that still targets `*.onrender.com`.

9. Retire `printx-wake` (no longer needed — the app itself does not sleep).

10. Delete the Render web service when health checks pass on Cloudflare.

## G-code

Download never slices on the Worker. Use **Designs → Prepare G-code · P1S** (GitHub Actions) or run:

```bash
PRINTX_DESIGN_ID=… PRINTX_PRINTER_ID=pablo_p1s npx tsx scripts/prepare-gcode-ci.ts
```
