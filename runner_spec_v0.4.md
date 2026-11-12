# Catena Runner 명세 v0.4

> **상태: 제안(미확정).** [core_spec_v0.10.md](core_spec_v0.10.md)(이하 Core 명세)에 맞춰 v0.3([runner_security_spec_v0.3.md](runner_security_spec_v0.3.md))에서 실행 통제를 뺐다: Hard Invariant 강제, A-4 시험, 샌드박스, 도구 호출마다의 Ticket 검사, 로컬 설정 격리, Runtime 버전 재검증(Core 명세 0-5, 2026-11-12 사용자 결정). 남은 것은 Agent Runtime을 띄우고, 출력을 기록·정규화하고, 프로세스를 정리하고, 인증 규칙을 지키는 일이다. 규칙 자체는 Core 명세가 정한다. 괄호 안 번호(6-8, A-1 등)는 Core 명세의 feature 번호다.

## R-1. 결정

1. **Runner 층은 공급자 중립이다.** Core와 화면은 어떤 Agent Runtime이 실행했는지 모른다. Runner 밖으로 나가는 것은 ExecutionEvent뿐이다(A-1).
2. **Runner는 Agent의 행위를 막지 않는다.** Agent는 사용자의 Runtime 설정 그대로 실행하고, 지켜보는 사람이 없을 때 묻는 호출을 어떻게 할지는 Project 설정의 권한 모드로 정한다(0-5). Catena는 샌드박스, 도구 제한, 도구 호출 검사, 설정 격리를 구성하지 않는다.
3. **Engine MVP의 Runtime은 공식 Claude Code CLI다.** Orchestrator가 단계마다 `claude -p`를 자식 프로세스로 띄운다. Agent SDK와 ACP 어댑터는 쓰지 않는다(Core 명세 14-2).
4. **인증은 사용자의 것을 그대로 쓰고 공급자의 공식 정책을 따른다.** Catena는 자격증명을 읽거나 저장하거나 전달하지 않는다(R-8).

## R-2. 용어

| 용어 | 뜻 |
|---|---|
| Agent Runtime | 실제로 코드를 읽고 쓰는 Coding Agent 프로그램(Claude Code CLI, Codex CLI, OpenCode 등) |
| Runner | Catena 쪽 연결부. Runtime 하나를 띄우는 실행 명세(LaunchSpec)를 만들고, 출력을 ExecutionEvent로 바꾼다. Runtime 종류마다 하나 |
| Orchestrator | Run을 감독하는 Catena 프로세스 역할. 감독 임대(6-10)를 가진 프로세스가 Runner를 부르고, 변환된 이벤트를 Core 명령으로 기록하고, 다른 인터페이스에서 취소된 Run을 끝낸다 |
| `runner_ref` | Runner 종류와 Runtime 버전. 어떤 도구로 실행했는지 남기는 기록이며 실행 허가 조건이 아니다 |
| 권한 모드 | Runtime이 사용자에게 물어야 하는 호출을 지켜보는 사람이 없을 때 어떻게 처리할지. Project 설정 |

## R-3. 공통 요건 (모든 Runner)

