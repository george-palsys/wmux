import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';

import { IPC } from '../../../shared/constants';
import type { FirstRunStatus, SampleTaskOutcome } from '../../../shared/firstRun';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return process.platform === 'win32' ? 'C:\\Users\\test\\AppData' : '/home/test/userData';
      return '/tmp';
    }),
  },
}));

// Mock ClaudeDetector — produce a deterministic status so we can assert wiring.
const mockDetect = vi.fn();
vi.mock('../ClaudeDetector', () => ({
  ClaudeDetector: class MockClaudeDetector {
    detect = mockDetect;
  },
}));

// Mock SampleTaskRunner — capture (source, signal) and resolve with whatever
// outcome the test queues up.
const runnerOutcomes: Array<SampleTaskOutcome> = [];
type CapturedRun = {
  source: { onData: (h: (c: string) => void) => () => void; write: (d: string) => void };
  signal: AbortSignal;
  resolve: (v: { outcome: SampleTaskOutcome }) => void;
};
const capturedRuns: CapturedRun[] = [];

vi.mock('../SampleTaskRunner', () => ({
  SampleTaskRunner: class MockSampleTaskRunner {
    run(
      source: { onData: (h: (c: string) => void) => () => void; write: (d: string) => void },
      signal: AbortSignal,
    ): Promise<{ outcome: SampleTaskOutcome }> {
      return new Promise((resolve) => {
        const outcome = runnerOutcomes.shift() ?? 'ok';
        capturedRuns.push({
          source,
          signal,
          resolve: resolve as (v: { outcome: SampleTaskOutcome }) => void,
        });
        // Schedule resolve on next tick so tests can inspect mid-flight state
        // (e.g. signal.aborted) before the outcome lands.
        setImmediate(() => resolve({ outcome }));
      });
    }
  },
}));

import { FirstRunOrchestrator } from '../FirstRunOrchestrator';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS: FirstRunStatus = {
  claudeFound: true,
  mcpRegistered: true,
  claudeJsonPath: '/home/test/.claude.json',
};

interface MockWin {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
}

function makeWindow(): MockWin {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
}

class MockDaemonClient extends EventEmitter {
  isConnected = true;
  writeToSession = vi.fn();
}

interface MockPtyBridge {
  addMiddleware: ReturnType<typeof vi.fn>;
}

function makePtyBridge(): MockPtyBridge {
  return { addMiddleware: vi.fn() };
}

interface MockPtyManager {
  write: ReturnType<typeof vi.fn>;
}

function makePtyManager(): MockPtyManager {
  return { write: vi.fn() };
}

interface MockMcpRegistrar {
  register: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
}

function makeMcpRegistrar(opts?: {
  registerImpl?: () => void;
  registered?: boolean;
}): MockMcpRegistrar {
  return {
    register: vi.fn(opts?.registerImpl ?? (() => { /* no-op: success default */ })),
    getStatus: vi.fn(() => ({
      wmux: { registered: opts?.registered ?? true, path: '/some/path' },
      wmuxA2a: { registered: false, path: null },
      configPath: '/home/test/.claude.json',
      configExists: true,
      configModified: new Date(),
    })),
  };
}

