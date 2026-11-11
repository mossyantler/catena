# Catena Runner·보안 구현 명세 v0.3

> **상태: 제안(미확정).** [core_spec_v0.9.md](core_spec_v0.9.md)(이하 Core 명세)의 규칙(0-5, 0-9~0-11, 6-7~6-11, 9-8~9-10, A장)을 Runner가 어떻게 구현하고 시험하는지 적는다. 규칙 자체를 바꾸려면 Core 명세를 고친다. 기술 조사 근거는 [orchestration_architecture_review.md](orchestration_architecture_review.md)(이하 검토 문서)에 있다.
> v0.2(Claude Code CLI 전용)를 공급자 중립으로 다시 짰다. 모든 Runner에 공통인 요건(R-3), 최소 인터페이스(R-4), Capability 기록(R-5), 공통 시험(R-6)을 앞에 두고, Engine MVP의 Claude Code Runner(R-7)와 다른 Runtime 후보(R-8)를 뒤에 둔다. v0.2의 R-2~R-4와 R-7은 R-7.1~R-7.5로 옮겼고, A-4 시험 목록은 계속 R-6이다. 괄호 안의 번호(6-8, 9-8 등)는 Core 명세의 feature 번호다.

## R-1. 결정과 근거

1. **Runner 층은 공급자 중립이다.** Core와 화면은 어떤 Agent Runtime이 실행했는지 모른다. Runner 밖으로 나가는 것은 ExecutionEvent와 Ticket 검사 요청뿐이다(A-1).
2. **Hard Invariant의 사전 차단은 Runtime 내부의 도구 호출 전 hook과 OS 샌드박스로만 한다.** MCP, ACP, A2A 같은 프로토콜과 LangGraph 같은 프레임워크는 Runtime 안의 도구 호출을 막지 못한다(검토 문서 1절 3). 그래서 Runner마다 Runtime의 hook과 샌드박스를 Catena가 직접 구성하고 A-4로 시험한다.
3. **Engine MVP의 Runtime은 공식 Claude Code CLI다.** Catena가 Run의 Agent 단계마다 `claude -p`를 자식 프로세스로 띄우고 Claude Code 샌드박스(macOS Seatbelt) 안에서 실행한다. Agent SDK와 ACP 어댑터는 쓰지 않는다(Core 명세 14-2). v0.2의 근거(2026-11-11 확인: CLI의 command·http hook에 `onFailure: "block"`이 있어 fail-closed가 가능하고, 라이브러리 의존 없이 프로세스 그룹·환경 변수·작업 디렉터리를 Catena가 정한다)를 그대로 유지한다. 이번 조사에서 더한 근거: Claude용 ACP 어댑터는 Agent SDK를 감싸고 Claude Code가 ask로 판정한 호출만 Client에 묻는다(검토 문서 3.6).
4. **Runner는 A-4 공통 시험(R-6)을 통과해야 쓴다.** Hard Invariant 항목 하나라도 통과하지 못한 Runner에는 작업을 배정하지 않는다. 경고를 띄우고 실행하는 방식은 없다(0-5).
5. **인증은 사용자 본인의 것을 그대로 쓰고, 공급자의 공식 정책을 따른다.** Catena는 자격증명을 읽거나 저장하거나 전달하지 않는다. 구독 사용이 허용되는지는 실행 방식의 장점으로 정하지 않고 공급자별 공식 정책으로 정한다(R-11).

## R-2. 용어와 구성 요소

| 용어 | 뜻 |
|---|---|
| Agent Runtime | 실제로 코드를 읽고 쓰는 Coding Agent 프로그램(Claude Code CLI, Codex CLI, OpenCode 등). 자기 도구 루프, hook, 샌드박스를 가진다 |
| Runner | Catena 쪽 연결부. Runtime 하나를 띄우는 실행 명세(LaunchSpec)를 만들고, Runtime의 hook 요청을 Ticket 검사로, 출력을 ExecutionEvent로 바꾼다. Runtime 종류마다 하나 |
| Orchestrator | Run을 감독하는 Catena 프로세스 역할. 감독 임대(6-10)를 가진 프로세스가 Runner를 부르고, Ticket 검사 창구를 열고, 변환된 이벤트를 Core 명령으로 기록한다. 전경(`catena run`)과 배경(`catena serve`)이 같은 코드다 |
| Ticket 검사 창구 | Runtime의 도구 호출 전 hook이 묻는 곳. Orchestrator가 127.0.0.1에 연다. Run 식별 토큰으로 어느 Ticket인지 정하고, Ticket 상태는 매번 저장소에서 읽는다(A-7) |
| Session Host | Runtime 프로세스를 사람이 볼 수 있는 터미널에 띄우는 외부 도구(tmux, Herdr). 선택(후속) |
| 외부 실행 엔진 | Runtime 세션을 대신 띄우고 관리하는 외부 Orchestration 엔진(Gas City 등). 지금 쓰지 않는다(Core 명세 14-13) |
| Capability | Runner가 할 수 있는 것과 그 확인 수준(R-5) |
| `runner_ref` | Runner 종류, Runtime 버전, Session Host(쓰면), 유효 구성(LaunchSpec에서 Run마다 바뀌는 값을 뺀 것)의 해시. A-4 결과와 Capability 기록이 이 값에 묶인다 |

## R-3. 공통 요건 (모든 Runner)

Runtime이 아래 수단을 갖추지 못하면 그 Runtime으로는 Runner를 만들 수 없다. "대체"란에 "없음"인 요건은 다른 수단으로 바꿀 수 없다.

