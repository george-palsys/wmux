import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  atomicWriteJSON,
  atomicReadJSON,
  atomicWriteJSONSync,
  atomicReadJSONSync,
} from '../core';

let tmpDir: string;
let targetPath: string;
let bakPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-atomicwrite-test-'));
  targetPath = path.join(tmpDir, 'data.json');
  bakPath = `${targetPath}.bak`;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('atomicWriteJSON / atomicReadJSON', () => {
  it('roundtrips a JSON payload', async () => {
    const payload = { version: 1, items: ['a', 'b'], meta: { count: 2 } };
    await atomicWriteJSON(targetPath, payload);

    const loaded = await atomicReadJSON<typeof payload>(targetPath);
    expect(loaded).toEqual(payload);
  });

  it('creates .bak on the second write', async () => {
    await atomicWriteJSON(targetPath, { n: 1 });
    expect(fs.existsSync(bakPath)).toBe(false);

    await atomicWriteJSON(targetPath, { n: 2 });
    expect(fs.existsSync(bakPath)).toBe(true);

    const bakData = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
    expect(bakData).toEqual({ n: 1 });

    const primaryData = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    expect(primaryData).toEqual({ n: 2 });
  });

  it('recovers from .bak when the primary is missing', async () => {
    // Write twice so .bak exists with the first payload.
    await atomicWriteJSON(targetPath, { gen: 'first' });
    await atomicWriteJSON(targetPath, { gen: 'second' });

    // Delete the primary file; .bak should still have the last-good.
    fs.unlinkSync(targetPath);
    expect(fs.existsSync(bakPath)).toBe(true);

    const loaded = await atomicReadJSON<{ gen: string }>(targetPath);
    expect(loaded).toEqual({ gen: 'first' });
  });

  it('recovers from .bak when the primary is corrupt JSON', async () => {
    await atomicWriteJSON(targetPath, { ok: true });
    await atomicWriteJSON(targetPath, { ok: 'second' });

    // Corrupt the primary.
    fs.writeFileSync(targetPath, '{{{not valid json', 'utf-8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loaded = await atomicReadJSON<{ ok: unknown }>(targetPath);
      expect(loaded).toEqual({ ok: true });
    } finally {
      warn.mockRestore();
    }
  });

  it('returns null when neither primary nor bak exist', async () => {
    const loaded = await atomicReadJSON(targetPath);
    expect(loaded).toBeNull();
  });

  it('sanitises prototype-pollution keys', async () => {
    // Write an unsafe payload straight to disk — we can't use the
    // writer to produce `__proto__` keys because JSON.stringify on
    // a plain object won't emit them. We verify the reviver drops
    // them on the read path.
    const poisoned = JSON.stringify({
      version: 1,
      sessions: [],
      __proto__: { admin: true },
      constructor: { prototype: { isAdmin: true } },
    });
    fs.writeFileSync(targetPath, poisoned, 'utf-8');

    const loaded = await atomicReadJSON<Record<string, unknown>>(targetPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);

    // Object.prototype must be untouched.
    const probe: Record<string, unknown> = {};
    expect(probe['admin']).toBeUndefined();
    expect(probe['isAdmin']).toBeUndefined();

    // The parsed object itself must not expose the polluted keys.
    // `constructor` is always on the prototype chain, so only check
    // that the *value* we wrote under `constructor` did not stick.
    expect(Object.prototype.hasOwnProperty.call(loaded, '__proto__')).toBe(false);
    expect(
      (loaded as Record<string, unknown>)['constructor'] !== Object.prototype.constructor,
    ).toBe(false);
  });

  it('returns null when validate() rejects the parsed payload (no bak)', async () => {
    await atomicWriteJSON(targetPath, { kind: 'wrong-shape' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const validator = (d: unknown): d is { kind: 'right' } =>
        typeof d === 'object' &&
        d !== null &&
        (d as Record<string, unknown>)['kind'] === 'right';

      const loaded = await atomicReadJSON(targetPath, { validate: validator });
      expect(loaded).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('write validate() failure throws without touching disk', async () => {
    // Seed existing file so we can confirm it is not overwritten.
    await atomicWriteJSON(targetPath, { original: true });
    const before = fs.readFileSync(targetPath, 'utf-8');

    await expect(
      atomicWriteJSON(
        targetPath,
        { bad: true },
        { validate: () => false },
      ),
    ).rejects.toThrow(/rejected payload/);

    const after = fs.readFileSync(targetPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('leaves no .tmp residue after a successful write', async () => {
    await atomicWriteJSON(targetPath, { n: 1 });
    const leftover = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('data.json.tmp'));
    expect(leftover).toEqual([]);
  });

  it('accepts the rotationEnabled flag as a no-op for T1a', async () => {
    await atomicWriteJSON(targetPath, { v: 1 }, { rotationEnabled: true });
    await atomicWriteJSON(targetPath, { v: 2 }, { rotationEnabled: true });

    // Current behaviour: single-bak, no rotation chain yet.
    expect(fs.existsSync(bakPath)).toBe(true);
    expect(fs.existsSync(`${bakPath}.1`)).toBe(false);

    const loaded = await atomicReadJSON<{ v: number }>(targetPath);
    expect(loaded).toEqual({ v: 2 });
  });

  it('migrator hook is accepted but ignored in T1a', async () => {
    await atomicWriteJSON(targetPath, { version: 1, value: 'original' });

    const migrator = vi.fn(
      (_data: unknown, _from: number) => ({
        data: { version: 99, value: 'migrated' } as { version: number; value: string },
        version: 99,
      }),
    );

    const loaded = await atomicReadJSON<{ version: number; value: string }>(
      targetPath,
      { migrator },
    );

    // T1a is explicit: payload passes through untouched.
    expect(loaded).toEqual({ version: 1, value: 'original' });
  });
});

describe('atomicWriteJSONSync / atomicReadJSONSync', () => {
  it('sync roundtrip works', () => {
    const payload = { a: 1, b: [true, false] };
    atomicWriteJSONSync(targetPath, payload);

    const loaded = atomicReadJSONSync<typeof payload>(targetPath);
    expect(loaded).toEqual(payload);
  });

  it('sync write creates .bak on overwrite', () => {
    atomicWriteJSONSync(targetPath, { gen: 'first' });
    atomicWriteJSONSync(targetPath, { gen: 'second' });

    expect(fs.existsSync(bakPath)).toBe(true);
    const bakData = JSON.parse(fs.readFileSync(bakPath, 'utf-8'));
    expect(bakData).toEqual({ gen: 'first' });
  });

  it('sync read falls back to .bak when primary is corrupt', () => {
    atomicWriteJSONSync(targetPath, { good: 1 });
    atomicWriteJSONSync(targetPath, { good: 2 });
    fs.writeFileSync(targetPath, 'not-json', 'utf-8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loaded = atomicReadJSONSync<{ good: number }>(targetPath);
      expect(loaded).toEqual({ good: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  it('sync write validate() failure throws', () => {
    expect(() =>
      atomicWriteJSONSync(targetPath, { x: 1 }, { validate: () => false }),
    ).toThrow(/rejected payload/);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it('sync read returns null when validator rejects', () => {
    atomicWriteJSONSync(targetPath, { kind: 'wrong' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loaded = atomicReadJSONSync(targetPath, {
        validate: (d): d is { kind: 'right' } =>
          typeof d === 'object' &&
          d !== null &&
          (d as Record<string, unknown>)['kind'] === 'right',
      });
      expect(loaded).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('sync leaves no .tmp residue', () => {
    atomicWriteJSONSync(targetPath, { n: 1 });
    const leftover = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('data.json.tmp'));
    expect(leftover).toEqual([]);
  });
});
