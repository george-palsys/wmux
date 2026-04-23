import type { BrowserWindow } from 'electron';
import type { RpcRouter } from '../RpcRouter';
import { sendToRenderer } from './_bridge';

type GetWindow = () => BrowserWindow | null;

export function registerWorkspaceRpc(router: RpcRouter, getWindow: GetWindow): void {
  /**
   * workspace.list — returns all workspaces as {id, name}[]
   */
  router.register('workspace.list', (_params) =>
    sendToRenderer(getWindow, 'workspace.list'),
  );

  /**
   * workspace.new — creates a new workspace
   * params: { name?: string }
   */
  router.register('workspace.new', (params) => {
    const name = typeof params['name'] === 'string' ? params['name'] : undefined;
    return sendToRenderer(getWindow, 'workspace.new', name !== undefined ? { name } : {});
  });

  /**
   * workspace.focus — sets the active workspace
   * params: { id: string }
   */
  router.register('workspace.focus', (params) => {
    if (typeof params['id'] !== 'string') {
      return Promise.reject(new Error('workspace.focus: missing required param "id"'));
    }
    return sendToRenderer(getWindow, 'workspace.focus', { id: params['id'] });
  });

  /**
   * workspace.close — removes a workspace
   * params: { id: string }
   */
  router.register('workspace.close', (params) => {
    if (typeof params['id'] !== 'string') {
      return Promise.reject(new Error('workspace.close: missing required param "id"'));
    }
    return sendToRenderer(getWindow, 'workspace.close', { id: params['id'] });
  });

  /**
   * workspace.current — returns the currently active workspace {id, name}
   */
  router.register('workspace.current', (_params) =>
    sendToRenderer(getWindow, 'workspace.current'),
  );

  /**
   * mcp.claimWorkspace — spawn a dedicated workspace + PTY for an external
   * MCP caller (i.e. Claude Code running in a terminal outside wmux).
   *
   * Without this, terminal_send falls through to the currently-focused pane
   * and injects keystrokes into the user's live work. claim creates an
   * isolated workspace, spawns a terminal in it, and returns the ptyId so
   * the MCP client can pin all future "no-ptyId" calls to that PTY.
   *
   * Critically, the renderer restores the previous active workspace after
   * creation — claim must not steal the user's focus.
   *
   * params: { name?: string }
   * returns: { ptyId, workspaceId, workspaceName }
   */
  router.register('mcp.claimWorkspace', (params) => {
    const name = typeof params['name'] === 'string' ? params['name'] : undefined;
    return sendToRenderer(getWindow, 'mcp.claimWorkspace', name !== undefined ? { name } : {});
  });
}
