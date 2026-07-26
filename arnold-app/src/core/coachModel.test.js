// Tests for the on-device model loader's SAFE-BY-CONSTRUCTION seams (Stage 3, device-side). The runtime
// shim itself needs WebGPU + a model, so it isn't unit-tested — but the decision logic that keeps a weak
// GPU from crashing IS pure and tested here: which model rung we start on, how we step DOWN on a device
// loss, which errors count as a GPU loss, and that every gate degrades to the deterministic voice.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startModelForTier, modelTryOrder, candidateOrder, isGpuLossError, gpuCapability,
  registerCoachReasoner, unregisterCoachReasoner, hasWebGPU, isEnabled, coachVoiceStatus,
} from './coachModel.js';
import { getReasoner, registerReasoner } from './coachReasoner.js';

const GEMMA = 'gemma-2-2b-it-q4f16_1-MLC';
const QWEN15 = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const QWEN05 = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const QWEN15_F32 = 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC';
const QWEN05_F32 = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';

// stubGpu(maxBufferBytes, f16=true) — f16 controls whether the adapter exposes the shader-f16 feature.
const stubGpu = (maxBufferBytes, f16 = true) =>
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({
    limits: { maxBufferSize: maxBufferBytes },
    features: { has: (x) => (x === 'shader-f16' ? f16 : false) },
  }) } });

beforeEach(() => { registerReasoner(null); });
afterEach(() => { vi.unstubAllGlobals(); registerReasoner(null); });

describe('startModelForTier — capable GPU gets the strong voice, everything else the safe default', () => {
  it('high tier → the top rung (Gemma)', () => { expect(startModelForTier('high')).toBe(GEMMA); });
  it('low tier → the safe default (Qwen-1.5B)', () => { expect(startModelForTier('low')).toBe(QWEN15); });
  it('unknown tier → the safe default (never the heavy rung)', () => { expect(startModelForTier('unknown')).toBe(QWEN15); });
  it('an explicit modelId always wins over the tier', () => { expect(startModelForTier('high', 'X-CUSTOM')).toBe('X-CUSTOM'); });
});

describe('modelTryOrder — step DOWN the ladder, never back up to a heavier model', () => {
  it('from the top rung → all three, heaviest to lightest', () => {
    expect(modelTryOrder(GEMMA)).toEqual([GEMMA, QWEN15, QWEN05]);
  });
  it('from the middle rung → only lighter rungs (never re-tries Gemma)', () => {
    const order = modelTryOrder(QWEN15);
    expect(order).toEqual([QWEN15, QWEN05]);
    expect(order.some((m) => m.includes('gemma'))).toBe(false);
  });
  it('from the bottom rung → itself only', () => { expect(modelTryOrder(QWEN05)).toEqual([QWEN05]); });
  it('a custom off-ladder model → itself, then the lighter defaults as fallbacks', () => {
    const order = modelTryOrder('SomeOther-3B');
    expect(order[0]).toBe('SomeOther-3B');
    expect(order.length).toBeGreaterThanOrEqual(2);
  });
});

describe('isGpuLossError — only a resource loss should trigger a step-down', () => {
  it.each([
    ['Device was lost', true],
    ['DXGI_ERROR_DEVICE_HUNG', true],
    ['GPU device was removed', true],
    ['out of memory', true],
    ['Cannot find module @mlc-ai/web-llm', false],
    ['network fetch failed', false],
  ])('%s → %s', (msg, expected) => { expect(isGpuLossError(new Error(msg))).toBe(expected); });
  it('null / undefined → false (no false step-down)', () => {
    expect(isGpuLossError(null)).toBe(false);
    expect(isGpuLossError(undefined)).toBe(false);
  });
});

describe('gpuCapability — coarse tiering from the adapter limits', () => {
  it('a ≥1 GiB single-buffer adapter → high tier', async () => {
    stubGpu(2 * 1024 * 1024 * 1024);
    expect((await gpuCapability()).tier).toBe('high');
  });
  it('a small (integrated-like) adapter → low tier', async () => {
    stubGpu(256 * 1024 * 1024);
    expect((await gpuCapability()).tier).toBe('low');
  });
  it('no adapter → unknown, never throws', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
    expect((await gpuCapability()).tier).toBe('unknown');
  });
  it('reports shader-f16 support (present)', async () => {
    stubGpu(2 * 1024 * 1024 * 1024, true);
    expect((await gpuCapability()).f16).toBe(true);
  });
  it('reports shader-f16 ABSENT (Intel-iGPU-like) — the web "couldn\'t start" cause', async () => {
    stubGpu(256 * 1024 * 1024, false);
    expect((await gpuCapability()).f16).toBe(false);
  });
});

