// ─── Arnold Cloud Sync Worker ────────────────────────────────────────────────
// Opaque encrypted-blob relay for syncing Arnold between devices.
// The worker never sees plaintext — it's a dumb key/value shuttle guarded by
// a bearer token. Data is end-to-end encrypted on the client with an AES-256
// key derived from the user's passphrase via PBKDF2.
//
// Endpoints:
//   GET    /s/:id       → returns the encrypted blob (or 404)
//   PUT    /s/:id       → stores the blob (body up to 8 MB)
//   DELETE /s/:id       → wipes the blob (manual reset)
//   GET    /health      → "ok" (no auth, no secrets)
//
// Auth:
//   Every non-health request must carry:
//     Authorization: Bearer <SYNC_TOKEN>
//   SYNC_TOKEN is stored as a Cloudflare secret (wrangler secret put SYNC_TOKEN).
//   Comparison is constant-time to deflect timing probes.
//
// Storage:
//   KV namespace binding name: SYNC_KV
//   Keys are of the form `blob:<id>`. `<id>` is a hex string chosen by the
//   client (32 bytes of CSPRNG). The worker rejects ids that don't match the
//   expected shape.
//
// The blob itself is opaque bytes — typically ~100 KB to 2 MB of ciphertext.

const MAX_BLOB_BYTES = 8 * 1024 * 1024; // 8 MB safety cap
const ID_PATTERN = /^[a-f0-9]{32,128}$/; // 16–64 bytes hex

// ── Constant-time string compare ────────────────────────────────────────────
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length);
  const expected = env.SYNC_TOKEN || '';
  if (!expected) return false; // misconfigured — deny
  return timingSafeEqual(token, expected);
}

// ── CORS ────────────────────────────────────────────────────────────────────
// Capacitor WebViews use scheme `https://localhost`, `capacitor://localhost`,
// or `http://localhost`. Web desktop runs on whatever origin you serve from.
// Bearer auth is the actual security boundary — CORS is just for browsers.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
  'Access-Control-Max-Age': '86400',
};

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
  });
}

function text(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS, ...extra },
  });
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleGet(id, env) {
  const meta = await env.SYNC_KV.getWithMetadata(`blob:${id}`, { type: 'arrayBuffer' });
  if (!meta || !meta.value) return json(404, { error: 'not_found' });
  const updatedAt = (meta.metadata && meta.metadata.updatedAt) || 0;
  return new Response(meta.value, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'ETag': `"${updatedAt}"`,
      'X-Updated-At': String(updatedAt),
      ...CORS_HEADERS,
    },
  });
}

async function handlePut(id, request, env) {
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_BLOB_BYTES) return json(413, { error: 'too_large', limit: MAX_BLOB_BYTES });

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return json(400, { error: 'empty_body' });
  if (buf.byteLength > MAX_BLOB_BYTES) return json(413, { error: 'too_large', limit: MAX_BLOB_BYTES });

  const updatedAt = Date.now();
  await env.SYNC_KV.put(`blob:${id}`, buf, {
    metadata: { updatedAt, bytes: buf.byteLength },
  });
  return json(200, { ok: true, bytes: buf.byteLength, updatedAt });
}

async function handleDelete(id, env) {
  await env.SYNC_KV.delete(`blob:${id}`);
  return json(200, { ok: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health probe — no auth, no data
    if (pathname === '/health' && request.method === 'GET') {
      return text(200, 'ok');
    }

    // Everything else requires auth
    if (!requireAuth(request, env)) {
      return json(401, { error: 'unauthorized' });
    }

    // /s/:id routes
    const match = pathname.match(/^\/s\/([a-f0-9]+)$/);
    if (match) {
      const id = match[1];
      if (!ID_PATTERN.test(id)) return json(400, { error: 'bad_id' });

      switch (request.method) {
        case 'GET':    return handleGet(id, env);
        case 'PUT':    return handlePut(id, request, env);
        case 'DELETE': return handleDelete(id, env);
        default:       return json(405, { error: 'method_not_allowed' });
      }
    }

    return json(404, { error: 'not_found' });
  },
};
