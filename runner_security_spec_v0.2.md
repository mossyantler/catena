# Catena Runner·보안 구현 명세 v0.2

> **상태: 제안(미확정).** Engine MVP의 Runner 구현 상세다. [core_spec_v0.8.3.md](core_spec_v0.8.3.md)의 규칙(6-7, 6-8, 6-9, 9-8, 9-9, A장)을 어떻게 구현하고 시험하는지 적는다. 규칙 자체를 바꾸려면 core spec을 고친다.
> v0.1(Claude Agent SDK를 서버에 넣는 방식)에서 공식 Claude Code CLI를 자식 프로세스로 실행하는 방식으로 바꿨다. 괄호 안의 번호(6-8, 9-8 등)는 core spec의 feature 번호다.

## R-1. 결정과 근거

**Catena 서버가 Run의 Agent 단계마다 공식 Claude Code CLI를 헤드리스 모드(`claude -p`)의 자식 프로세스로 띄우고, Claude Code 샌드박스(macOS Seatbelt) 안에서 실행한다. Agent SDK는 쓰지 않는다.** Catena 서버는 TypeScript(Node 24)다.

근거는 2026-11-11에 확인한 공식 문서(code.claude.com의 cli-reference, hooks, settings, legal-and-compliance, agent-sdk/overview)다. 권한 평가 규칙, 샌드박스, 설정 격리는 v0.1에서 agent-sdk/permissions, sandboxing, agent-sdk/claude-code-features로 확인한 내용을 이어 쓴다. 이 기능들은 SDK와 CLI가 같은 Claude Code 기능이다.

- **SDK 대신 CLI:**
  - v0.1이 SDK를 고른 이유는 "Hook이 실패해도 호출을 막는 설정(fail-closed)은 SDK에서만 된다"였다.
  - 지금 문서는 CLI의 command·http hook에도 `onFailure: "block"`을 둔다(Claude Code v2.1.295 이상). hook이 연결에 실패하거나, 2xx가 아닌 응답을 받거나, 시간이 초과되거나, 잘못된 출력을 내면 호출을 막는다.
  - CLI를 쓰면 라이브러리 의존이 없다.
  - Catena가 프로세스를 직접 띄우므로 프로세스 그룹, 환경 변수, 작업 디렉터리를 직접 정한다.
  - 다른 CLI Agent도 같은 방식(자식 프로세스 + 출력 변환)으로 붙일 수 있다(R-8).
- **CLI로 바꿔서 달라지는 것:**
  - Ticket 검사 Hook이 서버 안의 함수가 아니라 서버 로컬 엔드포인트에 보내는 HTTP 요청이 된다.
  - 서버가 멈추면 Hook 요청이 실패하고, `onFailure: "block"` 때문에 도구 호출이 막힌다(R-6 15).
- **인증은 사용자 본인의 것을 그대로 쓴다:**
  - 사용자가 직접 로그인한 CLI 자격증명(본인 구독)이나 사용자가 설정한 API 키를 쓴다.
  - legal-and-compliance가 금지하는 것은 다음 세 가지다. 제품·서비스를 만드는 개발자가 자기 앱에서 claude.ai 로그인을 제공하는 것, 사용자를 대신해 구독 자격증명으로 요청을 보내는 것, 자격증명을 모으거나 저장하거나 중개하는 것.
  - 본인 구독으로 본인 도구를 쓰는 경우는 문서가 따로 다루지 않는다. 구독의 사용 한도는 "ordinary, individual usage of Claude Code and the Agent SDK"를 전제로 한다.
  - 그래서 Catena는 자격증명을 읽거나 저장하거나 전달하지 않는다.
  - Catena를 다른 사람에게 제공하면 API 키 인증으로 바꾼다(문서 명시).

## R-2. Runner 구성