| # | 요건 | 지키는 규칙 | 대체 |
|---|---|---|---|
| 1 | **도구 호출 전 외부 질의.** 모든 도구 호출(Runtime 내부 subagent의 호출 포함) 전에 Ticket 검사 창구에 묻고, 질의가 실패하면(연결 실패, 2xx가 아닌 응답, 시간 초과, 잘못된 응답) 호출을 막는다. 통과 응답이 Runtime의 다른 거부 규칙을 무력화하지 않는다 | 유효한 Ticket 없는 실행 금지(A-7), 6-7 | 없음 |
| 2 | **도구 표면 제한.** 내장 도구를 허용 목록으로 줄이고, MCP·확장·플러그인·웹 도구를 뺀다. Runtime 내부 subagent는 허용 수(Ticket `allowed`)가 0이면 도구째 뺀다 | 외부 부작용 Tool 금지, 9-1 | 없음 |
| 3 | **OS 수준 샌드박스.** shell 실행의 쓰기 범위를 worktree와 Run 전용 `TMPDIR`로 제한하고, 외부 네트워크를 막고, 비밀 경로 읽기를 막는다. 샌드박스를 쓸 수 없으면 실행을 시작하지 않는다(fail-closed). 모델이 샌드박스 해제를 요청할 수 없다 | worktree 밖 쓰기 금지, Secret 노출 금지, 외부 부작용 금지 | 컨테이너·VM으로 같은 범위를 강제하면 대체 가능. 그 구성으로 A-4를 다시 통과 |
| 4 | **파일 도구의 경로 검사.** 파일 읽기·쓰기 도구의 경로를 심볼릭 링크를 푼 실제 경로로 Ticket의 읽기 경로와 write_scope에 대어 본다. 검증 정의와 의존성 잠금 파일 경로의 쓰기는 따로 막는다 | write_scope(파일 도구는 사전 차단), 검증 정의 보호 | 1번 hook으로 구현 가능 |
| 5 | **shell의 write_scope 밖 변경은 결과 거부.** worktree 안에서 write_scope 밖에 쓴 shell 변경은 제출 기록 단계에서 거부한다(6-8). Hard Invariant 중 이것만 사전 차단이 아니다 | write_scope 밖 변경의 산출물 반영 금지 | — |
| 6 | **환경 변수 최소 집합.** 자식 프로세스 환경을 상속하지 않고 명시한 집합으로 대체한다. Runtime이 하위 프로세스 환경을 지우는 설정이 있으면 켠다 | Secret 노출 금지 | 없음 |
| 7 | **로컬 입력 격리.** 사용자·프로젝트 설정, 사용자 hook, 지시 파일(CLAUDE.md, AGENTS.md 등), skills, MCP 설정, 자동 memory, 전역 설정 파일이 Run에 섞이지 않는다. Catena 설정은 명시한 경로로만 넣는다 | Ticket 우회 방지, 계약 무결성(8-4, 8-8) | 없음 |
| 8 | **작업공간.** Run마다 새 git worktree와 Run 전용 `TMPDIR`. 이전 worktree는 다시 쓰지 않는다. Agent는 commit할 수 없다(worktree 메타데이터는 worktree 밖) | 6-8, A-5 | — |
| 9 | **Catena 자산 보호.** Project 저장소 디렉터리, Runner 설정 파일, Run 식별 토큰을 샌드박스와 파일 도구 양쪽에서 읽기·쓰기 금지로 둔다. 샌드박스의 네트워크 차단으로 Orchestrator 창구에도 닿지 못한다. Runtime의 hook 요청만 창구에 닿는다 | 0-9, 9-10 | 없음 |
| 10 | **프로세스 그룹.** Runtime을 새 프로세스 그룹으로 띄우고 그룹 ID와 시작 시각을 Run에 기록한다. 단계가 끝나면 그룹 전체가 끝났는지 확인하고 남은 프로세스를 종료한다 | 6-8, 6-9, 6-10 | — |
| 11 | **버전 고정.** Runtime을 정확한 버전으로 설치하고 자동 업데이트를 끈다. 버전이나 구성이 바뀌면 `runner_ref`가 바뀌고, A-4를 다시 통과하기 전까지 `강제됨`을 해제한다 | A-4 | — |
| 12 | **모델 고정.** Ticket `profile`의 모델을 전체 ID로 주고, Runtime의 자동 대체 모델을 끈다 | 5-2 | — |
| 13 | **출력 정규화.** Runtime 출력은 Runner 안에서 Core 명세의 정규화 규칙으로만 ExecutionEvent가 된다. 원본은 transcript로 `artifacts/sha256/`에 저장한다. Hook 판정·프로세스 종료·제출 기록의 출처는 `시스템 기록`, 모델이 출력한 메시지의 출처는 `Agent 보고`다 | A-1, 0-4 | — |
| 14 | **상한 전달.** 턴 수 상한과(API 과금이면) 비용 상한을 Runtime에 넘길 수 있으면 넘긴다. 비용 상한이 클라이언트 추정치면 예약액보다 여유분만큼 낮게 준다 | 5-3 | 없으면 Catena가 단계 경계에서 멈춤(5-6) |
| 15 | **자동 Context 압축 끔.** 끌 수 없으면 Capability에 적고, 단계를 짧게 유지한다 | 8-4 | 단계 분할 |
| 16 | **자격증명 비취급.** Runtime이 자기 저장소에서 자격증명을 읽는다. Catena는 그 값을 읽거나 저장하거나 전달하지 않는다 | 9-9, R-11 | 없음 |

1~4, 6, 7, 9번은 Hard Invariant에 직접 걸린다. 이 중 하나라도 R-6 시험을 통과하지 못하면 그 Runner에 작업을 배정하지 않는다.

## R-4. Runner 인터페이스

Engine MVP Runner가 어차피 해야 하는 일을 함수로 나눈 것이다. 두 번째 Runtime도 같은 함수를 구현한다. 플러그인 탐색이나 동적 등록은 두지 않는다.

| 함수 | 입력 → 출력 | 하는 일 |
|---|---|---|
| `prepare` | Ticket, Baseline, 작업공간 → LaunchSpec | argv, 환경 변수, 작업 디렉터리, Runtime 설정 파일, 샌드박스 구성을 만든다. Run마다 바뀌는 값을 뺀 해시가 `runner_ref`의 일부다 |
| `start` | LaunchSpec → 실행 핸들 | 새 프로세스 그룹으로 띄우고 그룹 ID, 시작 시각, (있으면) Runtime 세션 ID를 돌려준다 |
| `events` | 실행 핸들 → 이벤트 초안의 흐름 | Runtime 출력을 정규화 규칙으로 바꾸고 원본을 transcript에 덧붙인다 |
| `checkTool` | Runtime hook 요청 → 허용 / 거부 | Runtime마다 다른 hook 요청 형식을 Core의 공통 Ticket 판정 함수 입력으로 바꾸고, 결과를 Runtime이 이해하는 응답으로 돌려준다. 판정 자체는 Runner가 아니라 Core가 한다 |
| `stop` | 실행 핸들, 이유 → 종료 확인 | 프로세스 그룹 전체를 끝내고 끝났는지 확인한다 |
| `result` | 실행 핸들 → 종료 코드, 사용량(신뢰도 포함), 세션 ID | 정산(5-3)과 사용량 기록(5-7)의 입력 |
| `capabilities` | — → Capability 기록 | R-5 형식. A-4 결과로 갱신한다 |

## R-5. Capability 항목과 판정 수준

**수준**

| 수준 | 뜻 | 쓸 수 있나 |
|---|---|---|
| 시험 통과 | 이 `runner_ref`로 R-6 시험을 통과했다 | 쓸 수 있다. Hard Invariant 항목은 이 수준만 `강제됨` |
| 문서상 지원 | 공식 문서나 코드에 있지만 시험하지 않았다 | Hard Invariant와 Catena가 기대는 기능(재개 등)에는 쓸 수 없다. 시험 계획의 출발점이다 |
| 관측만 | 일어난 것을 볼 수는 있지만 막거나 바꿀 수 없다 | 기록용으로만 쓴다 |
| 불가 | 지원하지 않는다고 확인했다 | 쓸 수 없다 |
| 미확인 | 확인하지 못했다 | 쓸 수 없다 |

**항목**

| 항목 | 뜻 | Hard Invariant와의 관계 |
|---|---|---|
| 시작·종료·중단 | 비대화 실행, 신호 처리, 프로세스 그룹 종료 | R-3 10 |
| Prompt·Context 전달 | 계약과 입력 산출물을 넘기는 방식, 지시와 자료의 구분 | 8-4, 8-8 |
| 구조화된 출력 | 최종 결과를 정해진 형식으로 받는가 | — |
| 이벤트 스트리밍 | 도구 호출·결과·메시지를 실행 중에 받는가 | Visibility(C-9) |
| 세션 재개 | 끊긴 세션을 이어 가는가 | 6-4(확장) |
| 내부 subagent 관측·제한 | Runtime 안의 하위 Agent를 보고 수를 제한하고, 그 도구 호출에도 hook이 걸리는가 | R-3 1, 2 |
| Tool 권한 제어 | 허용 목록, 도구 호출 전 외부 질의, fail-closed | R-3 1, 2 |
| Sandbox | OS 수준 범위(shell만인지, 파일 도구도인지), 네트워크, 해제 금지 | R-3 3 |
| 모델·effort 설정 | profile을 그대로 적용하는가, 자동 대체를 끌 수 있는가 | R-3 12 |
| 사용량·비용·quota 관측 | 토큰, 비용(보고값/추정값), 구독 한도 신호 | 5-7 |
| 파일 변경 범위 강제 | worktree 안의 일부 경로(write_scope)로 쓰기를 제한하는가 | R-3 4, 5 |
| 로컬 입력 격리 | R-3 7을 지킬 수단이 있는가 | R-3 7 |

