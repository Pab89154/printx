# Replace Render’s ugly loading screen (keep one Web Service)

You still use **one Render Web Service**.  
A free tiny helper on **Cloudflare** sits in front and shows the PrintX screen while Render wakes up.

Ask a parent/guardian to help with accounts and DNS if you need to.

---

## Easy steps

### 1) Keep PrintX on Render (Web Service)
- Your app stays as the **printx** Web Service (not a Static Site).
- Custom domains can stay on that service: `printx.pw` and `portal.printx.pw`.

### 2) Put the domain on Cloudflare (free)
1. Make a free account at [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. **Add a site** → enter `printx.pw`
3. Cloudflare will show DNS records to copy at your domain place
4. Turn the cloud **orange** (proxied) for the records that point to Render  
   (the ones for `printx.pw` and `portal`)

### 3) Create the Worker
1. In Cloudflare: **Workers & Pages** → **Create** → **Worker**
2. Name it something like `printx-wake`
3. Paste the code from `worker.js` in this folder (or deploy with Wrangler from this folder)
4. **Settings → Variables**
   - Name: `ORIGIN`
   - Value: your Render URL, like `https://printx.onrender.com`  
     (Dashboard → printx service → the `*.onrender.com` link)

### 4) Connect the Worker to your sites
1. Worker → **Triggers** / **Routes**
2. Add:
   - `printx.pw/*`
   - `portal.printx.pw/*`
3. Save

### 5) Test
1. Leave the site alone for **15+ minutes**
2. Open `https://printx.pw`
3. You should see **PrintX** loading (not the Render spinner)
4. Then the real site appears

---

## If something’s wrong

| Problem | Try this |
|--------|----------|
| Still see Render spinner | Cloudflare proxy not orange, or Worker route missing |
| Loading forever | `ORIGIN` wrong — must be the `*.onrender.com` URL |
| Login broken | On Render, set env `PRINTX_COOKIE_DOMAIN` = `.printx.pw` |

---

## Deploy from this folder (optional, for grown-ups)

```bash
cd cloudflare
npx wrangler login
npx wrangler deploy
```

Then set routes in the Cloudflare dashboard as in step 4.
