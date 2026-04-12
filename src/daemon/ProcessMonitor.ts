/**
 * Monitors child process liveness by periodically checking PID status.
 * No Electron dependencies — uses only Node.js APIs.
 */
export class ProcessMonitor {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private checking: Set<string> = new Set();

  // 30s interval — tasklist.exe is expensive on Windows and PTY's own onExit
  // event is the primary death detection. This monitor is just a safety net.
  private static readonly CHECK_INTERVAL_MS = 30000;

  // Require consecutive failures before declaring death — a single tasklist
  // timeout or transient error should NOT kill a healthy session.
  private consecutiveFailures: Map<string, number> = new Map();
  private static readonly CONSECUTIVE_FAILURES_THRESHOLD = 3;

  /** Check whether a process with the given PID is still alive. */
  static async isAlive(pid: number): Promise<boolean> {
    if (process.platform === 'win32') {
      // process.kill(pid, 0) is unreliable on Windows — always returns true.
      // Use tasklist which is available on all Windows versions.
      try {
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const execFileAsync = promisify(execFile);
        const pathMod = require('path');
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const tasklist = pathMod.join(systemRoot, 'System32', 'tasklist.exe');
        const { stdout } = await execFileAsync(
          tasklist,
          ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'],
          { encoding: 'utf-8', timeout: 5000, windowsHide: true },
        );
        return (stdout as string).includes(`"${pid}"`);
      } catch {
        // Timeout or transient error — assume alive to avoid false death.
        // A truly dead process will be caught on the next check or by PTY onExit.
        return true;
      }
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Start monitoring a process. Calls onDead when the process is no longer alive. */
  watch(sessionId: string, pid: number, onDead: () => void): void {
    // Clear any existing watcher for this session
    this.unwatch(sessionId);

    this.consecutiveFailures.set(sessionId, 0);

    const interval = setInterval(() => {
      // Re-entrancy guard: skip if a check is already in progress for this session
      if (this.checking.has(sessionId)) {
        return;
      }
      this.checking.add(sessionId);

      ProcessMonitor.isAlive(pid)
        .catch(() => true) // On error, assume alive — PTY onExit is the primary detector
        .then((alive) => {
          this.checking.delete(sessionId);
          if (alive) {
            // Reset consecutive failure counter on success
            this.consecutiveFailures.set(sessionId, 0);
          } else {
            const count = (this.consecutiveFailures.get(sessionId) ?? 0) + 1;
            this.consecutiveFailures.set(sessionId, count);
            if (count >= ProcessMonitor.CONSECUTIVE_FAILURES_THRESHOLD) {
              // Only declare dead after multiple consecutive confirmations
              this.unwatch(sessionId);
              onDead();
            }
          }
        });
    }, ProcessMonitor.CHECK_INTERVAL_MS);

    // Allow the timer to not block process exit
    if (interval.unref) {
      interval.unref();
    }

    this.intervals.set(sessionId, interval);
  }

  /** Stop monitoring a specific session. */
  unwatch(sessionId: string): void {
    const interval = this.intervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(sessionId);
    }
    this.checking.delete(sessionId);
    this.consecutiveFailures.delete(sessionId);
  }

  /** Stop monitoring all sessions. */
  unwatchAll(): void {
    this.intervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.intervals.clear();
    this.checking.clear();
    this.consecutiveFailures.clear();
  }
}
