# Decisions Log — Cross-Pane Search

<!-- Most recent first. -->

### [2026-05-09] D9. v1 scope = 'workspace' only (cross-ws defer to v2)
**Background**: Architect 리뷰 F2 (P0) + F3 (P1) — main 측 RPC handler가 caller identity를 모르니 외부 MCP가 `scope: 'all'`로 다른 ws text 누출 가능. UI cross-ws도 비밀번호/.env 등 의도치 않은 노출.
**Chosen**: v1 RPC `pane.search` params에서 `scope` 파라미터 제거. UI에서도 Ctrl+Shift+F (All Workspaces) 토글 미노출. 기본=현재 ws, 단일 가능 동작.
**Rationale**: v1 가장 단순/안전한 baseline. 외부 MCP는 자기 workspaceId로 자동 스코프 (PR #16 패턴). cross-ws 권한 분리 + 설정 게이트는 v2 작업으로 명시.
**Impact**:
- D4 갱신 (해당 결정 무효화).
- P0 (F2) 자동 해결 — `scope='all'` 자체가 없어짐.
- F3 자동 해결 — UI 토글 없음.
- v2 task 후보: cross-workspace search (default off setting + RPC-layer caller-identity gate + `mcp.claimWorkspace`-class scope enforcement).

### [2026-05-09] D8. Panel auto-expand threshold — 10 (with hysteresis)
**Chosen**: 10개 결과 초과 시 dropdown → panel 자동 전환. **Hysteresis**: open at >10, close at <=5. 사용자가 명시적으로 panel 닫으면 같은 query session에서는 자동 재오픈 안 함 (sticky bit). Architect 리뷰 F7 반영.
**Rationale**: hysteresis 없으면 입력 중 결과 8↔12 사이에서 panel 깜빡거림. UX-hostile.

### [2026-05-09] D7. Scrollback dump 검색 — 제외 (v1)
**Chosen**: live pane만 (= **`terminalRegistry`에 마운트된 Terminal 인스턴스**)
**Rationale**: F10 명확화 — "live pane"의 정의는 "PTY가 살아있음"이 아니라 "Terminal 컴포넌트가 마운트되어 있음." PTY exit돼도 buffer 살아있으면 사용자에게 보이므로 검색해야. 95% 케이스 커버. dead-session dump 파일은 v2.

### [2026-05-09] D6. 정규식 지원 — 포함, 잘못된 패턴은 다른 처리
**Chosen**: regex 모드. RPC는 잘못된 패턴 → error. UI는 `SyntaxError` catch → input 빨간 테두리 + tooltip. 토스트 X. F8 반영.

### [2026-05-09] D5. MCP tool 노출 — 포함, result shape spec
**Chosen**: `wmux_search_panes(query, regex?)` (scope 제거됨, D9 참조).
**Result shape** (F6 반영):
```ts
{
  resultShapeVersion: 1,
  results: Array<{
    paneId: string,
    surfaceId: string,
    ptyId: string,
    lineIdx: number,        // logical line (post wrap-coalescing, F1)
    text: string,           // matched logical line
    contextBefore: string[], // 2 lines (default), configurable
    contextAfter: string[],
    paneLabel?: string,     // PR #16 metadata when available; missing OK
  }>,
  truncated: boolean,
  totalMatches: number,
  workspaceId: string,      // echoed for caller verification
}
```
- 결과 cap: 200개. 초과 시 `truncated: true`.
- `paneLabel`은 PR #16 metadata가 있을 때만. 없어도 깨지지 않음 (F9).

### [2026-05-09] D4. (DEPRECATED — D9가 대체)
~~검색 범위 — 현재 ws 기본 + 토글로 All Workspaces~~

### [2026-05-09] D3. 검색 엔진 — On-demand grep over xterm Terminal.buffer (with wrap-coalescing)
**Chosen**: 검색 시점에만 모든 leaf pane의 `terminalRegistry`에서 Terminal 가져와 `buffer.active.getLine(i).translateToString(true)` 순회.
**Wrap-coalescing** (F1 반영): `BufferLine.isWrapped`로 연속된 wrapped row를 한 logical line으로 병합. 예: 80-col에서 200-char 로그는 3 row지만 1 logical line. `lineIdx`는 logical line 인덱스, 원래 `baseY+offset`은 별도 보관해서 결과 클릭 시 `scrollToLine`에 사용.
**ptyId → workspaceId 역매핑** (F12 반영): 검색 entry 시점에 `store.workspaces` walk로 일회성 Map<ptyId, workspaceId> 빌드. 검색 결과 필터링/태깅에 사용.
**RingBuffer 사용 안 함** (F4 반영): daemon RingBuffer는 ANSI raw bytes + 다른 wrap geometry. 검색 source는 xterm.js buffer로 통일. 향후 indexing 진화 시에도 RingBuffer 안 씀.
**Performance guard** (F11 반영): per-pane 스캔 cap = 20,000 lines (config 가능). 초과 시 응답에 `truncated: true`. 또는 1k row마다 `queueMicrotask`로 yield해서 UI block 방지.
**Rationale**: 메모리 비용 0, indexing 복잡도 회피. 10 pane × 20k lines × 100 chars ≈ 20MB string scan, 수백 ms 이내 (yield 후크 포함).

### [2026-05-09] D2. Task size — Large
파일 10+, 새 UX 패턴, 의존성 4. Full Path.

### [2026-05-09] D1. UX shape — progressive disclosure
search bar dropdown (default) + auto-expand panel (>10 results). hysteresis는 D8 참조.

---

## Architect 리뷰 결과 (Phase 1, 2026-05-09)

### P0 — 디자인에 반영 완료
- F2 RPC-layer scope enforcement → D9로 cross-ws 자체 제거하여 자동 해결.

### P1 — 디자인에 반영 완료
- F1 wrapped lines coalescing → D3 (engine spec).
- F3 cross-ws UI 누출 → D9.
- F6 MCP result shape → D5.
- F10 dead-PTY pane → D7 ("live pane = Terminal mounted").
- F12 ptyId→wsId 역매핑 → D3.

### P2 — Follow-up tracking (구현 후 별도 issue)
- F4 indexing 진화 시 RingBuffer 안 씀 명시 → D3에 명시.
- F5 SearchAddon decorations on inactive panes (auto-copy debouncer trigger 회피) → 구현 시 inactive pane은 decorate 안 하고 coordinate만 저장. 사용자가 navigate 시점에 decorate.
- F7 hysteresis → D8 반영.
- F8 regex error UI → D6 반영.
- F9 PR #16 metadata 비종속 + resultShapeVersion → D5 반영.
- F11 buffer scan cap → D3 반영 (20k lines/pane, queueMicrotask yield).
