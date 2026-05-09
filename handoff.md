# Teammate Handoff

## Session State (세션 복구용 필수 필드)
- **current_phase**: 0 (초기화 완료, Phase 1 진입 직전)
- **completed_tasks**: []
- **blocked_items**: []
- **next_steps**: Phase 1 — 디자인 정제 (검색 인덱싱 전략, 정규식, scrollback dump 포함 여부, MCP tool 노출, threshold 임계값) + architect-reviewer 검증
- **active_worktrees**: []

## Outgoing Teammate Summary
(아직 teammate 없음)

## What Was Completed
- Phase 0: branch 생성, 기록 파일 초기화

## What Remains
- Phase 1: 디자인 brainstorming + architect 리뷰
- Phase 2: 태스크 분해 + DAG + code-reviewer 리뷰
- Phase 3: 구현 (병렬 worktree)
- Phase 3.5: 통합 병합
- Phase 4: 코드 리뷰
- Phase 5: 마무리 (테스트 + 머지/PR 결정)

## Gotchas / 컨텍스트
- 메인 베이스에 PR #19 클립보드 fix 머지됨 (`useTerminal.ts` 수정). 이번 작업은 같은 파일 (search bar) 건드릴 수 있어서 충돌 주의.
- 현재 PR 상태:
  - PR #16 (pane metadata) — in review, base `main`
  - PR #17 (events poll) — in review, base `feature/pane-metadata` (stack)
- 외부 툴링 RFC (#15, alphabeen) 진행 중 — Cross-pane search MCP tool로 노출 시 그 RFC와 시너지

## Key Files
- `src/renderer/hooks/useTerminal.ts` — 기존 SearchAddon 통합 위치
- `src/renderer/components/Terminal/` — 검색 bar UI 위치
- `src/main/pipe/handlers/` — 새 RPC handler 위치
- `src/mcp/index.ts` — MCP tool 노출 위치
- `src/shared/rpc.ts` — RPC method union 추가