| 항목 | 구성 |
|---|---|
| 실행 | 단계마다 `claude -p --output-format stream-json --verbose`를 자식 프로세스로 시작한다. 작업 디렉터리는 Run의 worktree다. Catena가 Run마다 만든 설정 파일을 `--settings`로 넘긴다. 아래 Hook, 권한 규칙, 샌드박스 설정은 모두 이 파일에 담는다 |
| Ticket 검사 (A-7) | 모든 도구에 걸리는 PreToolUse **http hook**을 두고 `onFailure: "block"`을 건다. Hook은 Catena 서버의 로컬 엔드포인트(127.0.0.1)에 묻는다. 요청 헤더에는 Run 식별 토큰을 담아 어느 Ticket으로 검사할지 정한다. 통과하면 `allow` 대신 빈 응답을 돌려줘 deny 규칙이 계속 적용되게 한다. 경로 인자는 `realpath`로 심볼릭 링크를 푼 뒤 검사한다 |
| 도구 표면 | `--tools "Read,Glob,Grep,Edit,Write,Bash"`로 내장 도구를 이 집합으로 제한한다. MCP는 `--strict-mcp-config`를 주고 MCP 설정을 넘기지 않아 뺀다. 권한 모드는 프롬프트 없이 거부하는 `--permission-mode dontAsk` |
| 쓰기 범위 | ① 샌드박스는 작업 디렉터리 전체와 `$TMPDIR`에 Bash 쓰기를 기본으로 허용하고, 그 안을 더 좁히는 설정은 문서에 없다. 검증 정의와 의존성 잠금 파일 경로만 `denyWrite`로 뺀다 ② `blockWritesOutsideWorkingDirectories` ③ Edit/Write는 Hook이 write_scope로 검사하고, 검증 정의 경로에 `Edit(...)` deny를 함께 건다 ④ Bash가 worktree 안 write_scope 밖에 쓴 변경은 제출 기록 단계에서 거부한다(6-8). 이 경우만 사전 차단이 아니다(9-8) |
| 읽기 범위 | 샌드박스 `denyRead`는 Bash에만 적용되고 Read 도구를 막지 않는다(문서 명시). Read·Glob·Grep은 Hook이 Ticket의 읽기 경로(기본: worktree)로 검사하고, 비밀 경로에 `Read(...)` deny를 함께 건다 |
| 샌드박스 탈출 | `enabled: true`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, `excludedCommands`는 비운다 |
| 네트워크 | 샌드박스 허용 도메인을 비운다. Web 도구는 도구 표면에서 뺀다 |
| Secret | 자식 프로세스의 환경 변수를 최소 집합으로 지정한다. Node `child_process.spawn`의 `env`는 상속 환경을 대체한다. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`을 쓴다. `~/.ssh`, `~/.aws` 등은 Bash에서는 샌드박스 `denyRead`로, 파일 도구에서는 위의 읽기 범위로 막는다. 구독 자격증명은 CLI가 자기 저장소에서 읽고, Catena는 그 값을 다루지 않는다 |
| 로컬 설정 격리 | ① `--setting-sources`로 user·project·local 설정 파일을 읽지 않게 하고, Catena 설정은 `--settings`로만 넣는다 ② 환경 변수에 `CLAUDE_CONFIG_DIR`(Catena 전용 디렉터리), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`를 넣고, 이 Mac에 관리 정책 파일이 없는지 확인한다 ③ `--safe-mode`는 Hook까지 끄므로 쓰지 않는다. `--bare`는 Hook 자동 탐색을 건너뛰므로, `--settings`로 넣은 Hook이 유지되는지 확인하기 전에는 쓰지 않는다 ④ `--restricted`(관리 설정과 `--settings`만 읽는다)는 시험한 뒤 쓸지 정한다(R-7) |
| 작업공간 | Run마다 새 git worktree와 Run 전용 `TMPDIR`(환경 변수로 지정)을 쓴다. git worktree의 메타데이터는 worktree 밖에 있어 Agent가 commit할 수 없다 |
| 프로세스 | Catena가 CLI를 `detached`로 띄워 새 프로세스 그룹을 만들고 그 ID를 Run에 기록한다. 단계가 끝나면 그룹 전체가 끝났는지 확인하고 남은 프로세스를 종료한다(6-8). 문서상 백그라운드 명령은 세션보다 오래 남을 수 있다 |
| 모델 | `--model`에 전체 모델 ID를 준다. `--fallback-model`은 주지 않고, 설정의 `fallbackModel`도 비운다 |
| 예산 | `--max-turns`를 지정한다. API 키 인증이면 `--max-budget-usd`를 예약액에서 여유분을 뺀 값으로 준다(5-3). 구독 인증이면 비용 상한을 쓰지 않고, 사용 한도에 걸리면 5-6 규칙대로 멈춘다(5-1) |
| Context 압축 | `DISABLE_AUTO_COMPACT=1` (8-4) |
| 버전 고정 | Claude Code CLI를 정확한 버전으로 설치하고 자동 업데이트를 끈다. v2.1.295 이상이어야 한다(`onFailure`). CLI 버전과 위 구성의 해시를 `runner_ref`로 Baseline에 남긴다. 둘 중 하나라도 바뀌면 A-4 시험을 다시 통과하기 전까지 `강제됨`을 해제한다(A-4) |
| 이벤트 | Runner가 stream-json 출력과 Hook 요청을 ExecutionEvent로 바꾼다(R-4). CLI 출력 형식은 Runner 밖으로 내보내지 않는다(A-1). Hook 판정, 프로세스 종료, 제출 기록의 출처는 `시스템 기록`이고, 모델이 출력한 메시지의 출처는 `Agent 보고`다. 원본 출력은 transcript로 `artifacts/sha256/`에 저장한다(14-3) |