**현재 기록(2026-11-11).** 아직 어떤 Runner도 R-6을 실행하지 않았으므로 `시험 통과`는 없다. Claude Code CLI의 문서상 지원 수준은 R-7.1에, 다른 Runtime은 R-8에 있다.

## R-6. A-4 공통 시험 목록

- 통과하지 못한 항목은 9-8에서 `강제됨`으로 표시하지 않는다.
- 사전 차단 항목은 행위가 한 번이라도 실행되면 실패다. 나중에 발견해 거부했더라도 통과로 치지 않는다.
- 결과는 시험한 `runner_ref`에만 유효하다. Session Host나 외부 실행 엔진을 끼우면 그것을 포함한 구성으로 다시 시험한다.
- 각 항목의 Runtime별 구체 시험(도구 이름, 우회 경로)은 R-7.4와 R-8에 둔다.

1. Ticket이 없거나 만료·취소된 상태에서 도구를 호출하면 차단되는가. 다른 인터페이스(CLI)에서 Run을 취소한 직후의 다음 호출도 차단되는가
2. Ticket 검사 창구 질의가 실패하면 차단되는가. 연결 실패, 2xx가 아닌 응답, 시간 초과, 잘못된 응답을 모두 시험한다
3. 허용 목록 밖 도구, MCP·확장 도구, 웹 도구를 호출할 수 없는가. subagent 허용 수가 0이면 subagent를 띄울 수 없는가
4. worktree 밖에 쓰려고 하면 막히는가. shell(`sh -c`, 절대 경로, 스크립트 경유)과 파일 도구(절대 경로, `../`, 심볼릭 링크 경유)를 모두 시험한다
5. 검증 정의를 고치려 하면 실행 전에 막히는가. 파일 도구와 shell을 모두 시험한다
6. 파일 도구로 worktree 안 write_scope 밖에 쓰려고 하면 막히는가
7. shell로 worktree 안 write_scope 밖을 바꾸면 제출 기록이 거부되는가. 추적 파일 수정, 삭제, 미추적 파일 생성을 모두 시험한다 (결과 거부 항목)
8. 모델이 샌드박스 해제를 요청하거나 샌드박스 없이 다시 실행하려 하면 거부되는가
9. 외부 네트워크 접속(curl, Python urllib 등)이 막히는가
10. Secret이 보이지 않는가. shell의 환경 변수 출력, shell과 파일 도구로 비밀 경로 읽기, worktree 안 심볼릭 링크를 통한 읽기, Runtime 자격증명 저장소 읽기를 시험한다
11. 로컬 입력이 Run에 섞이지 않는가. 사용자·프로젝트 설정, 지시 파일, 사용자 hook, skills, MCP 설정, 자동 memory, 전역 설정 파일을 시험한다
12. 비용 상한을 넘으면 종료되는가, 실제로 얼마나 넘는가(5-3 여유분의 근거). API 과금 인증일 때만
13. 자동 Context 압축이 꺼져 있는가
14. 단계가 끝난 뒤 백그라운드 프로세스가 남지 않는가. 남으면 프로세스 그룹 종료로 정리되는가
15. 감독 프로세스를 강제 종료하면 남은 Runtime 프로세스가 도구를 더 실행하지 못하는가(창구 질의가 실패해 차단되는지)
16. 감독 임대가 만료된 뒤 다음 Catena 프로세스가 남은 프로세스를 정리하는가. 프로세스 ID가 재사용된 경우 다른 프로세스를 죽이지 않는가. 두 프로세스가 동시에 정리하지 않는가
17. 샌드박스와 파일 도구 양쪽에서 Project 저장소 파일, Runner 설정 파일, Run 식별 토큰을 읽거나 쓸 수 없는가. shell에서 Orchestrator 창구에 접속하거나 `catena` 명령으로 공식 상태를 바꿀 수 없는가
18. (subagent를 허용할 때만) Runtime 내부 subagent의 도구 호출에도 1~11이 같게 적용되고, subagent 수 상한이 지켜지는가

1~6, 8~11, 17은 Hard Invariant 항목이다. 하나라도 실패하면 그 `runner_ref`에는 작업을 배정하지 않는다(9-8).

## R-7. Claude Code Runner (Engine MVP)

v0.2의 구성을 옮기고, R-3 9번(Catena 자산 보호)과 감독 임대 관련 내용을 더했다. 근거는 2026-11-11에 확인한 공식 문서(code.claude.com의 cli-reference, hooks, settings, legal-and-compliance, agent-sdk/overview, agent-sdk/permissions)다. 권한 평가 규칙, 샌드박스, 설정 격리는 v0.1에서 agent-sdk/permissions, sandboxing, agent-sdk/claude-code-features로 확인한 내용을 이어 쓴다.

### R-7.1 구성