| # | 요건 | 지키는 규칙 |
|---|---|---|
| 1 | **비대화 실행.** 사람이 지켜보지 않아도 단계 하나를 끝까지 실행하고 종료 코드와 결과를 낸다 | 6-3 |
| 2 | **실행 중 출력.** 도구 호출·결과·메시지·사용량을 실행 중에 기계가 읽을 수 있는 형식으로 낸다. 낼 수 없는 항목은 Capability에 `불가`로 적는다 | C-9 |
| 3 | **원문 보존.** Runtime 출력 원본을 transcript로 `artifacts/sha256/`에 남긴다 | 0-8, B-2 |
| 4 | **출처 구분.** Catena가 직접 본 것(프로세스 시작·종료, 종료 코드, 제출 기록)만 시스템 기록이다. Runtime 출력에 담긴 것은 Agent 보고이며 증거가 아니다(R-7) | 0-4 |
| 5 | **프로세스 그룹.** Runtime을 새 프로세스 그룹으로 띄우고 그룹 ID와 시작 시각을 Run에 기록한다. 단계가 끝나거나 취소되면 그룹 전체가 끝났는지 확인하고 남은 프로세스를 종료한다 | 6-8, 6-9, 6-10 |
| 6 | **작업공간.** Run마다 새 git worktree와 Run 전용 `TMPDIR`. 이전 worktree는 다시 쓰지 않는다. Agent가 밖에 쓰는 것은 막지 않는다 | A-5 |
| 7 | **사용자 설정과 권한 모드.** 사용자의 Runtime 설정을 그대로 쓰고, Project 설정의 권한 모드를 넘긴다. 권한 모드가 정해지지 않은 Project에서는 착수하지 않고 사용자에게 고르게 한다 | 0-5 |
| 8 | **모델 지정.** Ticket `profile`의 모델을 전체 ID로 넘긴다. 실제로 쓴 모델은 Runtime 출력에서 읽어 기록한다 | 5-2 |
| 9 | **상한 전달.** 턴 수와(API 과금이면) 비용 상한을 넘길 수 있으면 넘긴다. 비용 상한이 클라이언트 추정치면 예약액보다 여유분만큼 낮게 준다. 넘길 수 없으면 Catena가 단계 경계에서 멈춘다 | 5-3, 5-6 |
| 10 | **자격증명 비취급.** Runtime이 자기 저장소에서 자격증명을 읽는다. Catena는 그 값을 읽거나 저장하거나 전달하지 않는다 | 9-9, R-8 |
| 11 | **버전 기록.** Runtime 버전을 `runner_ref`로 Baseline에 남긴다. 버전이 바뀌어도 실행을 막지 않는다 | D-3 |

## R-4. Runner 인터페이스

Engine MVP Runner가 어차피 해야 하는 일을 함수로 나눈 것이다. 두 번째 Runtime도 같은 함수를 구현한다. 플러그인 탐색이나 동적 등록은 두지 않는다.

| 함수 | 입력 → 출력 | 하는 일 |
|---|---|---|
| `prepare` | Ticket, Baseline, 작업공간, Project 설정 → LaunchSpec | argv, 작업 디렉터리, `TMPDIR`, 권한 모드를 정한다 |
| `start` | LaunchSpec → 실행 핸들 | 새 프로세스 그룹으로 띄우고 그룹 ID, 시작 시각, (있으면) Runtime 세션 ID를 돌려준다 |
| `events` | 실행 핸들 → 이벤트 초안의 흐름 | Runtime 출력을 R-7 규칙으로 바꾸고 원본을 transcript에 덧붙인다 |
| `stop` | 실행 핸들, 이유 → 종료 확인 | 프로세스 그룹 전체를 끝내고 끝났는지 확인한다 |
| `result` | 실행 핸들 → 종료 코드, 사용량(신뢰도 포함), 세션 ID | 정산(5-3)과 사용량 기록(5-7)의 입력 |
| `capabilities` | — → Capability 기록 | R-5 형식 |

v0.3의 `checkTool`(도구 호출 검사)은 없앴다.

## R-5. Capability 항목과 수준

Capability는 Catena가 기대는 기능(실행 중 출력, 세션 재개 등)을 쓸 수 있는지 판단하는 기록이다. 실행을 허가하는 조건이 아니다.

| 수준 | 뜻 |
|---|---|
| 시험 통과 | 실제 실행으로 확인했다. Catena가 기대는 기능(세션 재개 등)은 이 수준만 쓴다 |
| 문서상 지원 | 공식 문서나 코드에 있지만 실행해 보지 않았다 |
| 관측만 | 일어난 것을 볼 수는 있지만 제어할 수 없다 |
| 불가 | 지원하지 않는다고 확인했다 |
| 미확인 | 확인하지 못했다 |

항목: 시작·종료·중단, Prompt·Context 전달, 구조화된 출력, 이벤트 스트리밍, 세션 재개, 내부 subagent 관측, 모델·effort 설정, 사용량·비용·quota 관측.

## R-6. Claude Code Runner (Engine MVP)

근거는 code.claude.com 문서(headless, cli-reference, settings, env-vars, agent-sdk/typescript)다. 2026-11-11~12에 확인했고, 설치본은 2.1.322다.