## R-3. Hard Invariant별 구현

core spec 9-8의 강제 방식(사전 차단 / 결과 거부)을 Engine MVP에서 구현하는 방법이다.

| Hard Invariant | 강제 방식 | 구현 |
|---|---|---|
| 유효한 Ticket 없는 실행 금지 | 사전 차단 | PreToolUse http hook(`onFailure: "block"`) |
| worktree 밖 쓰기 금지 | 사전 차단 | Bash는 샌드박스 쓰기 범위, 파일 도구는 `blockWritesOutsideWorkingDirectories`와 Hook |
| 정책 정의와 고정된 검증 정의 보호 | 사전 차단 | 샌드박스 `denyWrite`, Hook, `Edit(...)` deny. 검증은 계약에 고정된 버전으로 실행한다(7-8) |
| write_scope 밖 변경의 산출물 반영 금지 | 파일 도구는 사전 차단, Bash는 결과 거부 | Edit/Write는 Hook, Bash는 제출 기록 검사(6-8) |
| 허용되지 않은 Secret 노출 금지 | 사전 차단 | 최소 환경 변수와 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, 샌드박스 `denyRead`(Bash), Hook 읽기 경로 검사와 `Read(...)` deny(파일 도구) |
| 외부 부작용 Tool 금지 (확장 전까지) | 사전 차단 | `--tools`로 도구 제한, MCP 제거, 샌드박스 네트워크 차단 |

## R-4. 실행 경계 구현

| 경계 (6-7) | Engine MVP 구현 | 남기는 이벤트 |
|---|---|---|
| Run 시작 전 | Catena 서버 | `run.created`, `run.state_changed` |
| 모델 호출 전 | Catena 서버가 단계마다 CLI 프로세스를 시작한다. API 키 인증이면 `--max-budget-usd`를 넘긴다 | `node.started` |
| Tool 실행 전 | PreToolUse http hook(`onFailure: "block"`) + 권한 규칙 + 샌드박스 | 거부 시 `agent.activity`(출처: 시스템 기록) |
| Tool 실행 후 | PostToolUse http hook. 이미 실행된 뒤라 차단은 못 하고 기록만 한다 | `agent.activity`, `usage.recorded` |
| Run 종료 전 (Agent 단계마다) | Catena 서버 + Runner: 프로세스 그룹 종료 확인, 제출 기록 생성(6-8), 증거 수집(A-6), 정산 | `node.finished`, `submission.created`(diff 파일 `diff_ref` 포함), `evidence.recorded`(검사 로그 `raw_log_ref` 포함) |