| 항목 | 구성 |
|---|---|
| 실행 | 단계마다 `claude -p --output-format stream-json --verbose`를 자식 프로세스로 시작한다. 작업 디렉터리는 Run의 worktree다. Catena가 Run마다 만든 설정 파일을 `--settings`로 넘긴다. 아래 Hook, 권한 규칙, 샌드박스 설정은 모두 이 파일에 담는다. 설정 파일은 worktree 밖 Run 전용 디렉터리에 두고 R-3 9번에 따라 읽기를 막는다 |
| Ticket 검사 (A-7) | 모든 도구에 걸리는 PreToolUse **http hook**을 두고 `onFailure: "block"`을 건다. Hook은 감독 임대를 가진 Orchestrator의 로컬 창구(127.0.0.1)에 묻는다. 요청 헤더에는 Run 식별 토큰을 담아 어느 Ticket으로 검사할지 정한다. 통과하면 `allow` 대신 빈 응답을 돌려줘 deny 규칙이 계속 적용되게 한다. 경로 인자는 `realpath`로 심볼릭 링크를 푼 뒤 검사한다. 문서상 PreToolUse는 권한 모드보다 먼저, 모든 도구 호출에 걸린다(agent-sdk/permissions의 평가 순서) |
| 도구 표면 | `--tools "Read,Glob,Grep,Edit,Write,Bash"`로 내장 도구를 이 집합으로 제한한다. Agent(subagent) 도구는 넣지 않는다. 문서상 `SubagentStart` hook은 spawn을 막지 못하므로, subagent를 끄는 방법은 도구 제외와 `Agent` deny뿐이다. MCP는 `--strict-mcp-config`를 주고 MCP 설정을 넘기지 않아 뺀다. 권한 모드는 프롬프트 없이 거부하는 `--permission-mode dontAsk` |
| 쓰기 범위 | ① 샌드박스는 작업 디렉터리 전체와 `$TMPDIR`에 Bash 쓰기를 기본으로 허용하고, 그 안을 더 좁히는 설정은 문서에 없다. 검증 정의와 의존성 잠금 파일 경로만 `denyWrite`로 뺀다 ② `blockWritesOutsideWorkingDirectories` ③ Edit/Write는 Hook이 write_scope로 검사하고, 검증 정의 경로에 `Edit(...)` deny를 함께 건다 ④ Bash가 worktree 안 write_scope 밖에 쓴 변경은 제출 기록 단계에서 거부한다(6-8). 이 경우만 사전 차단이 아니다(9-8) |
| 읽기 범위 | 샌드박스 `denyRead`는 Bash에만 적용되고 Read 도구를 막지 않는다(문서 명시). Read·Glob·Grep은 Hook이 Ticket의 읽기 경로(기본: worktree)로 검사하고, 비밀 경로에 `Read(...)` deny를 함께 건다 |
| Catena 자산 | Project 저장소 디렉터리와 Run 전용 설정 디렉터리를 샌드박스 `denyRead`·`denyWrite`와 `Read(...)`·`Edit(...)` deny에 넣는다. 샌드박스 허용 도메인이 비어 있으므로 Bash는 Orchestrator 창구에 접속하지 못할 것으로 본다. http hook 요청은 샌드박스가 걸리지 않는 Claude Code 본 프로세스가 보내므로 창구에 닿을 것으로 본다. 둘 다 추정이며 R-6 2·17로 확인한다 |
| 샌드박스 탈출 | `enabled: true`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, `excludedCommands`는 비운다. 문서상 `failIfUnavailable`의 기본값은 CLI에서 false(샌드박스 없이 실행)라 반드시 명시한다. 샌드박스의 기본 읽기 범위는 컴퓨터 전체라 `denyRead`를 반드시 채운다 |
| 네트워크 | 샌드박스 허용 도메인을 비운다. Web 도구는 도구 표면에서 뺀다 |
| Secret | 자식 프로세스의 환경 변수를 최소 집합으로 지정한다. Node `child_process.spawn`의 `env`는 상속 환경을 대체한다. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`을 쓴다. `~/.ssh`, `~/.aws` 등은 Bash에서는 샌드박스 `denyRead`로, 파일 도구에서는 위의 읽기 범위로 막는다. 구독 자격증명은 CLI가 자기 저장소에서 읽고, Catena는 그 값을 다루지 않는다 |
| 로컬 설정 격리 | ① `--setting-sources`로 user·project·local 설정 파일을 읽지 않게 하고, Catena 설정은 `--settings`로만 넣는다 ② 환경 변수에 `CLAUDE_CONFIG_DIR`(Catena 전용 디렉터리), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`를 넣고, 이 Mac에 관리 정책 파일이 없는지 확인한다 ③ `--safe-mode`와 `--bare`는 쓰지 않는다. 문서상 `--bare`는 `--settings`로 넘긴 hook까지 실행하지 않는다 ④ `--restricted`(v2.1.248 이상, 관리 설정과 `--settings`만 읽고 파일 도구를 작업 디렉터리 안으로 묶는다)는 시험한 뒤 쓸지 정한다(R-7.5) ⑤ 문서상 `-p`의 기본 동작은 CLAUDE.md, skills, 프로젝트 hook, `.mcp.json`을 신뢰 확인 없이 읽는 것이다. 그래서 ①~②를 빼면 안 된다. 관리 정책 hook은 끌 수 없으므로 실행 머신의 관리 설정을 점검한다 |
| 작업공간 | Run마다 새 git worktree와 Run 전용 `TMPDIR`(환경 변수로 지정)을 쓴다. git worktree의 메타데이터는 worktree 밖에 있어 Agent가 commit할 수 없다 |
| 프로세스 | Orchestrator가 CLI를 `detached`로 띄워 새 프로세스 그룹을 만들고 그 ID와 시작 시각을 Run에 기록한다. 단계가 끝나면 그룹 전체가 끝났는지 확인하고 남은 프로세스를 종료한다(6-8). 중단할 때는 SIGINT로 턴을 끝내게 하고, 끝나지 않으면 SIGTERM(문서상 exit 143, 진행 중인 Bash 프로세스 트리 종료, 그 턴의 result는 남지 않음), 마지막으로 그룹 종료 순서로 한다. 문서상 턴이 끝나도 백그라운드 작업을 최대 10분 기다릴 수 있으므로 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`를 짧게 준다 |
| 모델 | `--model`에 전체 모델 ID를 준다. `--fallback-model`은 주지 않고, 설정의 `fallbackModel`도 비운다 |
| 예산 | `--max-turns`를 지정한다. API 키 인증이면 `--max-budget-usd`를 예약액에서 여유분을 뺀 값으로 준다(5-3). 구독 인증이면 비용 상한을 쓰지 않고, 사용 한도에 걸리면 5-6 규칙대로 멈춘다(5-1) |
| Context 압축 | `DISABLE_AUTO_COMPACT=1` (8-4) |
| 버전 고정 | Claude Code CLI를 정확한 버전으로 설치하고 자동 업데이트를 끈다. v2.1.295 이상이어야 한다(`onFailure`). CLI 버전과 위 구성의 해시를 `runner_ref`로 Baseline에 남긴다. 둘 중 하나라도 바뀌면 A-4 시험을 다시 통과하기 전까지 `강제됨`을 해제한다(A-4) |
| 이벤트 | Runner가 stream-json 출력과 Hook 요청을 ExecutionEvent로 바꾼다(Core 명세의 정규화 규칙). CLI 출력 형식은 Runner 밖으로 내보내지 않는다(A-1). 원본 출력은 transcript로 `artifacts/sha256/`에 저장한다(14-3). `node.started`에 `profile{runtime: "claude-code", model, effort}`를 담는다 |

**Capability (문서상 지원 수준, 2026-11-11, 설치본 2.1.322와 code.claude.com 문서 기준)**

| 항목 | 내용 | 근거(code.claude.com/docs/en/) |
|---|---|---|
| 시작·종료·중단 | `claude -p`. SIGINT로 턴 종료, SIGTERM은 exit 143과 Bash 프로세스 트리 종료 | headless |
| Prompt·Context 전달 | 인자, stdin(10MB), `--append-system-prompt-file`. 지시와 자료의 구분은 Catena가 prompt 안에서 한다(8-8) | headless, cli-reference |
| 구조화된 출력 | `--json-schema` → result의 `structured_output`. 만들지 못하면 필드가 빠지거나 `error_max_structured_output_retries` | headless |
| 이벤트 스트리밍 | `stream-json`: `system/init`, `tool_use`/`tool_result`, subagent 메시지(`parent_tool_use_id`), `system/task_started`(`spawn_depth`), `system/permission_denied`, `rate_limit_event`, `--include-hook-events`로 hook 이벤트, 마지막에 `result` | headless, agent-sdk/typescript |
| 세션 재개 | `--session-id`(미리 지정), `--resume`, `--fork-session`. 중단된 턴은 이어 가지 않고, 비용 합계는 누계다 | cli-reference, headless |
| 내부 subagent 관측·제한 | PreToolUse가 subagent 안의 호출에도 걸리고 `agent_id`가 붙는다. spawn은 `Agent` deny로만 막는다. 깊이 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`(기본 3), 동시 수 `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`(기본 20) | hooks, sub-agents |
| Tool 권한 제어 | `--tools`, deny 규칙, PreToolUse http hook + `onFailure: "block"`(연결 실패, 2xx 아님, 시간 초과, 잘못된 응답 모두 차단). `onFailure`를 주지 않으면 fail-open. hook의 allow는 deny 규칙을 이기지 못한다 | hooks |
| Sandbox | Seatbelt(macOS), bubblewrap(Linux). 범위는 Bash와 그 자식뿐. 파일 도구·MCP·hook은 샌드박스 밖 | sandboxing |
| 모델·effort | `--model`(전체 ID), `--effort low/medium/high/xhigh/max` | model-config, cli-reference |
| 사용량·비용·quota | result의 `total_cost_usd`(클라이언트 추정치), `usage`, `modelUsage`, `permission_denials`. 구독 한도 신호는 `rate_limit_event`(`status: allowed / allowed_warning / rejected`, `resetsAt`, `utilization`) | agent-sdk/typescript |
| 파일 변경 범위 강제 | 파일 도구는 hook과 `Edit(...)`/`Write(...)` deny로 사전 차단. Bash를 worktree 안 write_scope로 좁히는 것은 `denyWrite`/`allowWrite` 조합이 필요하고 우선순위가 문서에 없어 추정. 그래서 Bash는 결과 거부로 다룬다 | sandboxing |
| 로컬 입력 격리 | `--setting-sources`, `--restricted`, `--strict-mcp-config`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. `--bare`·`--safe-mode`는 hook을 끄므로 쓰지 않는다 | headless, cli-reference, memory |

