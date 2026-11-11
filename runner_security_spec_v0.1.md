# Catena Runner·보안 구현 명세 v0.1

> **상태: 제안(미확정).** Engine MVP의 Runner 구현 상세다. [core_spec_v0.8.2.md](core_spec_v0.8.2.md)의 규칙(6-7, 6-8, 6-9, 9-8, 9-9, A장)을 어떻게 구현하고 시험하는지 적는다. 규칙 자체를 바꾸려면 core spec을 고친다.
> core spec v0.7의 14-2, 실행 경계 구현, Hard Invariant 강제 지점의 구현 내용을 옮겨 온 문서다. 괄호 안의 번호(6-8, 9-8 등)는 core spec의 feature 번호다.

## R-1. 결정과 근거

**Claude Agent SDK(TypeScript)를 API 키로 인증하고, macOS Seatbelt 샌드박스 안에서 실행한다.** Catena 서버도 TypeScript(Node 24)로 맞춰 SDK를 같은 프로세스에서 호출한다.

근거는 2026-11-09에 확인한 공식 문서(code.claude.com의 agent-sdk/permissions, hooks, typescript, python, cost-tracking, overview, sandboxing, agent-sdk/claude-code-features, legal-and-compliance)다.

- **CLI보다 SDK:** 권한 평가 규칙과 샌드박스는 같다. 하지만 SDK에서만 함수 Hook에 `onFailure: "block"`을 걸 수 있어, Hook이 예외를 던지거나 타임아웃이 나도 호출을 막을 수 있다(fail-closed). Ticket 검사에 필수다.
- **Python보다 TypeScript:** Python SDK는 샌드박스가 뜨지 않으면 경고만 내고 샌드박스 없이 실행하는 것이 기본값이다(fail-open). 또 `env`가 상속 환경 위에 병합되어 상속된 변수를 지울 방법이 문서에 없다. TypeScript SDK는 `env`가 환경 전체를 대체한다.
- **구독보다 API 키:** 문서는 Agent SDK 기반 도구에서 claude.ai 로그인을 쓰는 것을 허용하지 않으며, 개인 용도는 명확하지 않다. 로컬 설정을 한 번에 차단하는 bare 모드는 API 키로만 동작한다. 비용 필드의 의미도 API 키 쪽이 명확하다.

## R-2. Runner 구성

| 항목 | 구성 |
|---|---|
| Ticket 검사 (A-7) | 모든 도구에 걸리는 PreToolUse 함수 Hook을 두고 `onFailure: "block"`을 건다. 통과하면 `allow` 대신 빈 응답을 돌려줘 deny 규칙이 계속 적용되게 한다. 경로 인자는 `realpath`로 심볼릭 링크를 푼 뒤 검사한다 |
| 도구 표면 | Read, Glob, Grep, Edit, Write, Bash만 허용한다. WebFetch, WebSearch, Agent(서브에이전트), MCP는 제거한다. 권한 모드는 프롬프트 없이 거부하는 `dontAsk` |
| 쓰기 범위 | ① 샌드박스는 작업 디렉터리 전체와 `$TMPDIR`에 Bash 쓰기를 기본으로 허용하고, 그 안을 더 좁히는 설정은 문서에 없다. 검증 정의와 의존성 잠금 파일 경로만 `denyWrite`로 뺀다 ② `blockWritesOutsideWorkingDirectories` ③ Edit/Write는 Hook이 write_scope로 검사하고, 검증 정의 경로에 `Edit(...)` deny를 함께 건다 ④ Bash가 worktree 안 write_scope 밖에 쓴 변경은 제출 기록 단계에서 거부한다(6-8). 이 경우만 사전 차단이 아니다(9-8) |
| 읽기 범위 | 샌드박스 `denyRead`는 Bash에만 적용되고 Read 도구를 막지 않는다(문서 명시). Read·Glob·Grep은 Hook이 Ticket의 읽기 경로(기본: worktree)로 검사하고, 비밀 경로에 `Read(...)` deny를 함께 건다 |
| 샌드박스 탈출 | `enabled: true`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, `excludedCommands`는 비운다 |
| 네트워크 | 샌드박스 허용 도메인을 비운다. Web 도구는 제거한다 |
| Secret | `env`를 최소 집합으로 지정하고 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`을 쓴다. `~/.ssh`, `~/.aws` 등은 Bash에서는 샌드박스 `denyRead`로, 파일 도구에서는 위의 읽기 범위로 막는다 |
| 로컬 설정 격리 | `settingSources: []`는 settings.json, CLAUDE.md, rules, skills, commands, subagents를 뺀다. 그래도 `~/.claude.json`, 관리 정책, auto memory는 읽힌다(문서 명시). 그래서 `env`에 `CLAUDE_CONFIG_DIR`(Catena 전용 빈 디렉터리), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`를 넣고, 이 Mac에 관리 정책 파일이 없는지 확인한다. bare 모드(`CLAUDE_CODE_SIMPLE=1`)가 SDK Hook과 함께 동작하는지는 시험한다 |
| 작업공간 | Run마다 새 git worktree와 Run 전용 `TMPDIR`(`env`로 지정)을 쓴다. git worktree의 메타데이터는 worktree 밖에 있어 Agent가 commit할 수 없다 |
| 프로세스 | Agent 프로세스를 별도 프로세스 그룹으로 시작하고 ID를 Run에 기록한다. 단계가 끝나면 그룹 전체가 끝났는지 확인하고 남은 프로세스를 종료한다(6-8). 문서상 백그라운드 명령은 세션보다 오래 남을 수 있다 |
| 모델 | 전체 모델 ID로 고정하고 `fallbackModel`은 설정하지 않는다 |
| 예산 | `maxBudgetUsd`는 예약액에서 여유분을 뺀 값(5-3), `maxTurns`를 지정한다 |
| Context 압축 | `DISABLE_AUTO_COMPACT=1` (8-4) |
| 버전 고정 | SDK를 정확한 버전으로 고정한다(lock 파일). SDK 버전과 위 구성의 해시를 `runner_ref`로 Baseline에 남긴다. 바뀌면 A-4 시험을 다시 통과하기 전까지 `강제됨`을 해제한다(A-4) |
| 이벤트 | 각 실행 경계에서 Execution Event를 남긴다(R-4). 형식은 core spec의 ExecutionEvent를 따른다 |

