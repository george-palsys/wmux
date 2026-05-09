import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { RpcRouter } from '../../RpcRouter';
import { registerPaneRpc } from '../pane.rpc';
import { PANE_METADATA_MAX_BYTES } from '../../../../shared/types';

const { sendToRendererMock } = vi.hoisted(() => ({
  sendToRendererMock: vi.fn(),
}));

vi.mock('../_bridge', () => ({
  sendToRenderer: sendToRendererMock,
}));

function register(): RpcRouter {
  const router = new RpcRouter();
  registerPaneRpc(router, (() => null) as () => BrowserWindow | null);
  return router;
}

describe('pane.rpc — search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendToRendererMock.mockResolvedValue({
      resultShapeVersion: 1,
      results: [],
      truncated: false,
      totalMatches: 0,
      workspaceId: 'ws-1',
    });
  });

  it('forwards a valid query to the renderer', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '1',
      method: 'pane.search',
      params: { query: 'foo' },
    });

    expect(response.ok).toBe(true);
    expect(sendToRendererMock).toHaveBeenCalledTimes(1);
    expect(sendToRendererMock).toHaveBeenCalledWith(
      expect.any(Function),
      'pane.search',
      { query: 'foo' },
    );
  });

  it('forwards the regex flag when provided as a boolean', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '2',
      method: 'pane.search',
      params: { query: 'foo', regex: true },
    });

    expect(response.ok).toBe(true);
    expect(sendToRendererMock).toHaveBeenCalledWith(
      expect.any(Function),
      'pane.search',
      { query: 'foo', regex: true },
    );
  });

  it('omits regex from forwarded payload when caller did not provide it', async () => {
    const router = register();
    await router.dispatch({
      id: '3',
      method: 'pane.search',
      params: { query: 'foo' },
    });

    const forwardedPayload = sendToRendererMock.mock.calls[0][2] as Record<string, unknown>;
    expect(forwardedPayload).toEqual({ query: 'foo' });
    expect('regex' in forwardedPayload).toBe(false);
  });

  it('forwards regex: false explicitly when caller provided it', async () => {
    const router = register();
    await router.dispatch({
      id: '4',
      method: 'pane.search',
      params: { query: 'foo', regex: false },
    });

    expect(sendToRendererMock).toHaveBeenCalledWith(
      expect.any(Function),
      'pane.search',
      { query: 'foo', regex: false },
    );
  });

  it('rejects an empty query', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '5',
      method: 'pane.search',
      params: { query: '' },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/non-empty/);
    }
    expect(sendToRendererMock).not.toHaveBeenCalled();
  });

  it('rejects a missing query (params has no `query` key)', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '6',
      method: 'pane.search',
      params: {},
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/string/);
    }
    expect(sendToRendererMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string query', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '7',
      method: 'pane.search',
      params: { query: 42 as unknown as string },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/string/);
    }
    expect(sendToRendererMock).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean regex flag (e.g. string "true")', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '8',
      method: 'pane.search',
      params: { query: 'x', regex: 'true' as unknown as boolean },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/boolean/);
    }
    expect(sendToRendererMock).not.toHaveBeenCalled();
  });

  // C1 — workspaceId forwarding. The main handler must thread the caller's
  // workspaceId through so the renderer scopes the search to that workspace
  // (not whichever the user happens to be viewing).
  it('forwards workspaceId when caller provides it (C1)', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '10',
      method: 'pane.search',
      params: { query: 'foo', workspaceId: 'ws-caller' },
    });

    expect(response.ok).toBe(true);
    expect(sendToRendererMock).toHaveBeenCalledWith(
      expect.any(Function),
      'pane.search',
      { query: 'foo', workspaceId: 'ws-caller' },
    );
  });

  it('forwards workspaceId together with regex when both are provided (C1)', async () => {
    const router = register();
    await router.dispatch({
      id: '11',
      method: 'pane.search',
      params: { query: 'foo', regex: true, workspaceId: 'ws-caller' },
    });

    expect(sendToRendererMock).toHaveBeenCalledWith(
      expect.any(Function),
      'pane.search',
      { query: 'foo', regex: true, workspaceId: 'ws-caller' },
    );
  });

  it('omits workspaceId from forwarded payload when caller did not provide it (C1)', async () => {
    const router = register();
    await router.dispatch({
      id: '12',
      method: 'pane.search',
      params: { query: 'foo' },
    });

    const forwardedPayload = sendToRendererMock.mock.calls[0][2] as Record<string, unknown>;
    expect('workspaceId' in forwardedPayload).toBe(false);
  });

  it('rejects a non-string workspaceId (C1)', async () => {
    const router = register();
    const response = await router.dispatch({
      id: '13',
      method: 'pane.search',
      params: { query: 'foo', workspaceId: 42 as unknown as string },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toMatch(/string/);
    }
    expect(sendToRendererMock).not.toHaveBeenCalled();
  });

  it('returns the renderer response payload to the caller', async () => {
    const router = register();
    const fakeResponse = {
      resultShapeVersion: 1,
      results: [
        {
          paneId: 'p1',
          surfaceId: 's1',
          ptyId: 'pty1',
          lineIdx: 5,
          physicalBaseY: 5,
          text: 'matched line',
          contextBefore: [],
          contextAfter: [],
        },
      ],
      truncated: false,
      totalMatches: 1,
      workspaceId: 'ws-1',
    };
    sendToRendererMock.mockResolvedValueOnce(fakeResponse);

    const response = await router.dispatch({
      id: '9',
      method: 'pane.search',
      params: { query: 'matched' },
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toEqual(fakeResponse);
    }
  });
});

