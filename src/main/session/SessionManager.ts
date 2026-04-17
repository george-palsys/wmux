import { app } from 'electron';
import path from 'node:path';
import type { SessionData } from '../../shared/types';
import {
  atomicReadJSONSync,
  atomicWriteJSON,
  atomicWriteJSONSync,
} from '../../daemon/util/atomicWrite';
import { AsyncQueue } from '../../daemon/util/AsyncQueue';

const DEBOUNCE_MS = 30_000;
const QUEUE_KEY = 'session';

export class SessionManager {
  private filePath: string;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingData: SessionData | null = null;
  private readonly queue = new AsyncQueue();

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'session.json');

    // Sync fallback for `flushSync()` on emergency exit paths
    // (Windows session-end, process crash handlers, etc.).
    this.queue.setSyncFallback(QUEUE_KEY, () => {
      if (this.pendingData !== null) {
        atomicWriteJSONSync(this.filePath, this.pendingData);
        this.pendingData = null;
      }
    });
  }

  /**
   * Atomic save: delegates to the shared atomic-write helper which
   * writes to .tmp, backs up the existing file to .bak, then renames
   * .tmp → session.json. If the process crashes mid-write, only the
   * .tmp file is corrupted; the original session.json (or .bak)
   * remains intact.
   *
   * Synchronous — used by IPC handlers and the Windows session-end
   * emergency path, both of which require the write to complete
   * inline. T2 keeps this signature frozen.
   */
  save(data: SessionData): void {
    // If a debounced write is queued, drop it — we're about to
    // persist a newer snapshot synchronously and do not want the
    // older async payload to overwrite it on completion.
    this.queue.clear();
    try {
      atomicWriteJSONSync(this.filePath, data);
      this.pendingData = null;
    } catch (err) {
      console.error('[SessionManager] Failed to save session:', err);
    }
  }

  /**
   * Debounced save — coalesces frequent updates (periodic scrollback
   * timestamp refreshes, etc.) over 30s. Funnels through an
   * `AsyncQueue` so overlapping debounced writes serialize safely
   * against the shared `.bak`/`.tmp` rotation.
   */
  saveDebounced(data: SessionData): void {
    this.pendingData = data;

    if (this.debounceTimer !== null) {
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const snapshot = this.pendingData;
      if (snapshot === null) return;

      void this.queue.enqueue(QUEUE_KEY, async () => {
        const payload = this.pendingData;
        if (payload === null) return;
        try {
          await atomicWriteJSON(this.filePath, payload);
          if (this.pendingData === payload) {
            this.pendingData = null;
          }
        } catch (err) {
          console.error('[SessionManager] Failed to save session (async):', err);
        }
      });
    }, DEBOUNCE_MS);
  }

  /** Await any queued async writes. Also cancels the pending debounce timer. */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      if (this.pendingData !== null) {
        this.save(this.pendingData);
      }
    }
    await this.queue.flush();
  }

  /**
   * Process-exit friendly drain. Cancels the debounce timer and runs
   * any registered sync fallbacks for queued async writes.
   */
  flushSync(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingData !== null && this.queue.isIdle) {
      try {
        atomicWriteJSONSync(this.filePath, this.pendingData);
        this.pendingData = null;
      } catch (err) {
        console.error('[SessionManager] flushSync immediate write failed:', err);
      }
    }
    this.queue.flushSync();
  }

  load(): SessionData | null {
    try {
      return atomicReadJSONSync<SessionData>(this.filePath, {
        validate: SessionManager.isSessionData,
      });
    } catch (err) {
      console.error('[SessionManager] Failed to load session:', err);
      return null;
    }
  }

  /**
   * Type guard passed to the shared atomic-read helper. Mirrors the
   * validation previously inlined in this module.
   */
  private static isSessionData(parsed: unknown): parsed is SessionData {
    if (typeof parsed !== 'object' || parsed === null) return false;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj['workspaces'])) return false;
    if (typeof obj['activeWorkspaceId'] !== 'string') return false;
    return true;
  }
}
