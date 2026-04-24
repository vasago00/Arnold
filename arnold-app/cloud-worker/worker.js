// ─── Arnold Cloud Sync Relay Worker ─────────────────────────────────────────
// A dumb relay that stores/retrieves encrypted blobs. The Worker never sees
// plaintext — all encryption happens client-side with AES-256-GCM.
//
// Routes:
//   PUT /s/:pairId  — upload encrypted snapshot (binary body)
//   GET /s/:pairId  — download encrypted snapshot
//
// Auth: Bearer token checked against the SYNC_TOKEN secret.
// Storage: Cloudflare KV namespace bound as SYNC_KV.
//
// Deploy:
//   1. npm install -g wrangler
//   2. wrangler login
//   3. wrangler kv namespace create SYNC_KV
//      → copy the id into wrangler.toml
//   4. wrangler secret put SYNC_TOKEN
//      → paste a strong random token (e.g. openssl rand -hex 32)
//   5. wrangler deploy
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // ── CORS preflight ────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token || token !== env.SYNC_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    // ── Route: /s/:pairId ─────────────────────────────────────────────────
    const match = url.pathname.match(/^\/s\/([a-f0-9]{16,128})$/);
    if (!match) {
      return json({ error: 'not found' }, 404);
    }
    const pairId = match[1];
    const kvKey = `snap:${pairId}`;
    const metaKey = `meta:${pairId}`;

    // ── PUT: store snapshot ───────────────────────────────────────────────
    if (method === 'PUT') {
      const body = await request.arrayBuffer();
      if (!body || body.byteLength < 36) {
        return json({ error: 'body too small' }, 400);
      }
      // KV max value size is 25 MiB — plenty for Arnold snapshots
      if (body.byteLength > 10 * 1024 * 1024) {
        return json({ error: 'payload too large (10 MB max)' }, 413);
      }

      const updatedAt = String(Date.now());

      // Store blob as binary in KV
      await env.SYNC_KV.put(kvKey, body, {
        metadata: { updatedAt, size: body.byteLength },
      });
      // Also store metadata separately for conditional GETs
      await env.SYNC_KV.put(metaKey, updatedAt);

      return json({ ok: true, updatedAt, bytes: body.byteLength });
    }

    // ── GET: retrieve snapshot ─────────────────────────────────────────────
    if (method === 'GET') {
      // Conditional GET: If-None-Match with updatedAt timestamp
      const ifNoneMatch = (request.headers.get('If-None-Match') || '')
        .replace(/"/g, '')
        .trim();

      const storedUpdatedAt = await env.SYNC_KV.get(metaKey);

      if (ifNoneMatch && storedUpdatedAt && ifNoneMatch === storedUpdatedAt) {
        return new Response(null, {
          status: 304,
          headers: corsHeaders(),
        });
      }

      const blob = await env.SYNC_KV.get(kvKey, { type: 'arrayBuffer' });
      if (!blob) {
        return new Response(null, {
          status: 404,
          headers: corsHeaders(),
        });
      }

      return new Response(blob, {
        status: 200,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/octet-stream',
          'X-Updated-At': storedUpdatedAt || '',
          'Cache-Control': 'no-store',
        },
      });
    }

    // ── DELETE: remove snapshot (optional, for cleanup) ────────────────────
    if (method === 'DELETE') {
      await env.SYNC_KV.delete(kvKey);
      await env.SYNC_KV.delete(metaKey);
      return json({ ok: true, deleted: pairId });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
    'Access-Control-Expose-Headers': 'X-Updated-At',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
    },
  });
}