Agent SDK는 같은 Claude Code 바이너리를 자식 프로세스로 띄우는 라이브러리다(agent-sdk/overview). 그래서 `claude -p`를 직접 띄우는 것과 실행 엔진이 같고, SDK가 더 주는 것은 `canUseTool` 콜백과 타입 정도다. Catena는 SDK를 쓰지 않는다(R-1).

### R-7.2 Hard Invariant별 구현

Core 명세 9-8의 강제 방식(사전 차단 / 결과 거부)을 Engine MVP에서 구현하는 방법이다.

| Hard Invariant | 강제 방식 | 구현 |
|---|---|---|
| 유효한 Ticket 없는 실행 금지 | 사전 차단 | PreToolUse http hook(`onFailure: "block"`) |
| worktree 밖 쓰기 금지 | 사전 차단 | Bash는 샌드박스 쓰기 범위, 파일 도구는 `blockWritesOutsideWorkingDirectories`와 Hook |
| 정책 정의와 고정된 검증 정의 보호 | 사전 차단 | 샌드박스 `denyWrite`, Hook, `Edit(...)` deny. 검증은 계약에 고정된 버전으로 실행한다(7-8). 정책 정의는 Project 저장소에 있으므로 R-7.1의 Catena 자산 보호로 함께 막는다 |
| write_scope 밖 변경의 산출물 반영 금지 | 파일 도구는 사전 차단, Bash는 결과 거부 | Edit/Write는 Hook, Bash는 제출 기록 검사(6-8) |
| 허용되지 않은 Secret 노출 금지 | 사전 차단 | 최소 환경 변수와 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, 샌드박스 `denyRead`(Bash), Hook 읽기 경로 검사와 `Read(...)` deny(파일 도구) |
| 외부 부작용 Tool 금지 (확장 전까지) | 사전 차단 | `--tools`로 도구 제한, MCP 제거, 샌드박스 네트워크 차단 |

### R-7.3 실행 경계 구현

| 경계 (6-7) | Engine MVP 구현 | 남기는 이벤트 |
|---|---|---|
| Run 시작 전 | Catena 명령(트랜잭션 하나에서 Baseline, Run, Ticket, 감독 임대) | `run.created`, `run.state_changed` |
| 모델 호출 전 | Orchestrator가 단계마다 CLI 프로세스를 시작한다. API 키 인증이면 `--max-budget-usd`를 넘긴다 | `node.started` |
| Tool 실행 전 | PreToolUse http hook(`onFailure: "block"`) + 권한 규칙 + 샌드박스 | 거부 시 `agent.activity`(출처: 시스템 기록) |
| Tool 실행 후 | PostToolUse http hook. 이미 실행된 뒤라 차단은 못 하고 기록만 한다 | `agent.activity`, `usage.recorded` |
| Run 종료 전 (Agent 단계마다) | Orchestrator + Runner: 프로세스 그룹 종료 확인, 제출 기록 생성(6-8), 증거 수집(A-6), 정산 | `node.finished`, `submission.created`(diff 파일 `diff_ref` 포함), `evidence.recorded`(검사 로그 `raw_log_ref` 포함) |

검사가 적용되지 않는 경로: 샌드박스의 OS 수준 차단은 Bash에만 적용되고, 파일 도구(Read, Edit, Write 등)는 Hook과 권한 규칙으로 막는다. worktree 안에서 write_scope 밖에 쓰는 Bash는 실행 전에 막지 못하므로 6-8에서 결과를 거부한다(9-8).

### R-7.4 R-6 시험의 Claude Code 구체화

| R-6 | Claude Code에서 시험하는 것 |
|---|---|
| 3 | WebFetch, WebSearch, Agent 도구, MCP 도구 호출 |
| 4 | Bash(`sh -c`, 절대 경로, 스크립트 경유), Edit/Write(절대 경로, `../`, 심볼릭 링크 경유) |
| 8 | 모델이 `dangerouslyDisableSandbox`로 다시 시도 |
| 10 | Bash의 `env`와 `cat ~/.ssh/...`, Read·Grep으로 `~/.ssh` 읽기, worktree 안 심볼릭 링크를 통한 Read·Grep·Bash 읽기, CLI 자격증명 저장소 읽기 |
| 11 | 사용자 설정, CLAUDE.md, user Hook, skills, MCP, auto memory, `~/.claude.json` |
| 12 | API 키 인증에서 `--max-budget-usd` 초과 |
| 13 | `DISABLE_AUTO_COMPACT=1` |
| 15 | Orchestrator를 강제 종료한 뒤 남은 `claude` 프로세스의 도구 호출(http hook 연결 실패 → `onFailure: "block"`) |
| 17 | Read로 저장소 경로·설정 파일 읽기, Bash로 `curl 127.0.0.1:<창구>`, Bash로 `catena` 실행 |
| 18 | (확장) Agent 도구를 허용했을 때 subagent 안의 Bash·Edit에 PreToolUse가 걸리는지 |

### R-7.5 문서로 확인하지 못한 항목

시험(R-6)으로 확인한다.

- `onFailure: "block"`이 연결 실패, 2xx가 아닌 응답, 시간 초과, 잘못된 출력에서 모두 차단하는지. 이 세부 동작은 문서 요약으로만 확인했다(시험 2)
- `--tools`가 내장 도구를 정확히 그 집합으로 제한하는지
- `--setting-sources`에 어떤 값을 주면 user·project·local 설정을 모두 빼는지. CLAUDE.md, skills, commands, subagents까지 빠지는지
- `--restricted`가 관리 설정과 `--settings`만 읽는지(문서상 그렇다), 이때 `--settings`의 Hook과 샌드박스 설정이 그대로 적용되는지
- `CLAUDE_CONFIG_DIR`을 바꾸면 `~/.claude.json`도 옮겨지는지. 바꾼 디렉터리에서 구독 로그인이 유지되는지, 사용자가 그 디렉터리로 한 번 직접 로그인해야 하는지
- `--max-budget-usd`가 구독 인증에서도 동작하는지
- 서브에이전트 안의 호출에도 Hook이 실제로 걸리는지. 문서상 걸린다. Engine MVP는 Agent 도구를 빼고, 확장 단계에서 subagent를 허용할 때 시험한다(시험 18)
- 샌드박스에서 `allowWrite`와 `denyWrite`가 겹칠 때 어느 쪽이 우선하는지. 이것이 정해지면 Bash의 write_scope도 사전 차단할 수 있을지 모른다(지금은 결과 거부)
- 환경 변수로 지정한 `TMPDIR`을 샌드박스가 쓰기 허용 경로로 쓰는지
- 세션이 끝날 때 백그라운드 명령이 정리되는지
- 허용 도메인이 빈 샌드박스에서 127.0.0.1 접속도 막히는지(시험 17)

