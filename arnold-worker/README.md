# Arnold Cloud Sync Worker

A minimal Cloudflare Worker that relays encrypted Arnold snapshots between
your desktop and mobile instances. The worker never sees plaintext — it's a
bearer-token-gated key/value shuttle. All encryption happens client-side in
Arnold via AES-256-GCM with a PBKDF2-derived key.

## First-time deploy (10 minutes)

1. **Install wrangler (once, globally):**

   ```
   npm i -g wrangler
   ```

2. **Log into Cloudflare:**

   ```
   wrangler login
   ```

   This opens a browser and authorizes the CLI against your free CF account.

3. **Create the KV namespace:**

   ```
   cd arnold-worker
   wrangler kv namespace create arnold-sync
   ```

   Copy the `id` value it prints.

4. **Fill in `wrangler.toml`:**

   - Replace `REPLACE_WITH_ACCOUNT_ID` with your Cloudflare Account ID
     (dashboard sidebar on the Workers & Pages page).
   - Replace `REPLACE_WITH_KV_NAMESPACE_ID` with the id from step 3.

5. **Generate and set the bearer token:**

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Save that token somewhere safe (1Password/Bitwarden). Then:

   ```
   wrangler secret put SYNC_TOKEN
   ```

   Paste the token when prompted.

6. **Deploy:**

   ```
   wrangler deploy
   ```

   Note the URL it prints — something like
   `https://arnold-sync.<your-subdomain>.workers.dev`. That's your sync
   endpoint.

7. **Pair Arnold to the worker:**

   Open Arnold → Settings → Cloud Sync panel, enter:
   - Endpoint URL (from step 6)
   - Bearer token (from step 5)
   - A strong passphrase (this is the encryption key — never leaves your
     devices; store a copy in 1Password/Bitwarden in case you nuke both
     phones at once).

   Repeat on any other device you want to sync (phone app), using the same
   passphrase.

## Verify

```
curl https://arnold-sync.<your-subdomain>.workers.dev/health
# → ok
```

Authenticated probe:

```
curl -H "Authorization: Bearer $SYNC_TOKEN" \
     https://arnold-sync.<your-subdomain>.workers.dev/s/deadbeef00000000000000000000000000000000000000000000000000000000
# → {"error":"not_found"}   (expected — nothing stored yet)
```

## Local dev

```
npm run dev
```

Starts a local dev server on `http://localhost:8787` with hot-reload. Use a
test SYNC_TOKEN via `wrangler secret put SYNC_TOKEN --env dev` or a `.dev.vars`
file with `SYNC_TOKEN=test`.

## Rotate the token

```
wrangler secret put SYNC_TOKEN
```

Then re-pair each device with the new token. The encrypted blob is unaffected
— only the bearer gate changes.

## Wipe everything

```
# delete the blob
curl -X DELETE -H "Authorization: Bearer $SYNC_TOKEN" \
     https://arnold-sync.<your-subdomain>.workers.dev/s/<your-device-pair-id>

# or: nuke the whole KV namespace
wrangler kv namespace delete --namespace-id <id>
```

## Cost

Free tier: 100k requests/day, 1 GB KV storage, 1k KV writes/day.
Arnold syncs debounce to at most ~5 writes/min per device. You will not hit
these limits.
