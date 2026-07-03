# Arnold FatSecret proxy

A tiny zero-dependency Node server that lets Arnold use the **FatSecret Platform API**
as its primary food database (Open Food Facts stays as the automatic fallback).

## Why this is separate from the Cloudflare sync worker

FatSecret's free / Premier-Free tier authorizes API calls **only from whitelisted IP
addresses** (up to 15, or CIDR ranges), and the OAuth2 token must be requested
server-side. **Cloudflare Workers egress from a large rotating IP pool and cannot be
whitelisted**, so this piece has to run somewhere with **one fixed outbound IP**.

## What you need to do (one-time)

1. **Get OAuth2 credentials.** In your FatSecret Platform account → *Manage API Keys* →
   create/locate your **OAuth 2.0 Client ID + Client Secret**. (Keep the secret private —
   it only ever lives on the host below, never in the app.)

2. **Pick a static-IP host** and deploy `server.js`. Any of:
   - **Fly.io** with a **dedicated IPv4** (`fly ips allocate-v4`),
   - a small **VPS** (DigitalOcean / Hetzner / Lightsail — ~$4–6/mo),
   - **Render** / **Railway** with a static-egress add-on.

   Node 18+ only (uses global `fetch`). Start it with:
   ```bash
   FATSECRET_CLIENT_ID=xxx \
   FATSECRET_CLIENT_SECRET=yyy \
   FATSECRET_SCOPE=basic \
   PORT=8787 \
   node server.js
   ```
   Set the env vars via your host's secrets UI — **do not** hard-code them.

3. **Whitelist the host's outbound IP** in the FatSecret dashboard → *IP Restrictions*.
   (Fly: the dedicated IPv4 you allocated. VPS: its public IP.) Verify with `curl https://<host>/health` → `{"ok":true,...}`.

4. **Point Arnold at it.** In the app console (or a Settings field once added):
   ```js
   import { setFatSecretEndpoint } from './core/fatsecret-client.js';
   setFatSecretEndpoint('https://your-proxy-host');   // no trailing slash
   ```
   Stored in `localStorage['arnold:fatsecret-endpoint']`. Once set,
   `searchFood()` / `lookupBarcode()` use FatSecret first and fall back to Open Food
   Facts on any miss or error.

## Routes (all GET, JSON passthrough — mapping happens in `fatsecret-client.js`)

| Route | Purpose | FatSecret method |
|---|---|---|
| `/health` | liveness + active scope | — |
| `/fatsecret/search?q=&page=` | text search | `foods.search.v3` |
| `/fatsecret/food?id=` | full food + servings | `food.get.v4` |
| `/fatsecret/barcode?code=` | GTIN lookup | `food.find_id_for_barcode.v2` (+ chained `food.get` if id-only) |

## Notes & gotchas

- **Barcode is a Premier feature.** On the free `basic` scope, `/fatsecret/barcode`
  may return not-found / unauthorized; the app already falls back to Open Food Facts
  for barcodes, so scanning still works regardless.
- **Token caching** is in-memory (one token per process, refreshed ~60s before expiry).
  Restarting the host re-fetches a token — fine.
- **Rate limits**: the free tier's exact limits aren't published; check your dashboard.
  The app caches nothing yet, so keep searches user-initiated.
- **CORS** is open (`ALLOW_ORIGIN=*`) because the responses are non-sensitive food data
  and the request carries no user credentials. Narrow it to the app origin if you prefer.
- **Security**: the proxy only ever sends `format=json` + your method params to FatSecret;
  it never accepts a method name from the caller, so the routes can't be used to call
  arbitrary FatSecret endpoints.