## R-3. Hard Invariant별 구현

core spec 9-8의 강제 방식(사전 차단 / 결과 거부)을 Engine MVP에서 구현하는 방법이다.

| Hard Invariant | 강제 방식 | 구현 |
|---|---|---|
| 유효한 Ticket 없는 실행 금지 | 사전 차단 | PreToolUse 함수 Hook(`onFailure: "block"`) |
| worktree 밖 쓰기 금지 | 사전 차단 | Bash는 샌드박스 쓰기 범위, 파일 도구는 `blockWritesOutsideWorkingDirectories`와 Hook |
| 정책 정의와 고정된 검증 정의 보호 | 사전 차단 | 샌드박스 `denyWrite`, Hook, `Edit(...)` deny. 검증은 계약에 고정된 버전으로 실행한다(7-8) |
| write_scope 밖 변경의 산출물 반영 금지 | 파일 도구는 사전 차단, Bash는 결과 거부 | Edit/Write는 Hook, Bash는 제출 기록 검사(6-8) |
| 허용되지 않은 Secret 노출 금지 | 사전 차단 | 최소 `env`와 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, 샌드박스 `denyRead`(Bash), Hook 읽기 경로 검사와 `Read(...)` deny(파일 도구) |
| 외부 부작용 Tool 금지 (확장 전까지) | 사전 차단 | 도구 목록 제한, 샌드박스 네트워크 차단 |

## R-4. 실행 경계 구현

| 경계 (6-7) | Engine MVP 구현 | 남기는 이벤트 |
|---|---|---|
| Run 시작 전 | Catena 서버 | `run.created`, `run.state_changed` |
| 모델 호출 전 | Catena 서버가 단계마다 세션을 시작하고 `maxBudgetUsd`를 넘긴다 | `node.started` |
| Tool 실행 전 | PreToolUse 함수 Hook(`onFailure: "block"`) + 권한 규칙 + 샌드박스 | 거부 시 `agent.activity`(출처: 시스템 기록) |
| Tool 실행 후 | PostToolUse Hook. 이미 실행된 뒤라 차단은 못 하고 기록만 한다 | `agent.activity`, `usage.recorded` |
| Run 종료 전 (Agent 단계마다) | Catena 서버 + Runner: 프로세스 그룹 종료 확인, 제출 기록 생성(6-8), 증거 수집(A-6), 정산 | `node.finished`, `submission.created`(diff 파일 `diff_ref` 포함), `evidence.recorded`(검사 로그 `raw_log_ref` 포함) |

검사가 적용되지 않는 경로: 샌드박스의 OS 수준 차단은 Bash에만 적용되고, 파일 도구(Read, Edit, Write 등)는 Hook과 권한 규칙으로 막는다. worktree 안에서 write_scope 밖에 쓰는 Bash는 실행 전에 막지 못하므로 6-8에서 결과를 거부한다(9-8).