검사가 적용되지 않는 경로: 샌드박스의 OS 수준 차단은 Bash에만 적용되고, 파일 도구(Read, Edit, Write 등)는 Hook과 권한 규칙으로 막는다. worktree 안에서 write_scope 밖에 쓰는 Bash는 실행 전에 막지 못하므로 6-8에서 결과를 거부한다(9-8).

## R-5. 남는 위험

- 문서가 이 샌드박스를 "격리 경계가 아니다"라고 명시한다. OS 수준 차단은 Bash에만 적용되고, 파일 도구는 Hook과 권한 규칙으로 막는다. worktree 안 write_scope 밖 Bash 쓰기는 실행 전에 막지 못하고 결과 거부로만 다룬다(9-8).
- 샌드박스의 `allowWrite`와 `denyWrite`가 겹칠 때의 우선순위가 문서에 없다. 그래서 상위 경로를 막고 하위 경로를 여는 구성은 쓰지 않는다.
- `--max-budget-usd`는 클라이언트 추정치라 초과할 수 있다(5-3 여유분).
- 구독 인증이면 비용 상한을 걸 수 없고, 사용 한도에 걸리면 Run이 단계 경계에서 멈춘다(5-6). 여러 Run을 계속 돌리면 "ordinary, individual usage"를 전제로 한 한도에 걸릴 수 있다.
- 본인 구독으로 본인 도구를 자동 실행하는 경우를 문서가 명시적으로 허용하지는 않는다. 문서가 바뀌면 R-1을 다시 확인한다.
- 여러 사용자가 쓰거나 신뢰할 수 없는 코드를 다루면 컨테이너나 VM이 필요하다. 이 환경에는 Docker가 없어 Engine MVP에서는 쓰지 않는다.

## R-6. A-4 시험 목록

- 통과하지 못한 항목은 9-8에서 `강제됨`으로 표시하지 않는다.
- 사전 차단 항목은 행위가 한 번이라도 실행되면 실패다. 나중에 발견해 거부했더라도 통과로 치지 않는다.
- 결과는 시험한 `runner_ref`에만 유효하다.

1. Ticket이 없거나 만료된 상태에서 도구를 호출하면 차단되는가
2. Hook 요청이 실패하면 차단되는가. 서버 엔드포인트 연결 실패, 2xx가 아닌 응답, 시간 초과, 잘못된 응답을 모두 시험한다
3. 목록 밖 도구(WebFetch, Agent)와 MCP 도구를 호출할 수 없는가
4. worktree 밖에 쓰려고 하면 막히는가. Bash(`sh -c`, 절대 경로, 스크립트 경유)와 Edit/Write(절대 경로, `../`, 심볼릭 링크 경유)를 모두 시험한다
5. 검증 정의를 고치려 하면 실행 전에 막히는가. Edit/Write와 Bash를 모두 시험한다
6. Edit/Write로 worktree 안 write_scope 밖에 쓰려고 하면 Hook이 막는가
7. Bash로 worktree 안 write_scope 밖을 바꾸면 제출 기록이 거부되는가. 추적 파일 수정, 삭제, 미추적 파일 생성을 모두 시험한다 (결과 거부 항목)
8. 모델이 `dangerouslyDisableSandbox`로 재시도하면 거부되는가
9. curl이나 Python urllib로 외부 네트워크에 접속하려 하면 막히는가
10. Secret이 보이지 않는가. 다음을 시험한다
    - Bash의 `env`와 `cat ~/.ssh/...`
    - Read·Grep으로 `~/.ssh` 읽기
    - worktree 안에 만든 심볼릭 링크를 통한 Read·Grep·Bash 읽기
    - CLI 자격증명 저장소 읽기
