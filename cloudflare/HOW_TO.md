# Fix the Render “APPLICATION LOADING” screen

You already put `printx.pw` on Cloudflare (good — the orange cloud works).  
The missing piece is connecting the **Worker** so it answers first and shows the PrintX loading screen.

Ask a parent/guardian to help if you need to.

---

## What you should see when it’s fixed

1. Leave the site alone for **15+ minutes** (so Render goes to sleep).
2. Open `https://printx.pw`
3. You see a **dark PrintX** page (“Getting everything ready…”) — **not** the green Render terminal.
4. After ~30–60 seconds the real site appears.

If you still see **WELCOME TO RENDER / APPLICATION LOADING**, the Worker is not connected yet.

---

## Do these 3 things in Cloudflare

### 1) Create (or open) the Worker
1. Go to [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
2. **Create** → **Worker** (plain Worker — not Pages, not a Vite template)
3. Name it `printx-wake`
4. Open the editor and **replace all code** with the file `worker.js` from this folder
5. **Deploy** / **Save and deploy**

### 2) Set `ORIGIN` (very important)
1. Worker → **Settings** → **Variables and Secrets**
2. Add variable:
   - Name: `ORIGIN`
   - Value: your Render link that ends in `.onrender.com`

**Where to copy that link**
1. Open the Render tab: **PrintX • Web Service**
2. At the top, copy the URL that looks like  
   `https://something.onrender.com`  
   (not `https://printx.pw`)

Paste that whole `https://….onrender.com` URL as `ORIGIN` (no slash at the end).

> `https://printx.onrender.com` is usually **wrong**. Always copy the real one from Render.

### 3) Attach the Worker to your domain
1. Still on the Worker → **Settings** → **Domains & Routes** (or **Triggers** → **Routes**)
2. **Add** these routes (zone = `printx.pw`):
   - `printx.pw/*`
   - `portal.printx.pw/*`
3. Save

Also check **DNS** for `printx.pw` and `portal`:
- Cloud icon must be **orange** (Proxied), not gray.

---

## Quick test (no waiting 15 minutes)

1. Open your Worker → **Send** / preview, or visit `https://printx.pw`
2. In DevTools → Network, the HTML response should **not** say Render’s “APPLICATION LOADING”
3. Or: after deploy, open an private/incognito window to `https://printx.pw` — if Render is asleep you should see PrintX branding first

---

## If something’s wrong

| What you see | Fix |
|--------------|-----|
| Still green Render loading screen | Routes missing (`printx.pw/*`) or DNS cloud is gray |
| PrintX loading forever | `ORIGIN` wrong — must be the real `*.onrender.com` from Render |
| Site broken / Not Found | Same — fix `ORIGIN` |
| Login cookies weird | On Render → Environment: `PRINTX_COOKIE_DOMAIN` = `.printx.pw` |

---

## Optional: deploy from this folder (grown-up)

```bash
cd cloudflare
npx wrangler login
npx wrangler deploy
```

Then set `ORIGIN` and the two routes in the Cloudflare dashboard (steps 2–3 above).