### R-6.1 구성

| 항목 | 구성 |
|---|---|
| 실행 | 단계마다 `claude -p --output-format stream-json --verbose --no-session-persistence`를 자식 프로세스로 시작한다. 작업 디렉터리는 Run의 worktree, prompt는 stdin으로 넘긴다. `--no-session-persistence`는 Catena의 실행이 사용자의 세션 목록에 쌓이지 않게 한다. 원본은 Catena가 transcript로 남긴다 |
| 설정 | 사용자의 Claude Code 설정(user·project·local, CLAUDE.md, hook, MCP, 플러그인)을 그대로 읽는다. Catena는 `--settings`로 덮어쓰지 않고 `--tools`로 줄이지 않는다 |
| 권한 모드 | `--permission-mode <Project 설정>`. 값은 Claude Code가 받는 모드 중에서 사용자가 고른다(예: `acceptEdits`, `auto`, `bypassPermissions`, `dontAsk`). `-p`에서는 묻는 호출에 답할 사람이 없으므로, 고른 모드에 따라 그 호출이 거부되거나 자동 승인된다. Catena가 기본값을 정하지 않는다 |
| 모델 | `--model`에 전체 모델 ID를 준다. 사용자가 설정한 대체 모델은 그대로 두고, 실제로 쓴 모델은 `system/init`와 `result`의 `modelUsage`에서 읽어 `node.started.profile`에 남긴다 |
| 예산 | `--max-turns`를 준다. API 키 인증이면 `--max-budget-usd`를 예약액에서 여유분을 뺀 값으로 준다. 이 값은 클라이언트 추정치라 넘을 수 있다(5-3). 구독 인증이면 비용 상한을 쓰지 않고, `rate_limit_event`로 한도 소진을 판단한다(5-1, 5-6) |
| 환경 변수 | 사용자 환경을 그대로 상속한다. Catena가 바꾸는 것은 Run 전용 `TMPDIR`과 백그라운드 대기 상한(`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`)뿐이다. 문서상 턴이 끝난 뒤 백그라운드 작업을 최대 10분 기다릴 수 있어서 짧게 준다 |
| 프로세스 | Orchestrator가 CLI를 `detached`로 띄워 새 프로세스 그룹을 만들고, 그 ID와 시작 시각을 Run에 기록한다. 단계가 끝나면 그룹 전체가 끝났는지 확인하고 남은 프로세스를 종료한다(6-8). 중단·취소할 때는 SIGINT로 턴을 끝내게 하고, 끝나지 않으면 SIGTERM(문서상 exit 143, 진행 중인 Bash 프로세스 트리 종료, 그 턴의 result는 남지 않음), 마지막으로 그룹을 종료한다 |
| 취소 | 감독 프로세스가 단계 진행 중에도 저장소의 Run 상태를 주기적으로 확인한다. 다른 인터페이스에서 취소되면 위 순서로 그룹을 끝낸다(A-2, 6-10) |
| 버전 | `claude --version`을 `runner_ref`에 남긴다. 실행 허가 조건이 아니다. stream-json 형식이 바뀌어 정규화가 실패하면 그 단계를 `실패`로 끝내고 원본은 transcript에 남는다 |

### R-6.2 Capability (문서상 지원 수준)

| 항목 | 내용 | 근거(code.claude.com/docs/en/) |
|---|---|---|
| 시작·종료·중단 | `claude -p`. SIGINT로 턴 종료, SIGTERM은 exit 143과 Bash 프로세스 트리 종료 | headless |
| Prompt·Context 전달 | 인자, stdin(10MB), `--append-system-prompt-file`. 지시와 자료의 구분은 Catena가 prompt 안에서 한다(8-8) | headless, cli-reference |
| 구조화된 출력 | `--json-schema` → result의 `structured_output` | headless |
| 이벤트 스트리밍 | `stream-json`: `system/init`, `tool_use`/`tool_result`, subagent 메시지(`parent_tool_use_id`), `system/task_started`, `rate_limit_event`, 마지막에 `result` | headless, agent-sdk/typescript |
| 세션 재개 | `--session-id`, `--resume`, `--fork-session`. `--no-session-persistence`를 쓰면 재개할 수 없다. 재개는 확장(6-4)에서 이 옵션과 함께 다시 정한다 | cli-reference |
| 내부 subagent 관측 | stream-json의 `parent_tool_use_id`로 subagent 메시지를 구분한다 | headless |
| 모델·effort | `--model`(전체 ID), `--effort` | cli-reference |
| 사용량·비용·quota | result의 `total_cost_usd`(클라이언트 추정치), `usage`, `modelUsage`. 구독 한도 신호는 `rate_limit_event`(`status`, `resetsAt`, `utilization`) | agent-sdk/typescript |