describe('precision ladders — q4f32 fallback for GPUs without shader-f16 (Emil: web couldn\'t start)', () => {
  it('startModelForTier picks the f16 ladder when f16 is supported', () => {
    expect(startModelForTier('high', undefined, true)).toBe(GEMMA);
    expect(startModelForTier('low', undefined, true)).toBe(QWEN15);
  });
  it('startModelForTier picks the f32 ladder (and never Gemma) when f16 is absent', () => {
    expect(startModelForTier('high', undefined, false)).toBe(QWEN15_F32);
    expect(startModelForTier('low', undefined, false)).toBe(QWEN05_F32);
  });
  it('candidateOrder walks the f16 rungs, THEN crosses over to f32 as a last resort', () => {
    const order = candidateOrder(GEMMA);
    expect(order.slice(0, 3)).toEqual([GEMMA, QWEN15, QWEN05]);
    expect(order.slice(3)).toEqual([QWEN15_F32, QWEN05_F32]);
    expect(new Set(order).size).toBe(order.length);   // no dupes
  });
  it('candidateOrder from an f32 start walks f32, THEN crosses over to f16', () => {
    const order = candidateOrder(QWEN15_F32);
    expect(order[0]).toBe(QWEN15_F32);
    expect(order).toContain(GEMMA);
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('registerCoachReasoner — gates and safe degradation', () => {
  it('no WebGPU → no-op, no reasoner registered', async () => {
    vi.stubGlobal('navigator', {});   // no .gpu
    expect(hasWebGPU()).toBe(false);
    const r = await registerCoachReasoner({ force: true });
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'no-webgpu' }));
    expect(getReasoner()).toBe(null);
  });

  it('registers a working generate() and surfaces the model used', async () => {
    stubGpu(2 * 1024 * 1024 * 1024);
    const load = async () => ({ engine: {}, generate: async () => 'hi', model: 'FAKE' });
    const r = await registerCoachReasoner({ force: true, load });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('registered');
    expect(r.model).toBe('FAKE');
    expect(typeof getReasoner()).toBe('function');
  });

  it('idempotent — a second call is a no-op', async () => {
    stubGpu(2 * 1024 * 1024 * 1024);
    const load = async () => ({ engine: {}, generate: async () => 'hi', model: 'FAKE' });
    await registerCoachReasoner({ force: true, load });
    const r2 = await registerCoachReasoner({ force: true, load });
    expect(r2.reason).toBe('already-registered');
  });

  it('a device-lost LOAD failure degrades to load-failed with NO reasoner (deterministic voice)', async () => {
    stubGpu(2 * 1024 * 1024 * 1024);
    const load = async () => { throw new Error('Device was lost — DXGI_ERROR_DEVICE_HUNG'); };
    const r = await registerCoachReasoner({ force: true, load });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('load-failed');
    expect(getReasoner()).toBe(null);
  });

  it('a loader with no generate() → no-generate, no reasoner', async () => {
    stubGpu(2 * 1024 * 1024 * 1024);
    const load = async () => ({ engine: {}, generate: null });
    const r = await registerCoachReasoner({ force: true, load });
    expect(r.reason).toBe('no-generate');
    expect(getReasoner()).toBe(null);
  });
});

describe('coachVoiceStatus — the live state the Profile toggle reads on remount', () => {
  it('reports not-ready with no model registered', () => {
    registerReasoner(null);
    expect(coachVoiceStatus()).toEqual({ ready: false, model: null });
  });
  it('reports ready + the loaded model id after a successful register (survives UI remount)', async () => {
    stubGpu(2 * 1024 * 1024 * 1024);
    await registerCoachReasoner({ force: true, load: async () => ({ engine: {}, generate: async () => 'hi', model: 'FAKE-MODEL' }) });
    expect(coachVoiceStatus()).toEqual({ ready: true, model: 'FAKE-MODEL' });
  });
  it('clears back to not-ready after unregister', () => {
    unregisterCoachReasoner();
    expect(coachVoiceStatus()).toEqual({ ready: false, model: null });
  });
});

describe('isEnabled / opt-in', () => {
  it('is a boolean and does not throw when nothing is set', () => {
    expect(typeof isEnabled()).toBe('boolean');
  });
});