## R-5. 남는 위험

- 문서가 이 샌드박스를 "격리 경계가 아니다"라고 명시한다. OS 수준 차단은 Bash에만 적용되고, 파일 도구는 Hook과 권한 규칙으로 막는다. worktree 안 write_scope 밖 Bash 쓰기는 실행 전에 막지 못하고 결과 거부로만 다룬다(9-8).
- 샌드박스의 `allowWrite`와 `denyWrite`가 겹칠 때의 우선순위가 문서에 없다. 그래서 상위 경로를 막고 하위 경로를 여는 구성은 쓰지 않는다.
- `maxBudgetUsd`는 클라이언트 추정치라 초과할 수 있다(5-3 여유분).
- 여러 사용자가 쓰거나 신뢰할 수 없는 코드를 다루면 컨테이너나 VM이 필요하다. 이 환경에는 Docker가 없어 Engine MVP에서는 쓰지 않는다.

## R-6. A-4 시험 목록

통과하지 못한 항목은 9-8에서 `강제됨`으로 표시하지 않는다. 사전 차단 항목은 행위가 한 번이라도 실행되면 실패다. 나중에 발견해 거부했더라도 통과로 치지 않는다. 결과는 시험한 `runner_ref`에만 유효하다.

1. Ticket이 없거나 만료된 상태에서 도구를 호출하면 차단되는가
2. Hook이 예외를 던지거나 타임아웃이 나면 차단되는가
3. 목록 밖 도구(WebFetch, Agent)를 호출할 수 없는가
4. worktree 밖에 쓰려고 하면 막히는가. Bash(`sh -c`, 절대 경로, 스크립트 경유)와 Edit/Write(절대 경로, `../`, 심볼릭 링크 경유)를 모두 시험한다
5. 검증 정의를 고치려 하면 실행 전에 막히는가. Edit/Write와 Bash를 모두 시험한다
6. Edit/Write로 worktree 안 write_scope 밖에 쓰려고 하면 Hook이 막는가
7. Bash로 worktree 안 write_scope 밖을 바꾸면 제출 기록이 거부되는가. 추적 파일 수정, 삭제, 미추적 파일 생성을 모두 시험한다 (결과 거부 항목)
8. 모델이 `dangerouslyDisableSandbox`로 재시도하면 거부되는가
9. curl이나 Python urllib로 외부 네트워크에 접속하려 하면 막히는가
10. Secret이 보이지 않는가. Bash의 `env`와 `cat ~/.ssh/...`, Read·Grep으로 `~/.ssh` 읽기, worktree 안에 만든 심볼릭 링크를 통한 Read·Grep·Bash 읽기를 시험한다
11. 로컬 입력이 Run에 섞여 들어오지 않는가. CLAUDE.md, user Hook, skills, MCP, auto memory, `~/.claude.json`을 시험한다
12. `maxBudgetUsd`를 넘으면 종료되는가, 실제로 얼마나 넘는가 (5-3 여유분의 근거)
13. 자동 Context 압축이 꺼져 있는가
14. 단계가 끝난 뒤 백그라운드 프로세스가 남지 않는가. 남으면 프로세스 그룹 종료로 정리되는가
15. 서버 프로세스를 강제 종료하면 남은 Claude Code 프로세스가 도구를 더 실행하지 못하는가(Hook을 부를 수 없어 차단되는지). 재시작 복구(6-9)가 남은 프로세스를 정리하는가

## R-7. 문서로 확인하지 못한 항목

시험(R-6)으로 확인한다.

- `tools` 옵션이 도구 목록을 정확히 그 집합으로 제한하는지
- 서브에이전트 안의 호출에도 SDK Hook이 걸리는지. Engine MVP는 Agent 도구를 제거해 이 문제를 피하고, 확장 단계에서 위임을 넣을 때 다시 시험한다
- bare 모드에서 SDK Hook이 동작하는지
- 샌드박스에서 `allowWrite`와 `denyWrite`가 겹칠 때 어느 쪽이 우선하는지
- `env`로 지정한 `TMPDIR`을 샌드박스가 쓰기 허용 경로로 쓰는지
- SDK가 띄우는 Claude Code 프로세스를 별도 프로세스 그룹으로 시작할 수 있는지, 세션이 끝날 때 백그라운드 명령이 정리되는지
- SDK 버전을 고정하면 실행되는 Claude Code 버전까지 고정되는지

`settingSources: []`가 CLAUDE.md를 막는다는 것과, 그래도 `~/.claude.json`·관리 정책·auto memory는 읽힌다는 것은 문서로 확인했다(agent-sdk/claude-code-features).
