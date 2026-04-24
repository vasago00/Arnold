# Arnold Cloud Sync — Setup Guide

End-to-end encrypted sync between your web (desktop) and mobile Arnold instances.
The Cloudflare Worker relay only ever sees encrypted blobs.

## Prerequisites

- A free Cloudflare account: https://dash.cloudflare.com/sign-up
- Node.js installed on your PC
- Wrangler CLI: `npm install -g wrangler`

---

## Step 1: Deploy the Worker

```bash
cd arnold-app/cloud-worker
wrangler login
```

Create a KV namespace for storage:

```bash
wrangler kv namespace create SYNC_KV
```

This prints something like:

```
{ binding = "SYNC_KV", id = "abc123def456..." }
```

Open `wrangler.toml` and paste that `id` value in place of `PASTE_YOUR_KV_NAMESPACE_ID_HERE`.

---

## Step 2: Set your bearer token

Generate a strong random token:

```bash
# On Windows PowerShell:
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | % {[char]$_})

# On Mac/Linux:
openssl rand -hex 32
```

Save it to the Worker as a secret:

```bash
wrangler secret put SYNC_TOKEN
```

Paste your token when prompted. **Keep a copy** — you'll need it on both devices.

---

## Step 3: Deploy

```bash
wrangler deploy
```

Note your Worker URL, e.g. `https://arnold-sync.<your-subdomain>.workers.dev`

---

## Step 4: Pair your FIRST device (web/desktop)

1. Open Arnold on desktop → go to **More** tab (settings)
2. Find the **Cloud Sync** panel
3. Enter:
   - **Endpoint URL**: `https://arnold-sync.<your-subdomain>.workers.dev`
   - **Bearer token**: the token from Step 2
4. Click **Pair device**
5. Enter a **passphrase** (8+ characters, something you'll remember) → **Unlock & pull**
6. Click **Push now** to upload your data

---

## Step 5: Pair your SECOND device (mobile)

1. On the desktop Cloud Sync panel, expand **"Pair-a-second-device values"**
2. Copy the **Pair ID** and **Salt** values
3. On mobile Arnold → **More** tab → **Cloud Sync**
4. Enter the same **Endpoint URL** and **Bearer token**
5. Click **"Pairing a second device?"** to expand the advanced fields
6. Paste the **Pair ID** and **Salt** from your desktop
7. Click **Pair device**
8. Enter the **same passphrase** as desktop → **Unlock & pull**

Your mobile will pull all data from the relay and merge it with local data.

---

## How it works after pairing

- **Auto-push**: Any time you add data on either device (log food, upload a FIT file, import CSVs), a push is queued automatically after a 5-second debounce.
- **Auto-pull**: Every 5 minutes while the app is in the foreground, and every time you switch back to the app.
- **Manual**: Use the Push/Pull buttons anytime.
- **Merge**: Arrays (activities, sleep, weight, etc.) are merged by date — no data is overwritten unless the remote timestamp is newer.

---

## Cost

Cloudflare Workers free tier includes 100,000 requests/day and 1 GB KV storage.
Arnold sync uses ~1-2 requests per sync cycle. You will never come close to the limit.