const fakeWindow = {} as BrowserWindow;

function setupRouter(): RpcRouter {
  const router = new RpcRouter();
  registerPaneRpc(router, () => fakeWindow);
  return router;
}

describe('pane.rpc — metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendToRendererMock.mockResolvedValue({ ok: true });
  });

  describe('pane.setMetadata', () => {
    it('forwards a sanitized patch with merge=true by default', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-1',
        method: 'pane.setMetadata',
        params: { paneId: 'pane-x', label: 'Backend', role: 'service' },
      });

      expect(res.ok).toBe(true);
      expect(sendToRendererMock).toHaveBeenCalledTimes(1);
      const [, method, payload] = sendToRendererMock.mock.calls[0];
      expect(method).toBe('pane.setMetadata');
      expect(payload).toMatchObject({
        paneId: 'pane-x',
        merge: true,
        patch: { label: 'Backend', role: 'service' },
      });
    });

    it('honors merge=false when caller passes it', async () => {
      const router = setupRouter();
      await router.dispatch({
        id: 'rpc-2',
        method: 'pane.setMetadata',
        params: { paneId: 'pane-x', status: 'idle', merge: false },
      });

      const [, , payload] = sendToRendererMock.mock.calls[0];
      expect(payload).toMatchObject({ merge: false, patch: { status: 'idle' } });
    });

    it('rejects when label exceeds 64 chars', async () => {
      const router = setupRouter();
      const longLabel = 'a'.repeat(65);
      const res = await router.dispatch({
        id: 'rpc-3',
        method: 'pane.setMetadata',
        params: { label: longLabel },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/label/);
      }
      expect(sendToRendererMock).not.toHaveBeenCalled();
    });

    it('rejects when status exceeds 128 chars', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-4',
        method: 'pane.setMetadata',
        params: { status: 's'.repeat(129) },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/status/);
    });

    it('rejects non-string values inside custom map', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-5',
        method: 'pane.setMetadata',
        params: { custom: { count: 42 } as unknown as Record<string, string> },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/custom\.count/);
      expect(sendToRendererMock).not.toHaveBeenCalled();
    });

    it('rejects when custom is an array, not an object', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-6',
        method: 'pane.setMetadata',
        params: { custom: ['nope'] as unknown as Record<string, string> },
      });

      expect(res.ok).toBe(false);
    });

    it('rejects oversized payload over 8KB cap', async () => {
      const router = setupRouter();
      const huge = 'x'.repeat(PANE_METADATA_MAX_BYTES + 50);
      const res = await router.dispatch({
        id: 'rpc-7',
        method: 'pane.setMetadata',
        params: { custom: { blob: huge } },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/exceeds/);
      expect(sendToRendererMock).not.toHaveBeenCalled();
    });

    it('forwards undefined paneId so renderer falls back to active pane', async () => {
      const router = setupRouter();
      await router.dispatch({
        id: 'rpc-8',
        method: 'pane.setMetadata',
        params: { label: 'Active' },
      });
      const [, , payload] = sendToRendererMock.mock.calls[0];
      expect(payload.paneId).toBeUndefined();
    });
  });

  describe('pane.getMetadata', () => {
    it('forwards paneId to renderer', async () => {
      const router = setupRouter();
      sendToRendererMock.mockResolvedValueOnce({
        paneId: 'pane-x',
        metadata: { label: 'Backend' },
      });

      const res = await router.dispatch({
        id: 'rpc-9',
        method: 'pane.getMetadata',
        params: { paneId: 'pane-x' },
      });

      expect(res.ok).toBe(true);
      expect(sendToRendererMock).toHaveBeenCalledWith(
        expect.any(Function),
        'pane.getMetadata',
        { paneId: 'pane-x' },
      );
    });

    it('passes undefined paneId through when omitted', async () => {
      const router = setupRouter();
      await router.dispatch({
        id: 'rpc-10',
        method: 'pane.getMetadata',
        params: {},
      });
      const [, , payload] = sendToRendererMock.mock.calls[0];
      expect(payload.paneId).toBeUndefined();
    });
  });

  describe('pane.clearMetadata', () => {
    it('forwards paneId to renderer', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-11',
        method: 'pane.clearMetadata',
        params: { paneId: 'pane-x' },
      });
      expect(res.ok).toBe(true);
      const [, method, payload] = sendToRendererMock.mock.calls[0];
      expect(method).toBe('pane.clearMetadata');
      expect(payload).toEqual({ paneId: 'pane-x', workspaceId: undefined });
    });
  });

  describe('review fixes', () => {
    it('1.1 — forwards workspaceId for setMetadata so cross-workspace writes are scoped', async () => {
      const router = setupRouter();
      await router.dispatch({
        id: 'rpc-fix-1',
        method: 'pane.setMetadata',
        params: { workspaceId: 'ws-caller', paneId: 'pane-y', label: 'X' },
      });
      const [, , payload] = sendToRendererMock.mock.calls[0];
      expect(payload.workspaceId).toBe('ws-caller');
    });

    it('1.1 — forwards workspaceId for getMetadata + clearMetadata', async () => {
      const router = setupRouter();
      await router.dispatch({
        id: 'rpc-fix-2',
        method: 'pane.getMetadata',
        params: { workspaceId: 'ws-caller' },
      });
      await router.dispatch({
        id: 'rpc-fix-3',
        method: 'pane.clearMetadata',
        params: { workspaceId: 'ws-caller' },
      });
      const getCall = sendToRendererMock.mock.calls[0];
      const clearCall = sendToRendererMock.mock.calls[1];
      expect(getCall[2]).toEqual({ paneId: undefined, workspaceId: 'ws-caller' });
      expect(clearCall[2]).toEqual({ paneId: undefined, workspaceId: 'ws-caller' });
    });

    it('1.2 — rejects role exceeding 64 chars', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-fix-4',
        method: 'pane.setMetadata',
        params: { role: 'r'.repeat(65) },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/role/);
      expect(sendToRendererMock).not.toHaveBeenCalled();
    });

    it('1.3 — rejects empty custom key', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-fix-5',
        method: 'pane.setMetadata',
        params: { custom: { '': 'value' } },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/empty/);
    });

    it('1.3 — rejects custom key exceeding 64 chars', async () => {
      const router = setupRouter();
      const res = await router.dispatch({
        id: 'rpc-fix-6',
        method: 'pane.setMetadata',
        params: { custom: { ['k'.repeat(65)]: 'value' } },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/key exceeds/);
    });

    it('1.3 — rejects custom maps with > 32 entries', async () => {
      const router = setupRouter();
      const custom: Record<string, string> = {};
      for (let i = 0; i < 33; i++) custom[`k${i}`] = 'v';
      const res = await router.dispatch({
        id: 'rpc-fix-7',
        method: 'pane.setMetadata',
        params: { custom },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/32 entries/);
    });

    it('1.3 — accepts custom map at exactly the entry limit', async () => {
      const router = setupRouter();
      const custom: Record<string, string> = {};
      for (let i = 0; i < 32; i++) custom[`k${i}`] = 'v';
      const res = await router.dispatch({
        id: 'rpc-fix-8',
        method: 'pane.setMetadata',
        params: { custom },
      });
      expect(res.ok).toBe(true);
    });
  });

  describe('pane.list snapshot wrapper (review fix 2b + 5a)', () => {
    it('wraps the renderer response with asOfSeq + bootId', async () => {
      sendToRendererMock.mockResolvedValueOnce([
        { id: 'p1', surfaceCount: 1, active: true },
      ]);

      const router = setupRouter();
      const res = await router.dispatch({ id: 'rpc-list-1', method: 'pane.list', params: {} });

      expect(res.ok).toBe(true);
      if (res.ok) {
        const result = res.result as { asOfSeq: number; bootId: string; panes: unknown[] };
        expect(typeof result.asOfSeq).toBe('number');
        expect(typeof result.bootId).toBe('string');
        expect(result.bootId.length).toBeGreaterThan(0);
        expect(result.panes).toHaveLength(1);
      }
    });

    it('forwards workspaceId param to the renderer', async () => {
      sendToRendererMock.mockResolvedValueOnce([]);
      const router = setupRouter();
      await router.dispatch({
        id: 'rpc-list-2',
        method: 'pane.list',
        params: { workspaceId: 'ws-target' },
      });
      const [, method, payload] = sendToRendererMock.mock.calls[0];
      expect(method).toBe('pane.list');
      expect(payload).toMatchObject({ workspaceId: 'ws-target' });
    });
  });
});