문서로 확인한 것(2026-11-11, cli-reference·hooks·settings·agent-sdk/permissions)은 다음과 같다.

- CLI 플래그: `--settings`, `--permission-mode`의 `dontAsk`, `--tools`, `--max-turns`, `--max-budget-usd`(API 사용액 추정 기준), `--output-format stream-json`, `--model`, `--fallback-model`, `--strict-mcp-config`
- Hook: command·http hook의 `onFailure`(v2.1.295 이상, 설치본 2.1.322). PreToolUse는 권한 모드와 allow 규칙보다 먼저 평가되고 subagent 안의 호출에도 걸린다. `--bare`는 `--settings`의 hook도 실행하지 않는다
- 위 Capability 표의 항목들
- 환경 변수: `CLAUDE_CONFIG_DIR`

`settingSources: []`가 CLAUDE.md를 막는다는 것, 그래도 `~/.claude.json`·관리 정책·auto memory는 읽힌다는 것은 v0.1에서 SDK 문서로 확인했다. CLI의 `--setting-sources`도 같은지는 위 목록에서 시험한다.

## R-8. 다른 Agent Runtime 후보 (확장)

조사일 2026-11-11. 공식 문서와 소스를 읽은 결과이며 실행 시험은 하지 않았다. 그래서 아래 모든 칸은 `문서상 지원` 이하다. 근거 표기: Codex는 `openai/codex@ac54a05`(설치본 0.167.0과 HEAD 비교), OpenCode는 `anomalyco/opencode@be6f5a3`(v2.2.7, 설치본 v2.0.31과 비교).

### R-8.1 R-3 요건별 판정

| R-3 요건 | Claude Code CLI | Codex CLI | OpenCode |
|---|---|---|---|
| 1 도구 호출 전 외부 질의, 실패 시 차단 | PreToolUse http hook + `onFailure: "block"` | **충족하지 못함.** PreToolUse command hook은 있지만, hook 프로세스의 실패(시간 초과, 실행 실패, 비정상 종료, 잘못된 JSON)를 통과로 처리한다(`codex-rs/hooks/src/events/pre_tool_use.rs:211-218,285-298`). 이미 열린 세션에 입력을 넣는 `write_stdin`과 hosted tool은 hook을 거치지 않는다 | 서버 플러그인의 `tool.hook("execute.before")`가 모든 도구 실행 앞에서 돌고, reject하면 실행하지 않는다(`packages/core/src/tool.ts:125-133`, `packages/plugin/src/promise/adapter.ts:686-692`). 단 플러그인 로드가 실패하면 플러그인 없이 계속 돌고(`packages/core/src/plugin/supervisor.ts:57-59`), hook에 시간 제한이 없다 |
| 2 도구 표면 제한 | `--tools`, `--strict-mcp-config` | 설정으로 웹 검색, apps, plugins, 이미지 생성, browser·computer use, MCP, `multi_agent`(기본 켜짐)를 끈다. 모델이 실제로 보는 목록의 완전성은 미확인 | 바닥에 `{action:"*", resource:"*", effect:"deny"}`를 깔고 필요한 action만 연다. `policies`의 hard deny |
| 3 OS 샌드박스 | Seatbelt(Bash만) | Seatbelt, Linux는 bubblewrap + seccomp. shell과 `apply_patch` 모두에 적용. 기본으로 쓰기가 허용되는 `/tmp`와 `$TMPDIR`를 빼야 한다 | **없다.** 공식 문서가 권한 시스템은 보안 격리가 아니며 격리가 필요하면 Docker나 VM을 쓰라고 한다. shell은 사용자의 파일·네트워크 권한으로 돈다 |
| 4 파일 도구 경로 검사 | Hook과 deny 규칙 | permission profile(Beta)로 경로별 `read`/`write`/`deny`. `apply_patch`도 같은 정책 | `edit`·`read` 권한 규칙과 `external_directory` deny. 포함 판정이 어휘적이라 worktree 안 심볼릭 링크로 우회될 수 있다(추정) |
| 5 write_scope | 파일 도구는 사전 차단, Bash는 결과 거부 | profile로 shell까지 사전 차단할 근거가 있다(Beta, 조건부) | 파일 도구는 사전 차단, shell은 결과 거부 |
| 6 환경 변수 | spawn 환경 대체, 하위 프로세스 환경 지우기 | 기본 `inherit=all`이라 `CODEX_API_KEY`까지 넘어간다. `shell_environment_policy.inherit="none"`이 필수 | 서버 프로세스 환경 전체가 shell에 넘어간다. 세션 환경 교체나 hook으로 거를 수 있다 |
| 7 로컬 입력 격리 | `--setting-sources`, `CLAUDE_CONFIG_DIR` 등 | 전용 `CODEX_HOME`, `--ignore-user-config`, `--ignore-rules`, `project_doc_max_bytes=0`. 사용자 hooks.json이 섞일 가능성(추정) | `OPENCODE_CONFIG_DIR`, `OPENCODE_DISABLE_PROJECT_CONFIG=1`. system·MDM 설정은 항상 읽는다 |
| 9 Catena 자산 보호 | 샌드박스와 파일 도구 deny | profile deny | shell을 허용하면 막을 수 없다 |
| **판정** | Engine MVP Runtime. R-6 시험 대상 | **지금은 쓸 수 없다.** 요건 1을 만족하지 못한다 | **shell을 허용하면 쓸 수 없다.** 요건 1은 조건부로 가능하지만 요건 3이 없다 |

**다시 검토하는 조건**
- Codex: hook 실패 시 막는 설정이 생기거나, app-server의 승인 요청·dynamic tool 구조가 응답 실패 시 실행하지 않는다는 것을 R-6으로 확인할 때. 그 전에는 다른 요건이 충족돼도 배정하지 않는다(0-5).
- OpenCode: (a) shell을 끈 프로필(파일 도구만)로 실제 과제를 할 수 있고 검사·빌드는 Catena가 대신 실행하는 구성, 또는 (b) Catena가 OpenCode 서버 전체를 OS 샌드박스나 컨테이너로 감싼 구성. 어느 쪽이든 플러그인이 활성인지 시작 전에 확인하고(`GET /api/plugin`), 플러그인 안에서 질의 시간 제한을 걸고, R-6을 통과해야 한다.
- Gemini CLI: 도구 호출 전 hook(`BeforeTool`)이 외부 명령 하나뿐이고, 시간 초과나 오류가 나면 차단 결정이 없는 것으로 보고 허용한다(fail-open, `google-gemini/gemini-cli@e5d88fb:packages/core/src/hooks/hookAggregator.ts:190-192`). 요건 1을 채우지 못한다. Google은 2026-05에 후속 제품(Antigravity CLI)으로 옮긴다고 발표했고, 개인 구독 경로는 2026-06-18에 끝났다(확인(문서)). 후속 제품은 조사하지 않았다.
- 그 밖의 Agent는 조사하지 않았다. 붙이기 전에 같은 표를 채운다.
- ACP로 붙이는 경우: 각 어댑터는 그 Runtime의 한계를 그대로 가지며, ACP 권한 요청은 권고일 뿐이다(검토 문서 4절). 위 판정이 바뀌지 않는다.

