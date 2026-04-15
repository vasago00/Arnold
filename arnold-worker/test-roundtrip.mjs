// Round-trip sanity test for the Arnold cloud-sync crypto envelope.
// Mirrors encryptBlob / decryptBlob from cloud-sync.js and exercises the
// PBKDF2 → AES-256-GCM chain end to end.

const MAGIC = new Uint8Array([65, 82, 78, 79, 76, 68, 0, 1]);
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 600_000;

function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }

async function deriveKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBlob(plaintext, key, saltBytes) {
  const iv = randomBytes(IV_BYTES);
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
  );
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(MAGIC.length + SALT_BYTES + IV_BYTES + ct.length);
  out.set(MAGIC, 0);
  out.set(saltBytes, MAGIC.length);
  out.set(iv, MAGIC.length + SALT_BYTES);
  out.set(ct, MAGIC.length + SALT_BYTES + IV_BYTES);
  return out;
}

async function decryptBlob(buf, passphrase) {
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC[i]) throw new Error('bad magic');
  }
  const salt = buf.slice(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = buf.slice(MAGIC.length + SALT_BYTES, MAGIC.length + SALT_BYTES + IV_BYTES);
  const ct = buf.slice(MAGIC.length + SALT_BYTES + IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(ptBuf);
}

// ─── Test cases ───────────────────────────────────────────────────────────────
const cases = [
  { name: 'empty object', payload: {} },
  { name: 'small object', payload: { hello: 'world', n: 42 } },
  { name: 'typical arnold snapshot', payload: {
    schema: 1, writtenAt: Date.now(), writtenBy: 'deadbeef',
    keys: {
      'arnold:garmin-hrv': { v: Array.from({ length: 30 }, (_, i) => ({ date: `2026-03-${String(i+1).padStart(2,'0')}`, rmssd: 45 + i })), t: Date.now() },
      'arnold:daily-logs': { v: Array.from({ length: 60 }, (_, i) => ({ date: `2026-02-${String((i%28)+1).padStart(2,'0')}`, energy: (i%5)+1, mood: (i%5)+1 })), t: Date.now() - 1000 },
      'arnold:profile': { v: { name: 'Test', heightInches: 70, weight: 180 }, t: Date.now() - 5000 },
    },
  } },
];

let passed = 0;
let failed = 0;

console.log(`PBKDF2 iterations: ${PBKDF2_ITERATIONS.toLocaleString()}`);

for (const c of cases) {
  const pass = `passphrase-${Math.random().toString(36).slice(2)}`;
  const salt = randomBytes(SALT_BYTES);
  const plaintext = JSON.stringify(c.payload);

  const t0 = Date.now();
  const key = await deriveKey(pass, salt);
  const t1 = Date.now();
  const blob = await encryptBlob(plaintext, key, salt);
  const t2 = Date.now();
  const out = await decryptBlob(blob, pass);
  const t3 = Date.now();

  const ok = out === plaintext;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.name.padEnd(32)} · ptext=${plaintext.length}B · blob=${blob.length}B · derive=${t1-t0}ms enc=${t2-t1}ms dec=${t3-t2}ms`);
  ok ? passed++ : failed++;

  // Negative test: wrong passphrase must fail
  try {
    await decryptBlob(blob, 'wrong-' + pass);
    console.log(`[FAIL] ${c.name.padEnd(32)} · wrong passphrase unexpectedly decrypted`);
    failed++;
  } catch {
    console.log(`[PASS] ${c.name.padEnd(32)} · wrong passphrase correctly rejected`);
    passed++;
  }

  // Negative test: flipped byte in ciphertext must fail (AES-GCM auth)
  const tampered = new Uint8Array(blob);
  tampered[tampered.length - 1] ^= 0xff;
  try {
    await decryptBlob(tampered, pass);
    console.log(`[FAIL] ${c.name.padEnd(32)} · tampered ciphertext unexpectedly decrypted`);
    failed++;
  } catch {
    console.log(`[PASS] ${c.name.padEnd(32)} · tampered ciphertext correctly rejected`);
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