11. 로컬 입력이 Run에 섞여 들어오지 않는가. 사용자 설정, CLAUDE.md, user Hook, skills, MCP, auto memory, `~/.claude.json`을 시험한다
12. API 키 인증에서 `--max-budget-usd`를 넘으면 종료되는가, 실제로 얼마나 넘는가 (5-3 여유분의 근거)
13. 자동 Context 압축이 꺼져 있는가
14. 단계가 끝난 뒤 백그라운드 프로세스가 남지 않는가. 남으면 프로세스 그룹 종료로 정리되는가
15. 서버 프로세스를 강제 종료하면 남은 CLI 프로세스가 도구를 더 실행하지 못하는가(Hook 요청이 실패해 차단되는지). 재시작 복구(6-9)가 남은 프로세스를 정리하는가

## R-7. 문서로 확인하지 못한 항목

시험(R-6)으로 확인한다.

- `onFailure: "block"`이 연결 실패, 2xx가 아닌 응답, 시간 초과, 잘못된 출력에서 모두 차단하는지. 이 세부 동작은 문서 요약으로만 확인했다(시험 2)
- `--tools`가 내장 도구를 정확히 그 집합으로 제한하는지
- `--setting-sources`에 어떤 값을 주면 user·project·local 설정을 모두 빼는지. CLAUDE.md, skills, commands, subagents까지 빠지는지
- `--restricted`가 관리 설정과 `--settings`만 읽는지, `--bare`가 `--settings`로 넣은 Hook까지 끄는지
- `CLAUDE_CONFIG_DIR`을 바꾸면 `~/.claude.json`도 옮겨지는지. 바꾼 디렉터리에서 구독 로그인이 유지되는지, 사용자가 그 디렉터리로 한 번 직접 로그인해야 하는지
- `--max-budget-usd`가 구독 인증에서도 동작하는지
- 서브에이전트 안의 호출에도 Hook이 걸리는지. Engine MVP는 Agent 도구를 빼서 이 문제를 피하고, 확장 단계에서 위임을 넣을 때 다시 시험한다
- 샌드박스에서 `allowWrite`와 `denyWrite`가 겹칠 때 어느 쪽이 우선하는지
- 환경 변수로 지정한 `TMPDIR`을 샌드박스가 쓰기 허용 경로로 쓰는지
- 세션이 끝날 때 백그라운드 명령이 정리되는지

문서로 확인한 것(2026-11-11, cli-reference·hooks·settings)은 다음과 같다.

- CLI 플래그: `--settings`, `--permission-mode`의 `dontAsk`, `--tools`, `--max-turns`, `--max-budget-usd`(API 사용액 추정 기준), `--output-format stream-json`, `--model`, `--fallback-model`, `--strict-mcp-config`
- Hook: command·http hook의 `onFailure`(v2.1.295 이상)
- 환경 변수: `CLAUDE_CONFIG_DIR`

`settingSources: []`가 CLAUDE.md를 막는다는 것, 그래도 `~/.claude.json`·관리 정책·auto memory는 읽힌다는 것은 v0.1에서 SDK 문서로 확인했다. CLI의 `--setting-sources`도 같은지는 위 목록에서 시험한다.

## R-8. 다른 CLI Runner (확장)

- Codex, OpenCode 같은 다른 CLI Agent는 확장 단계에서 Runner로 추가한다. 붙이는 방식은 같다. Catena가 자식 프로세스로 띄우고, Runner가 출력을 ExecutionEvent로 바꾼다.
- Runner마다 R-6과 같은 시험을 따로 통과해야 한다.
- Hard Invariant의 사전 차단 항목을 통과하지 못한 Runner에서는 실행하지 않는다(0-5). 승인으로도 대신할 수 없다. 예를 들어 도구 호출 전에 Catena에 물어볼 수단이 없는 Runner는 Ticket 검사(A-7)를 통과할 수 없으므로 쓸 수 없다.
- Runner별 약관과 인증 조건은 추가할 때 확인한다. 아직 확인하지 않았다.