## R-7. 출력 정규화 (Claude Code stream-json → ExecutionEvent)

Core 명세 ExecutionEvent 절의 정규화 규칙을 따른다. 표에 없는 종류는 이벤트로 만들지 않고 transcript에만 남긴다.

| stream-json | ExecutionEvent | `source` | 공식 상태에 주는 영향 |
|---|---|---|---|
| (프로세스 시작) | `node.started`(`profile{runtime: "claude-code", model, effort}`) | 시스템 기록 | 노드 시작 |
| `system/init` | `node.started`의 `profile.model` 보강, 세션 ID 기록 | 시스템 기록 | 없음 |
| `assistant`의 `tool_use`, `user`의 `tool_result` | `agent.activity`(도구 호출) | Agent 보고 | 없음 |
| `assistant`의 글 | `agent.activity`(메시지) | Agent 보고 | 없음. "테스트 통과" 같은 보고는 증거가 아니다(0-4) |
| `parent_tool_use_id`가 있는 메시지 | 확장 단계에서 `agent.activity`(하위 Agent). Engine MVP는 노드 하나의 활동으로 둔다 | Agent 보고 | 없음 |
| `rate_limit_event` | 사용 한도 신호(5-6의 입력). `rejected`면 다음 단계 경계에서 멈춘다 | 시스템 기록(Runtime이 공급자에게서 받은 값) | 신규 착수와 새 단계 |
| `result` | `usage.recorded`(`reliability: 추정값`), `node.finished`의 결과 | 사용량은 신뢰도로 표시(5-7) | 정산 |
| (프로세스 종료, 종료 코드) | `node.finished`, 필요하면 `run.state_changed` | 시스템 기록 | Run 상태 |

## R-8. 인증과 공급자 정책

**공통 규칙**
- Catena 코드와 Catena를 만드는 작업자는 자격증명을 읽거나 저장하거나 입력하거나 전달하지 않는다. Runtime은 자기 저장소에서 자격증명을 읽는다.
- 인증 방식은 두 가지 중 사용자가 고른다: 사용자가 그 Runtime에 직접 로그인한 상태(구독), 또는 사용자가 설정한 API 키. 사용자 환경을 그대로 상속하므로 별도 로그인이나 설정 폴더는 필요 없다.
- 구독으로 자동 실행해도 되는지는 공급자의 공식 정책으로만 판단한다. 정책 문구와 확인 날짜를 아래 표에 남기고, 바뀌면 다시 확인한다.
- Catena를 다른 사람에게 제공하면, 공급자 정책이 따로 허용하지 않는 한 API 키 인증으로 바꾼다.
- 자원 정책(5-1)은 인증 방식에 따라 다르게 동작한다: API 과금이면 금액 예약, 구독이면 한도 소진을 5-6으로 처리한다.

**공급자별 (2026-11-11 확인)**