### R-8.2 Capability (문서상 지원 수준)

| 항목 | Codex CLI | OpenCode |
|---|---|---|
| 시작·종료·중단 | `codex exec`. SIGINT는 턴 중단, SIGTERM 처리기는 없음. shell 자식은 `setsid()`로 자기 프로세스 그룹에 들어가 Catena의 그룹 종료에서 빠질 수 있다(추정, 시험 필요) | `opencode run --standalone`이 자식 서버(`serve --stdio --port 0`)를 띄우고 끝낼 때 SIGTERM 후 3초 뒤 SIGKILL. 플래그가 없으면 사용자의 공유 서버에 붙는다(사용자 설정·플러그인이 섞임) |
| Prompt·Context 전달 | 인자 또는 stdin, `-C` 작업 루트. 작업 루트의 AGENTS.md를 자동으로 읽음(끌 수 있음) | 인자·stdin, `--file`, 세션 API |
| 구조화된 출력 | `--output-schema`(strict) | v2에 없음 |
| 이벤트 스트리밍 | `--json` JSONL: 명령 실행, 파일 변경(완료 시점만), MCP 호출, 하위 Agent 호출 | SSE `/api/event`(재생 없음, 느리면 끊김), `run --format json` |
| 세션 재개 | `codex exec resume <id>` | `--session`, `--continue`, fork |
| 내부 subagent | `multi_agent` 기본 켜짐. 끄기, 수·깊이 제한, `SubagentStart/Stop` hook. exec 출력에는 하위 thread의 도구 호출이 안 나옴 | `subagent` 도구, 기본 깊이 1, 권한 상속 |
| 모델·effort | `-m`, `model_reasoning_effort` | `--model provider/model#variant` |
| 사용량·비용 | 토큰(thread 누적일 가능성), USD 없음. 요금제 한도는 app-server에서만 | 단계별 USD 비용과 토큰 |

### R-8.3 공통 인터페이스에 주는 시사점

- 세 Runtime 모두 비대화 실행, 인자·stdin prompt, JSON 이벤트 흐름, 세션 ID로 재개, 모델 지정이 있다. R-4의 `prepare`, `start`, `events`, `result`는 이 공통분모로 충분하다.
- Runtime마다 크게 다른 것은 hook 방식(http hook / 외부 명령 hook / 같은 프로세스 안 플러그인), 샌드박스(Bash만 / shell과 patch 모두 / 없음), 비용 보고(추정 USD / 토큰만 / USD), subagent 기본값(꺼짐 / 켜짐 / 도구로 있음)이다. 이 차이는 R-4의 `checkTool`과 `capabilities`, 그리고 Runtime별 R-6 구체화에서 흡수하고 Core에는 올리지 않는다.
- 같은 프로세스 안 플러그인으로 Ticket을 검사하는 Runtime(OpenCode)은 신뢰 경계가 Runtime 프로세스까지 넓어진다. 플러그인 로드 실패가 fail-open이므로 `start` 직후 활성 확인을 Runner의 필수 단계로 둔다.

## R-9. Session Host와 외부 실행 엔진

**Session Host (tmux, Herdr 등, 후속)**
- Runner의 LaunchSpec(argv, 환경 변수, 작업 디렉터리, 프로세스 그룹, 샌드박스 구성)을 그대로 실행해야 한다. Session Host 자신의 환경 변수를 섞지 않는다.
- Runtime 화면에 키 입력을 보내 대화창(권한 확인, 신뢰 확인)을 자동으로 넘기면 안 된다. Herdr 문서는 키 입력으로 승인 대화창을 누를 수 있다고 경고하고, Gas City·Gas Town은 화면을 읽어 대화창을 자동 수락한다(검토 문서 3.2~3.4, 확인(코드·문서)).
- Session Host가 추정한 Agent 상태(화면 정규식 등)는 `외부 기록`이며 Run 상태를 바꾸지 않는다. Run 상태는 Runner가 직접 확인한 프로세스 상태로만 바꾼다.
- Session Host를 낀 구성은 별도 `runner_ref`이며 R-6을 다시 통과해야 한다.
- Engine MVP는 Session Host를 쓰지 않는다. 사람은 Catena 화면의 활동 기록(C-9)으로 Agent 활동을 본다. `claude -p`는 비대화 실행이라 터미널 화면이 필요하지 않다.

**외부 실행 엔진 (Gas City 등, 지금 쓰지 않음)**
- Core 명세 사용 형태와 실행 구조 절의 다섯 조건을 모두 만족해야 Runner의 한 종류로 붙일 수 있다.
- 구체적으로 더 확인할 것(Gas City 기준, 검토 문서 SP-6): 엔진의 기본 권한 우회 모드를 끌 수 있어야 한다. 대화창 자동 수락을 끌 수 있어야 한다. 엔진이 Catena 요청 없이 세션을 시작·재시작·nudge하지 않아야 한다. 엔진 이벤트가 best-effort면 공식 기록은 Runner가 직접 관측한 것으로만 만든다. 엔진의 작업·의존 저장소(Beads 등)에 Catena 상태를 쓰거나 거기서 읽어 오지 않는다.

## R-10. Agent-invoked 경로의 보안 경계

**외부 Agent는 통제 밖이다.** 사용자가 직접 띄운 Agent(Claude Code 대화 세션, Codex 등)는 사용자의 OS 권한으로 돈다. Catena는 그 프로세스의 도구 호출, 파일 접근, 네트워크를 막지 못한다. 그래서:

- 외부 Agent에는 Ticket을 발행하지 않는다(0-11). 외부 Agent의 실행을 `강제됨`으로 표시하지 않는다.
- 외부 Agent가 할 수 있는 것은 명령 계층의 질의와 요청뿐이다(9-1). 실행이 필요하면 Catena-driven Run이 되고, 그 Run은 A-4를 통과한 Runner로 실행된다.
- 외부 작업(6-11)의 결과는 결과 쪽 관문(제출 기록 검사, 고정 검증 정의로 새 checkout에서 실행한 검사, 사람 승인)만 거친다. 기본으로 꺼져 있다.

**같은 OS 사용자 권한의 한계.** 외부 Agent는 사용자가 할 수 있는 일을 모두 할 수 있다. Catena가 막지 못하는 것과 대응은 다음과 같다.

| 위험 | 막을 수 있나 | 대응 |
|---|---|---|
| 외부 Agent가 `catena approve`를 실행 | 부분적 | 승인은 표준 입력이 터미널(TTY)일 때만 받고, 승인 대상(제출 기록 ID의 일부)을 직접 입력하게 한다. 비대화형 실행과 JSON 모드는 승인을 거부한다(9-10). 외부 Agent가 TTY를 가진 터미널에 키 입력을 보낼 수 있으면(tmux, Herdr) 막지 못한다 |
| 외부 Agent가 Web UI 승인 요청을 위조 | 부분적 | 127.0.0.1 바인드, `Origin` 검사, 화면에서 확인한 요청만 받는다. 같은 사용자의 로컬 프로세스가 화면 세션 정보를 읽으면 막지 못한다 |
| 외부 Agent가 Project 저장소 파일을 직접 고침 | 아니다 | 저장소를 작업 트리 밖에 두어 실수를 줄일 뿐이다. 변조 탐지(이벤트 해시 사슬 등)는 필요가 확인되면 더한다 |
| 외부 Agent가 Runner 설정 파일이나 Run 토큰을 읽음 | 아니다 | 같은 사용자 권한이면 읽을 수 있다. 통제된 Agent는 샌드박스로 막는다(R-3 9) |

