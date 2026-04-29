/**
 * FirstRunOrchestrator (T4) — wizard centerpiece for the main process.
 * Manages `.first-run` marker, surfaces ClaudeDetector, wraps MCP register
 * (D10 envelope), adapts daemon/local PTY data into a `PtyDataSource`, and
 * drives SampleTaskRunner. Single-flight: one runner at a time; dismiss /
 * re-start aborts the prior one. Reopen ignores the marker (D9).
 * See: progress.md (T4), decisions.md (D7/D9/D10).
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC } from '../../shared/constants';
import { sanitizePtyText } from '../../shared/types';
import { ClaudeDetector } from './ClaudeDetector';
import { SampleTaskRunner, type PtyDataSource } from './SampleTaskRunner';
import type { PTYManager } from '../pty/PTYManager';
import type { PTYBridge } from '../pty/PTYBridge';
import type { DaemonClient } from '../DaemonClient';
import type { McpRegistrar } from '../mcp/McpRegistrar';
import type {
  FirstRunCheckResult,
  RegisterMcpErrorCode,
  RegisterMcpResult,
} from '../../shared/firstRun';

const MARKER_FILENAME = '.first-run';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NOOP = (chunk: string): void => { void chunk; };

/** D10: map unknown register() error into wizard error code. */
function mapRegisterError(err: unknown): RegisterMcpErrorCode {
  if (err instanceof SyntaxError) return 'PARSE';
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'ENOENT' || code === 'ENOACCES') return 'PERM';
  if (code === 'EIO' || code === 'EBUSY') return 'IO';
  return 'UNKNOWN';
}

/** Daemon-mode PtyDataSource adapter (production default). */
function buildDaemonSource(dc: DaemonClient, ptyId: string): PtyDataSource {
  let handlerRef: (chunk: string) => void = NOOP;
  const listener = (...args: unknown[]): void => {
    const payload = args[0] as { sessionId?: string; data?: Buffer | string } | undefined;
    if (!payload || payload.sessionId !== ptyId) return;
    const data = payload.data;
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : (typeof data === 'string' ? data : '');
    if (text.length > 0) handlerRef(text);
  };
  return {
    onData(handler) {
      handlerRef = handler;
      dc.on('session:data', listener);
      return () => { dc.removeListener('session:data', listener); handlerRef = NOOP; };
    },
    write(data) { dc.writeToSession(ptyId, sanitizePtyText(data)); },
  };
}

/**
 * Non-daemon PtyDataSource. PTYBridge has no removeMiddleware, so we gate via
 * a `disposed` flag. Stack is torn down on PTY dispose anyway → bounded leak.
 */
function buildLocalSource(ptyManager: PTYManager, ptyBridge: PTYBridge, ptyId: string): PtyDataSource {
  return {
    onData(handler) {
      let disposed = false;
      ptyBridge.addMiddleware(ptyId, (data) => { if (!disposed) handler(data); });
      return () => { disposed = true; };
    },
    write(data) { ptyManager.write(ptyId, sanitizePtyText(data)); },
  };
}

export class FirstRunOrchestrator {
  private detector = new ClaudeDetector();
  private runner = new SampleTaskRunner();
  private activeAbort: AbortController | null = null;

  constructor(
    private ptyManager: PTYManager,
    private ptyBridge: PTYBridge,
    private getDaemonClient: () => DaemonClient | null,
    private mcpRegistrar: McpRegistrar,
    private getAuthToken: () => string | null,
    private getWindow: () => BrowserWindow | null,
  ) {}

  async check(): Promise<FirstRunCheckResult> {
    const [shown, status, completedAt] = await Promise.all([
      this.markerExists(),
      this.detector.detect(),
      this.readCompletedAt(),
    ]);
    return completedAt !== undefined ? { shown, status, completedAt } : { shown, status };
  }

  async complete(): Promise<void> {
    await this.writeMarker();
  }

  async dismiss(): Promise<void> {
    this.activeAbort?.abort();
    this.activeAbort = null;
    await this.writeMarker();
  }

  async reopen(): Promise<FirstRunCheckResult> {
    const [status, completedAt] = await Promise.all([
      this.detector.detect(),
      this.readCompletedAt(),
    ]);
    // shown=false instructs the wizard UI to mount even though the marker exists.
    return completedAt !== undefined
      ? { shown: false, status, completedAt }
      : { shown: false, status };
  }

  async registerMcp(): Promise<RegisterMcpResult> {
    try {
      const token = this.getAuthToken();
      if (!token) {
        return { ok: false, code: 'UNKNOWN', message: 'auth token not ready (pipe server still starting)' };
      }
      this.mcpRegistrar.register(token);
      // McpRegistrar.register catches its own errors; verify by re-reading status.
      const status = this.mcpRegistrar.getStatus();
      if (!status.wmux.registered) {
        return { ok: false, code: 'UNKNOWN', message: 'registration completed without recording wmux entry' };
      }
      return { ok: true };
    } catch (err: unknown) {
      const code = mapRegisterError(err);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code, message };
    }
  }

  async startSampleTask(ptyId: string): Promise<void> {
    // Single-flight: cancel any prior runner before starting a new one.
    this.activeAbort?.abort();
    const ctrl = new AbortController();
    this.activeAbort = ctrl;

    const dc = this.getDaemonClient();
    const source: PtyDataSource = dc !== null && dc.isConnected
      ? buildDaemonSource(dc, ptyId)
      : buildLocalSource(this.ptyManager, this.ptyBridge, ptyId);

    const { outcome } = await this.runner.run(source, ctrl.signal);

    // Only clear if we're still the active runner (defensive against re-entry).
    if (this.activeAbort === ctrl) this.activeAbort = null;

    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    if (outcome === 'ok') win.webContents.send(IPC.FIRST_RUN_SAMPLE_TASK_READY);
    else if (outcome === 'timeout') win.webContents.send(IPC.FIRST_RUN_SAMPLE_TASK_TIMEOUT);
    // 'aborted' → no event; dismiss/restart already handled the UX.
  }

  // ── private ────────────────────────────────────────────────────────────────

  private markerPath(): string {
    return path.join(app.getPath('userData'), MARKER_FILENAME);
  }

  private async markerExists(): Promise<boolean> {
    try {
      await fs.stat(this.markerPath());
      return true;
    } catch {
      return false;
    }
  }

  private async writeMarker(): Promise<void> {
    try {
      await fs.writeFile(this.markerPath(), new Date().toISOString(), 'utf8');
    } catch (err) {
      console.error('[FirstRunOrchestrator] writeMarker failed:', err);
    }
  }

  private async readCompletedAt(): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(this.markerPath(), 'utf8');
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}
