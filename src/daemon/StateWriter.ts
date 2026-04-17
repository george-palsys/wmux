import fs from 'node:fs';
import path from 'node:path';
import type { DaemonState } from './types';
import {
  atomicReadJSONSync,
  atomicWriteJSON,
  atomicWriteJSONSync,
} from './util/atomicWrite';
import { AsyncQueue } from './util/AsyncQueue';

const DEBOUNCE_MS = 30_000;
const QUEUE_KEY = 'state';

/**
 * Persists DaemonState (sessions.json) to disk using the shared
 * atomic-write helpers in `./util/atomicWrite`. The public API
 * (saveImmediate / saveDebounced / load / flush / dispose) is frozen
 * so later waves can layer behaviour without changing call sites.
 *
 * Concurrency model (T2):
 *   - `saveImmediate` is synchronous and remains so — the daemon's
 *     emergency-exit paths (SIGINT/SIGTERM/session-end/etc.) rely on
 *     it running inline. Before writing it clears any queued async
 *     write so a stale debounced snapshot cannot overwrite the newer
 *     immediate one.
 *   - `saveDebounced` funnels through an `AsyncQueue` keyed `'state'`
 *     so only one async write is ever in flight. Repeated debounced
 *     calls coalesce to the latest snapshot.
 *   - `flushSync` drains the queue by invoking the registered sync
 *     fallback (used by process-exit handlers where the event loop
 *     has stopped).
 */
export class StateWriter {
  private filePath: string;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingState: DaemonState | null = null;
  private readonly queue = new AsyncQueue();

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, 'sessions.json');

    // Sync fallback used by `flushSync()` on emergency exit paths.
    // It writes whatever the latest pending snapshot is using the
    // synchronous atomic-write helper.
    this.queue.setSyncFallback(QUEUE_KEY, () => {
      if (this.pendingState !== null) {
        atomicWriteJSONSync(this.filePath, this.pendingState);
        this.pendingState = null;
      }
    });
  }

  /** Immediately write state to disk (session create/destroy/state change). */
  saveImmediate(state: DaemonState): void {
    // Drop any queued async write — we are about to persist a newer
    // snapshot synchronously, and we don't want the older in-flight
    // payload to overwrite it after we return.
    this.queue.clear();
    try {
      atomicWriteJSONSync(this.filePath, state);

      // Clear pending since we just saved
      this.pendingState = null;
    } catch (err) {
      console.error('[StateWriter] Failed to save state:', err);
    }
  }

  /** Debounced save — coalesces frequent updates (e.g. lastActivity) over 30s. */
  saveDebounced(state: DaemonState): void {
    this.pendingState = state;

    if (this.debounceTimer !== null) {
      return; // Timer already running; state will be picked up when it fires
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const snapshot = this.pendingState;
      if (snapshot === null) return;

      // Hand the actual I/O off to the coalescing queue so concurrent
      // debounced writes (or an overlapping immediate save) cannot
      // race each other over the shared `.bak`/`.tmp` rotation.
      void this.queue.enqueue(QUEUE_KEY, async () => {
        // Re-read pendingState at task execution time — another
        // saveDebounced() call between the timer firing and this
        // microtask running will have updated it.
        const payload = this.pendingState;
        if (payload === null) return;
        try {
          await atomicWriteJSON(this.filePath, payload);
          // Only clear pending if no newer snapshot arrived while we
          // were writing — otherwise we'd discard the newer data.
          if (this.pendingState === payload) {
            this.pendingState = null;
          }
        } catch (err) {
          console.error('[StateWriter] Failed to save state (async):', err);
        }
      });
    }, DEBOUNCE_MS);
  }

  /** Load state from disk. Falls back to .bak on failure. Prunes expired DEAD sessions. */
  load(): DaemonState {
    const empty: DaemonState = { version: 1, sessions: [] };

    let state: DaemonState | null = null;
    try {
      state = atomicReadJSONSync<DaemonState>(this.filePath, {
        validate: StateWriter.isDaemonState,
      });
    } catch (err) {
      console.error('[StateWriter] Failed to load state:', err);
    }

    if (!state) {
      return empty;
    }

    // Prune DEAD sessions that exceeded their TTL
    state.sessions = state.sessions.filter((s) => {
      if (s.state !== 'dead') return true;
      const deadSince = new Date(s.lastActivity).getTime();
      const ttlMs = s.deadTtlHours * 60 * 60 * 1000;
      return Date.now() - deadSince < ttlMs;
    });

    return state;
  }

  /** Flush pending debounce — if there is pending state, write it immediately. */
  flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingState !== null) {
      this.saveImmediate(this.pendingState);
    }
  }

  /**
   * Process-exit friendly drain. Cancels the debounce timer and runs
   * any registered sync fallbacks for queued async writes. Safe to
   * call multiple times.
   */
  flushSync(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // If we have a pending snapshot that was never enqueued (timer
    // hadn't fired yet), stage it so the queue's sync fallback can
    // pick it up uniformly. We enqueue a no-op task keyed `state`
    // that will be replaced by the fallback on drain.
    if (this.pendingState !== null && this.queue.isIdle) {
      // Side-stepping the async path: we invoke the fallback directly
      // because nothing was enqueued for the queue to drain.
      try {
        atomicWriteJSONSync(this.filePath, this.pendingState);
        this.pendingState = null;
      } catch (err) {
        console.error('[StateWriter] flushSync immediate write failed:', err);
      }
    }
    this.queue.flushSync();
  }

  /** Clean up timers (daemon shutdown). Flushes pending state first. */
  dispose(): void {
    this.flush();
  }

  /** Get the path where a session's scrollback buffer should be dumped. */
  getBufferDumpPath(sessionId: string): string {
    return path.join(path.dirname(this.filePath), 'buffers', `${sessionId}.buf`);
  }

  /** Ensure the buffers/ directory exists. */
  ensureBufferDir(): void {
    const dir = path.join(path.dirname(this.filePath), 'buffers');
    if (!fs.existsSync(dir)) {
      // Note: mode is no-op on Windows; use icacls for NTFS ACLs
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /** Remove orphaned .buf files not referenced by any session. */
  cleanOrphanedBuffers(activeIds: Set<string>): void {
    const dir = path.join(path.dirname(this.filePath), 'buffers');
    if (!fs.existsSync(dir)) return;
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.buf')) continue;
        const id = file.replace(/\.buf$/, '');
        if (!activeIds.has(id)) {
          try { fs.unlinkSync(path.join(dir, file)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Type guard used by the shared atomic-read helper. Validates the
   * minimum required shape; full schema validation lives in Wave 3.
   */
  private static isDaemonState(parsed: unknown): parsed is DaemonState {
    if (typeof parsed !== 'object' || parsed === null) return false;
    const obj = parsed as Record<string, unknown>;

    if (typeof obj['version'] !== 'number') return false;
    if (!Array.isArray(obj['sessions'])) return false;

    // Validate each session has minimum required fields
    for (const s of obj['sessions'] as unknown[]) {
      if (typeof s !== 'object' || s === null) return false;
      const sess = s as Record<string, unknown>;
      if (typeof sess['id'] !== 'string') return false;
      if (typeof sess['state'] !== 'string') return false;
    }

    return true;
  }
}