const MARKER_PATH = path.join(
  process.platform === 'win32' ? 'C:\\Users\\test\\AppData' : '/home/test/userData',
  '.first-run',
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FirstRunOrchestrator', () => {
  beforeEach(() => {
    vi.mocked(fs.stat).mockReset();
    vi.mocked(fs.readFile).mockReset();
    vi.mocked(fs.writeFile).mockReset();
    mockDetect.mockReset();
    mockDetect.mockResolvedValue(STATUS);
    runnerOutcomes.length = 0;
    capturedRuns.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. check() — marker absent ──────────────────────────────────────────────
  it('check() returns shown:false when marker is missing', async () => {
    vi.mocked(fs.stat).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => makeWindow() as never,
    );

    const result = await orch.check();
    expect(result.shown).toBe(false);
    expect(result.status).toEqual(STATUS);
    expect(result.completedAt).toBeUndefined();
  });

  // ── 2. check() — marker present ─────────────────────────────────────────────
  it('check() returns shown:true and completedAt when marker exists', async () => {
    const ts = '2026-04-29T12:34:56.000Z';
    vi.mocked(fs.stat).mockResolvedValueOnce({ isFile: () => true } as never);
    vi.mocked(fs.readFile).mockResolvedValueOnce(ts);

    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => makeWindow() as never,
    );

    const result = await orch.check();
    expect(result.shown).toBe(true);
    expect(result.status).toEqual(STATUS);
    expect(result.completedAt).toBe(ts);
  });

  // ── 3. complete() — writes marker ───────────────────────────────────────────
  it('complete() writes marker with ISO timestamp', async () => {
    vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined as never);
    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => makeWindow() as never,
    );

    await orch.complete();

    expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(1);
    const [pathArg, contentArg, encodingArg] = vi.mocked(fs.writeFile).mock.calls[0];
    expect(pathArg).toBe(MARKER_PATH);
    expect(typeof contentArg).toBe('string');
    expect(() => new Date(contentArg as string).toISOString()).not.toThrow();
    expect(encodingArg).toBe('utf8');
  });

  // ── 4. dismiss() — aborts active runner + writes marker ─────────────────────
  it('dismiss() aborts active sample-task runner and writes marker', async () => {
    vi.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    runnerOutcomes.push('aborted');

    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => makeWindow() as never,
    );

    // Start a sample task — captures the AbortSignal we'll watch.
    const startPromise = orch.startSampleTask('pty-1');
    // Wait a microtask so capturedRuns is populated.
    await Promise.resolve();
    expect(capturedRuns.length).toBe(1);
    const { signal } = capturedRuns[0];
    expect(signal.aborted).toBe(false);

    await orch.dismiss();

    expect(signal.aborted).toBe(true);
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fs.writeFile).mock.calls[0][0]).toBe(MARKER_PATH);
    await startPromise; // settle
  });

  // ── 5. reopen() — fresh status, shown:false even when marker exists ─────────
  it('reopen() returns shown:false regardless of marker', async () => {
    const ts = '2026-04-29T00:00:00.000Z';
    vi.mocked(fs.readFile).mockResolvedValueOnce(ts);

    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => makeWindow() as never,
    );

    const result = await orch.reopen();
    expect(result.shown).toBe(false);
    expect(result.status).toEqual(STATUS);
    expect(result.completedAt).toBe(ts);
    // Detector must be called fresh — no caching.
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

  // ── 6. registerMcp() — success ──────────────────────────────────────────────
  it('registerMcp() returns ok:true on successful registration', async () => {
    const reg = makeMcpRegistrar({ registered: true });
    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      reg as never,
      () => 'auth-token-xyz',
      () => makeWindow() as never,
    );

    const result = await orch.registerMcp();
    expect(result).toEqual({ ok: true });
    expect(reg.register).toHaveBeenCalledWith('auth-token-xyz');
  });

  // ── 7. registerMcp() — EACCES → PERM ────────────────────────────────────────
  it('registerMcp() maps EACCES to {ok:false, code:PERM}', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const reg = makeMcpRegistrar({
      registerImpl: () => { throw err; },
    });
    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      reg as never,
      () => 'token',
      () => makeWindow() as never,
    );

    const result = await orch.registerMcp();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('PERM');
      expect(result.message).toBe('permission denied');
    }
  });

  // ── 8. registerMcp() — SyntaxError → PARSE ──────────────────────────────────
  it('registerMcp() maps SyntaxError to {ok:false, code:PARSE}', async () => {
    const err = new SyntaxError('Unexpected token in JSON');
    const reg = makeMcpRegistrar({
      registerImpl: () => { throw err; },
    });
    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      reg as never,
      () => 'token',
      () => makeWindow() as never,
    );

    const result = await orch.registerMcp();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('PARSE');
      expect(result.message).toContain('Unexpected token');
    }
  });

  // ── 9. startSampleTask — daemon mode + READY event ──────────────────────────
  it('startSampleTask in daemon mode subscribes to session:data and emits READY on ok', async () => {
    runnerOutcomes.push('ok');
    const win = makeWindow();
    const dc = new MockDaemonClient();

    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => dc as never,
      makeMcpRegistrar() as never,
      () => 'token',
      () => win as never,
    );

    await orch.startSampleTask('session-A');

    expect(capturedRuns.length).toBe(1);
    const { source } = capturedRuns[0];

    // Subscribe via the source — this must register a session:data listener
    // on the daemon client that filters by sessionId and decodes Buffer→string.
    const received: string[] = [];
    const unsubscribe = source.onData((c) => received.push(c));
    expect(dc.listenerCount('session:data')).toBe(1);

    // Wrong sessionId — should be filtered out.
    dc.emit('session:data', { sessionId: 'session-B', data: Buffer.from('nope', 'utf8') });
    // Correct sessionId — should arrive decoded as UTF-8.
    dc.emit('session:data', { sessionId: 'session-A', data: Buffer.from('hello', 'utf8') });
    expect(received).toEqual(['hello']);

    // Write goes through writeToSession with sanitized text.
    source.write('cmd\r');
    expect(dc.writeToSession).toHaveBeenCalledTimes(1);
    expect(dc.writeToSession.mock.calls[0][0]).toBe('session-A');
    expect(typeof dc.writeToSession.mock.calls[0][1]).toBe('string');

    unsubscribe();
    expect(dc.listenerCount('session:data')).toBe(0);

    // The runner already resolved 'ok' on the next tick → READY fired.
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.FIRST_RUN_SAMPLE_TASK_READY);
  });

  // ── 10. startSampleTask — non-daemon mode + TIMEOUT event ───────────────────
  it('startSampleTask in non-daemon mode uses ptyBridge.addMiddleware and emits TIMEOUT', async () => {
    runnerOutcomes.push('timeout');
    const bridge = makePtyBridge();
    const mgr = makePtyManager();
    const win = makeWindow();

    const orch = new FirstRunOrchestrator(
      mgr as never,
      bridge as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => win as never,
    );

    await orch.startSampleTask('local-pty');

    expect(capturedRuns.length).toBe(1);
    const { source } = capturedRuns[0];

    const received: string[] = [];
    const unsubscribe = source.onData((c) => received.push(c));
    expect(bridge.addMiddleware).toHaveBeenCalledTimes(1);
    expect(bridge.addMiddleware.mock.calls[0][0]).toBe('local-pty');

    // Trigger the registered middleware directly — emulates PTYBridge data fan-out.
    const middlewareFn = bridge.addMiddleware.mock.calls[0][1] as (d: string) => void;
    middlewareFn('chunk');
    expect(received).toEqual(['chunk']);

    // After unsubscribe, further data must be ignored.
    unsubscribe();
    middlewareFn('after');
    expect(received).toEqual(['chunk']);

    // Write goes through PTYManager.write with sanitized text.
    source.write('input\r');
    expect(mgr.write).toHaveBeenCalledTimes(1);
    expect(mgr.write.mock.calls[0][0]).toBe('local-pty');

    // Runner resolved with 'timeout' → TIMEOUT event fired (READY did not).
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.FIRST_RUN_SAMPLE_TASK_TIMEOUT);
    expect(win.webContents.send).not.toHaveBeenCalledWith(IPC.FIRST_RUN_SAMPLE_TASK_READY);
  });

  // ── 11. startSampleTask twice — first run is aborted ────────────────────────
  it('startSampleTask twice aborts the first run before starting the second', async () => {
    runnerOutcomes.push('aborted', 'ok');

    const orch = new FirstRunOrchestrator(
      makePtyManager() as never,
      makePtyBridge() as never,
      () => null,
      makeMcpRegistrar() as never,
      () => 'token',
      () => makeWindow() as never,
    );

    const first = orch.startSampleTask('pty-A');
    await Promise.resolve();
    expect(capturedRuns.length).toBe(1);
    const firstSignal = capturedRuns[0].signal;
    expect(firstSignal.aborted).toBe(false);

    const second = orch.startSampleTask('pty-B');
    expect(firstSignal.aborted).toBe(true);

    await Promise.all([first, second]);
    expect(capturedRuns.length).toBe(2);
    // Second runner gets a fresh signal that wasn't aborted.
    expect(capturedRuns[1].signal.aborted).toBe(false);
  });
});
