/**
 * IPC registration for the first-run wizard (T4).
 *
 * Mirrors the cleanup-function pattern used by other handler modules
 * (see `src/main/ipc/handlers/pty.handler.ts`, `mcp.handler.ts`) so the
 * caller can tear down handlers on renderer reload / process restart.
 */

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

import { IPC } from '../../shared/constants';
import { wrapHandler } from '../ipc/wrapHandler';
import type { FirstRunOrchestrator } from './FirstRunOrchestrator';
import type { SampleTaskStartPayload } from '../../shared/firstRun';

export function registerFirstRunHandlers(orchestrator: FirstRunOrchestrator): () => void {
  ipcMain.removeHandler(IPC.FIRST_RUN_CHECK);
  ipcMain.handle(
    IPC.FIRST_RUN_CHECK,
    wrapHandler(IPC.FIRST_RUN_CHECK, async () => orchestrator.check()),
  );

  ipcMain.removeHandler(IPC.FIRST_RUN_COMPLETE);
  ipcMain.handle(
    IPC.FIRST_RUN_COMPLETE,
    wrapHandler(IPC.FIRST_RUN_COMPLETE, async () => {
      await orchestrator.complete();
    }),
  );

  ipcMain.removeHandler(IPC.FIRST_RUN_DISMISS);
  ipcMain.handle(
    IPC.FIRST_RUN_DISMISS,
    wrapHandler(IPC.FIRST_RUN_DISMISS, async () => {
      await orchestrator.dismiss();
    }),
  );

  ipcMain.removeHandler(IPC.FIRST_RUN_REOPEN);
  ipcMain.handle(
    IPC.FIRST_RUN_REOPEN,
    wrapHandler(IPC.FIRST_RUN_REOPEN, async () => orchestrator.reopen()),
  );

  ipcMain.removeHandler(IPC.FIRST_RUN_REGISTER_MCP);
  ipcMain.handle(
    IPC.FIRST_RUN_REGISTER_MCP,
    wrapHandler(IPC.FIRST_RUN_REGISTER_MCP, async () => orchestrator.registerMcp()),
  );

  ipcMain.removeHandler(IPC.FIRST_RUN_START_SAMPLE_TASK);
  ipcMain.handle(
    IPC.FIRST_RUN_START_SAMPLE_TASK,
    wrapHandler(
      IPC.FIRST_RUN_START_SAMPLE_TASK,
      async (_event: IpcMainInvokeEvent, payload: SampleTaskStartPayload) => {
        if (!payload || typeof payload.ptyId !== 'string' || payload.ptyId.length === 0) {
          throw new Error('FIRST_RUN_START_SAMPLE_TASK: missing or invalid ptyId');
        }
        // Fire-and-forget — the runner outcome is reported via the
        // FIRST_RUN_SAMPLE_TASK_READY / TIMEOUT event channels rather than
        // the invoke return value, so the renderer can keep the wizard
        // responsive while the 5s OSC133 handshake plays out.
        void orchestrator.startSampleTask(payload.ptyId);
      },
    ),
  );

  return () => {
    ipcMain.removeHandler(IPC.FIRST_RUN_CHECK);
    ipcMain.removeHandler(IPC.FIRST_RUN_COMPLETE);
    ipcMain.removeHandler(IPC.FIRST_RUN_DISMISS);
    ipcMain.removeHandler(IPC.FIRST_RUN_REOPEN);
    ipcMain.removeHandler(IPC.FIRST_RUN_REGISTER_MCP);
    ipcMain.removeHandler(IPC.FIRST_RUN_START_SAMPLE_TASK);
  };
}