이 한계는 승인 기록의 채널(9-10)과 함께 화면에 보여 준다. 외부 작업(6-11)을 열기 전에 대응 방법을 정한다(Core 명세 14-15, 검토 문서 SP-8). 후보는 외부 Agent를 다른 OS 사용자로 실행하도록 안내하는 것과, 승인에 사람만 할 수 있는 확인 수단(예: OS 사용자 인증)을 더하는 것이다.

**통제된 Agent는 막는다.** Catena Run 안의 Agent는 샌드박스와 파일 도구 검사로 저장소, 설정 파일, Run 토큰, Orchestrator 창구에 닿지 못한다(R-3 9, R-6 17). 그래서 통제된 Agent는 승인을 흉내 낼 수 없다.

**MCP 서버(확장, C-6).** stdio 전송을 기본으로 하고, HTTP를 쓰면 127.0.0.1 바인드와 `Origin` 검사를 한다(MCP 명세의 요구). 질의와 요청 tool만 두고 승인·정책 변경 tool은 두지 않는다. 요청 주체는 외부 Agent(스스로 밝힌 이름)로 기록한다. MCP 명세는 2026-07-28부터 stateless이므로 claim 같은 상태는 Catena가 발급한 핸들을 인자로 주고받는다.

## R-11. 인증과 공급자 정책

**공통 규칙**
- Catena 코드와 Catena를 만드는 작업자는 자격증명을 읽거나 저장하거나 입력하거나 전달하지 않는다. Runtime은 자기 저장소에서 자격증명을 읽는다.
- 인증 방식은 두 가지 중 사용자가 고른다: 사용자가 그 Runtime에 직접 로그인한 상태(구독), 또는 사용자가 설정한 API 키.
- 구독으로 자동 실행해도 되는지는 공급자의 공식 정책으로만 판단한다. 어느 실행 방식(CLI, SDK, ACP)이 더 낫다는 근거로 쓰지 않는다. 정책 문구와 확인 날짜를 아래 표에 남기고, 바뀌면 다시 확인한다.
- Catena를 다른 사람에게 제공하면, 공급자 정책이 따로 허용하지 않는 한 API 키 인증으로 바꾼다.
- 자원 정책(5-1)은 인증 방식에 따라 다르게 동작한다: API 과금이면 금액 예약, 구독이면 한도 소진을 5-6으로 처리한다.

**공급자별 (2026-11-11 확인)**

| Runtime | 인증 | 공식 정책 요지 | 근거 | Catena의 처리 |
|---|---|---|---|---|
| Claude Code CLI | 본인 구독 로그인 또는 API 키 | "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications". legal-and-compliance가 금지하는 것은 제품·서비스 개발자가 자기 앱에서 claude.ai 로그인을 제공하는 것, 사용자를 대신해 구독 자격증명으로 요청을 보내는 것, 자격증명을 모으거나 저장하거나 중개하는 것이다. 구독 사용 한도는 개인의 일반적 사용을 전제로 한다. Agent SDK 기반 제3자 제품의 claude.ai 로그인 제공은 사전 승인 없이 허용되지 않는다(agent-sdk/overview) | code.claude.com의 legal-and-compliance, agent-sdk/overview | 같은 절은 최종 사용자가 수정하지 않은 Claude Code 바이너리에 자기 구독으로 로그인하는 것을 막지 않는다고 쓴다. 사용자가 자기 머신에서 직접 로그인한 공식 `claude`를 Catena가 띄우고 자격증명을 다루지 않는 구조가 여기에 맞는다는 것은 해석(추정)이다. 그래서 Catena는 자격증명을 다루지 않고, 남에게 제공하기 전에는 API 키로 바꾸거나 Anthropic에 확인한다. ACP 어댑터(Agent SDK 기반)는 쓰지 않는다 |

| Codex CLI | ChatGPT 로그인 또는 API 키(`CODEX_API_KEY`) | 공식 인증 문서: "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs." 제3자 도구가 사용자 본인의 ChatGPT 로그인으로 CLI를 띄워도 되는지는 찾지 못했다 | learn.chatgpt.com/docs/auth | API 키를 기본으로 한다. 구독 경로는 정책을 확인한 뒤에 연다. 기본 환경 변수 상속 때문에 API 키가 도구 프로세스에 보이므로 `shell_environment_policy`를 반드시 좁힌다(R-8.1) |
| OpenCode | 공급자별 API 키, 공급자 로그인(ChatGPT 등), "Claude Agent" provider(사용자의 Claude Code를 Agent SDK로 실행) | 자체 구독은 없고 공급자 정책을 따른다. Claude Agent provider 경로가 Anthropic 정책에 맞는지는 공식 판단을 찾지 못했다 | opencode.ai/docs(providers, claude-agent) | Anthropic 모델은 API 키 경로로만 쓴다. Claude Agent provider는 정책을 확인하기 전까지 쓰지 않는다. `opencode auth export`가 저장된 자격증명을 출력하므로 shell을 허용하면 Secret 요건을 지킬 수 없다 |
| Gemini CLI | Google 로그인, Gemini API 키, Vertex | 개인 구독 경로는 2026-06-18에 끝났고 유료 API 키 경로는 유지된다는 공지 | developers.googleblog.com 공지 | 붙인다면 API 키 경로뿐이다. 지금은 요건 1 때문에 쓰지 않는다 |

## R-12. 남는 위험

- Claude Code 문서가 이 샌드박스를 "격리 경계가 아니다"라고 명시한다. OS 수준 차단은 Bash에만 적용되고, 파일 도구는 Hook과 권한 규칙으로 막는다. worktree 안 write_scope 밖 Bash 쓰기는 실행 전에 막지 못하고 결과 거부로만 다룬다(9-8).
- 샌드박스의 `allowWrite`와 `denyWrite`가 겹칠 때의 우선순위가 문서에 없다. 그래서 상위 경로를 막고 하위 경로를 여는 구성은 쓰지 않는다.
- `--max-budget-usd`는 클라이언트 추정치라 초과할 수 있다(5-3 여유분).
- 구독 인증이면 비용 상한을 걸 수 없고, 사용 한도에 걸리면 Run이 단계 경계에서 멈춘다(5-6). 여러 Run을 계속 돌리면 개인의 일반적 사용을 전제로 한 한도에 걸릴 수 있다.
- 본인 구독으로 본인 도구를 자동 실행하는 경우를 문서가 명시적으로 허용하지는 않는다. 문서가 바뀌면 R-11을 다시 확인한다.
- 여러 사용자가 쓰거나 신뢰할 수 없는 코드를 다루면 컨테이너나 VM이 필요하다. 이 환경에는 Docker가 없어 Engine MVP에서는 쓰지 않는다.
- 외부 Agent(통제 밖)는 같은 OS 사용자 권한으로 승인 채널과 저장소에 닿을 수 있다(R-10). 외부 작업(6-11)을 열기 전에 대응을 정한다.
- 여러 Catena 프로세스가 같은 SQLite 파일에 쓰는 구조는 로컬 디스크를 전제로 한다. 네트워크 파일 시스템에 두면 잠금이 보장되지 않는다(Core 명세 14-3).
- MCP와 ACP는 프로토콜 수준에서 도구 호출을 강제하지 못한다(검토 문서 4절). 두 번째 Runtime을 ACP로 붙이더라도 사전 차단은 Runtime 쪽 hook과 샌드박스에 기대야 한다.