| Runtime | 인증 | 공식 정책 요지 | 근거 | Catena의 처리 |
|---|---|---|---|---|
| Claude Code CLI | 본인 구독 로그인 또는 API 키 | 제품·서비스 개발자가 자기 앱에서 claude.ai 로그인을 제공하는 것, 사용자를 대신해 구독 자격증명으로 요청을 보내는 것, 자격증명을 모으거나 저장하거나 중개하는 것을 허용하지 않는다. 구독 사용 한도는 개인의 일반적 사용을 전제로 한다. Agent SDK 기반 제3자 제품의 claude.ai 로그인 제공은 사전 승인 없이 허용되지 않는다 | code.claude.com의 legal-and-compliance, agent-sdk/overview | 사용자가 자기 머신에서 직접 로그인한 공식 `claude`를 Catena가 띄우고 자격증명을 다루지 않는 구조가 정책에 맞는다는 것은 해석(추정)이다. 그래서 자격증명을 다루지 않고, 남에게 제공하기 전에는 API 키로 바꾸거나 Anthropic에 확인한다 |
| Codex CLI | ChatGPT 로그인 또는 API 키(`CODEX_API_KEY`) | 공식 인증 문서가 CI/CD 같은 프로그램 실행에는 API 키 인증을 쓰라고 한다. 제3자 도구가 사용자 본인의 ChatGPT 로그인으로 CLI를 띄워도 되는지는 찾지 못했다 | learn.chatgpt.com/docs/auth | API 키를 기본으로 한다. 구독 경로는 정책을 확인한 뒤에 연다 |
| OpenCode | 공급자별 API 키, 공급자 로그인, "Claude Agent" provider | 자체 구독은 없고 공급자 정책을 따른다. Claude Agent provider 경로가 Anthropic 정책에 맞는지는 공식 판단을 찾지 못했다 | opencode.ai/docs | Anthropic 모델은 API 키 경로로만 쓴다 |
| Gemini CLI | Google 로그인, Gemini API 키, Vertex | 개인 구독 경로는 2026-06-18에 끝났고 유료 API 키 경로는 유지된다는 공지 | developers.googleblog.com 공지 | 붙인다면 API 키 경로뿐이다 |

## R-9. 다른 Agent Runtime (확장)

두 번째 Runtime을 고르는 기준은 R-3의 1~3(비대화 실행, 실행 중 출력, 원문 보존)과 인증 정책(R-8)이다. v0.3의 판정(Codex·Gemini CLI의 hook fail-open, OpenCode의 샌드박스 없음)은 실행 통제를 전제로 한 것이라 더 이상 배제 사유가 아니다. 2026-11-11 문서 조사 기준 Codex CLI(`codex exec --json`)와 OpenCode(`opencode run --format json`, SSE)는 비대화 실행과 JSON 이벤트를 낸다. 실제 연결은 Core 명세 14-14에서 정하며, 붙이기 전에 R-5 Capability를 채운다.

## R-10. 남는 위험

- **Agent의 행위를 막지 않는다(0-5).** Catena가 띄운 Agent는 사용자의 Agent가 할 수 있는 일을 모두 할 수 있다: worktree 밖 파일 수정, push, 사용자 환경의 Secret 읽기, Project 저장소 파일 수정. 막아야 하는 행위는 Agent Runtime의 권한 설정과 권한 모드로 막는다. 지켜보는 사람 없이 여러 Run을 돌리면 권한 모드의 선택이 곧 위험의 크기다.
- **승인 채널을 흉내 낼 수 있다.** 같은 사용자 권한으로 도는 Agent는 `catena approve`를 실행하거나 Web UI 요청을 만들 수 있다. 대화형 채널 확인(TTY, 9-10)만으로는 막지 못한다(pty를 만드는 명령이 있다). 대응은 Core 명세 14-15에서 Engine MVP 승인 구현 전에 정한다.
- **도구 호출 기록은 Runtime의 보고다.** Catena가 실행 전에 보거나 막은 것이 아니므로 Agent 보고로 표시한다. Runtime이 출력하지 않은 행위는 기록에 없다.
- `--max-budget-usd`는 클라이언트 추정치라 넘을 수 있다(5-3 여유분).
- 구독 인증이면 비용 상한을 걸 수 없고, 사용 한도에 걸리면 Run이 단계 경계에서 멈춘다(5-6). 여러 Run을 계속 돌리면 개인의 일반적 사용을 전제로 한 한도에 걸릴 수 있다.
- 본인 구독으로 본인 도구를 자동 실행하는 경우를 문서가 명시적으로 허용하지는 않는다. 문서가 바뀌면 R-8을 다시 확인한다.
- 사용자 설정을 그대로 쓰므로, 사용자의 설정이 바뀌면 같은 계약이라도 Run의 동작이 달라질 수 있다. Catena는 그 설정을 기록하지 않는다(`runner_ref`에는 Runtime 버전만 있다).
