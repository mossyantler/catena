# Engine MVP 검수 시험 결과 (T25)

T25: Engine MVP 검수 시험의 결과 문서다(출력 `engine_report`). 슬롯으로 이어진 Task 두 개를 A는 Claude Code, B는 Codex로 실제로 끝까지 실행하고, 명세 13장 Engine MVP 검수 기준 1~14를 확인한다.

## 검수 기준과 시험 대응

T25-C1의 시험 묶음은 아래 시험 전체다. 모두 `npm test`에 들어 있고, CI(`.github/workflows/check.yml`)가 실행한다. 실제 CLI 대신 같은 출력을 내는 가짜 CLI(`engine/fixtures/fake-claude.mjs`, `fake-codex.mjs`)를 쓴다.

| 기준 | 내용 | 시험 |
|---|---|---|
| 1 | A의 출력 슬롯이 검수되기 전에는 B의 Run·Ticket이 생기지 않는다 | `engine/mvp.test.ts`, `engine/start.test.ts` C1 |
| 2 | write_scope 밖 변경은 제출 기록에서 거부된다 | `engine/submit.test.ts` T20-C1(쓰기 범위) |
| 3 | 검사 미실행·skip·검증 정의 변경이면 검수 거부 | `engine/verify.test.ts` T21-C1 두 개 |
| 4 | Agent의 "테스트 통과" 보고만으로는 검수되지 않는다 | `engine/step.test.ts` C2, `engine/verify.test.ts` T21-C2 |
| 5 | 예산 상한이면 새 단계·신규 착수 거부, 단계 경계에서 멈춤 | `engine/budget.test.ts` T24-C1 세 개 |
| 6 | 검수 기록에서 Baseline·근거·승인을 따라갈 수 있다 | `engine/mvp.test.ts`, `engine/accept.test.ts` T22-C2 |
| 7 | 검사·승인 뒤 작업공간이 바뀌어도 검수 대상은 같은 제출 기록 | `engine/mvp.test.ts`, `engine/accept.test.ts` T22-C2 |
| 8 | 감독 프로세스를 강제 종료하면 임대 만료 뒤 정리하고 새 Run으로 재시도 | `engine/supervise.test.ts` C1 |
| 9 | 발행한 이벤트가 검사 규칙 E1~E11을 통과한다 | `engine/mvp.test.ts`(A → B 전체 이벤트), 각 시험의 `foldAll` |
| 10 | 같은 Task 착수를 동시에 요청해도 Run·예약·Agent 프로세스는 하나 | `engine/start.test.ts` C2 |
| 11 | 승인은 대화형 CLI에서만 받는다 | `engine/accept.test.ts` T22-C1 |
| 12 | 상태 테이블과 이벤트를 접은 값이 같다 | `engine/mvp.test.ts`(Run 상태, 검수 기록) |
| 13 | 권한 모드로 실행하고 노드 시작·활동·끝·transcript 기록, 다른 인터페이스의 취소 | `engine/step.test.ts` C1 두 개, `engine/codex.test.ts` T37-C1 |
| 14 | auto 조건만 있는 Task는 승인 없이, human 조건이 있는 Task는 승인으로 검수 | `engine/mvp.test.ts`, `engine/start.test.ts` T26-C2 |

`engine/mvp.test.ts`는 A(Claude Code) → B(Codex)를 한 공정에서 끝까지 돌린다. 노드 기록과 활동이 Task마다 다른 Agent 프로그램(`claude-code`, `codex`)으로 남는지도 확인한다.

## 실제 CLI 시험 실행 (2026-11-15, Claude Code가 먼저 실행)

사용자가 직접 실행하기 전에 출력 형식 문제를 찾으려고, 작업하던 Claude Code 세션이 예시 저장소(`examples/engine-mvp`)로 한 번 실행했다. 이 실행은 검수 근거가 아니다. 승인은 가상 터미널(`script`)로 입력했고, 이는 14-15에 적은 한계(같은 사용자 권한의 Agent가 승인 채널을 흉내 낼 수 있다)에 해당한다.

- 환경: Claude Code 2.1.325(구독 인증), codex-cli 0.167.2, Node 24.21.0
- 계획: A `slug 함수 구현`(claude-code, 쓰기 범위 `src/**`, 검사 `node --test test/slug.test.mjs`) → B `slug 명령줄 도구 구현`(codex, 입력 `A.slug`, 쓰기 범위 `bin/**`, 검사 `node --test test/cli.test.mjs`, 사용자 확인 조건 1개)

| 단계 | 결과 |
|---|---|
| A 검수 전 `run B` | 거부: `E6: 입력 항목이 아직 검수되지 않았다(A.slug)` |
| `run A` | 구현 1회차 → 검사 A-C1 통과 → 승인 없이 검수, Run 종료. 사용량 토큰 221,502(구독) |
| `run B` | A의 제출 commit에서 시작 → 구현 1회차 → 검사 B-C1 통과 → 승인 대기 → 승인 → 검수, Run 종료. 토큰 153,490 |
| 최종 상태 | 검증된 완료 조건 3/3, 두 Task 모두 검수됨, 제출 commit은 `refs/catena/submissions/A-r1-s1`, `B-r1-s1` |

### 실제 실행에서 찾아 고친 것

1. Codex 토큰을 두 번 셌다. `turn.completed.usage`의 `cached_input_tokens`는 `input_tokens`에, `reasoning_output_tokens`는 `output_tokens`에 이미 들어 있다. 이제 입력과 출력만 더한다(`engine/codex.ts`).
2. Agent의 활동과 노드 시작이 모두 `orchestrator`가 한 것으로 기록됐다. 그래서 Agent 그래프와 활동 목록에서 어느 Agent 프로그램이 했는지 보이지 않았다. 이제 Agent 노드의 시작·활동·transcript는 그 프로그램(`agent / Worker / claude-code`, `codex`)으로 적는다. 시뮬레이션 묶음의 형식과 같다(`engine/step.ts`).
3. 선행 Task가 검수되기 전에 B를 시작하면 "base_ref가 없다: 입력이 없는 Task는…"이라는 엉뚱한 이유로 거부했다. 이제 검수되지 않은 입력 항목을 이유로 보인다(`engine/commands.ts`).
4. 승인 확인 입력에서 Ctrl+D·Ctrl+C를 누르면 오류 스택을 내며 죽었다. 이제 아무것도 하지 않았다고 알린다(`tools/catena.ts`).
5. 여러 줄 명령·메시지가 활동 목록의 줄을 깼다. 활동 요약을 한 줄로 만든다. 전체는 transcript 원문에 남는다(`engine/runner.ts`).
6. CLI로 Project 설정(저장소, 권한 모드, 예산 상한)을 정하는 명령이 없었다. `project configure`를 더했다. `catena run`은 회차·검사 결과·승인 명령을 터미널에 알린다.

### 확인했지만 고치지 않은 것

- Project 권한 모드 `acceptEdits`에서는 Claude Code가 `node --test` 실행을 승인받지 못해 직접 시험하지 못했다. 파일 수정은 됐고, 검사는 Catena가 따로 했다. 권한 모드는 사용자가 정한다(14-2).
- Codex는 과금 방식(구독·API)을 출력에 남기지 않아 사용량의 과금 방식이 `알 수 없음`이다.
- 승인 노드도 `orchestrator`가 연 것으로 기록된다(프로필은 `사용자 · 승인`).
- CLI 글 출력은 아직 옛 용어(인수됨, 증거, 뒤를 막는 Task, 차단)를 쓴다. 화면 문구 결정(검수, 검수 근거, 보류 사유)은 대시보드에만 반영돼 있다.

## 사용자 실행 (T25-C2)

```bash
sh examples/engine-mvp/setup.sh            # 예시 저장소(~/.catena/examples/engine-mvp/repo)와 Project 저장소(~/.catena/projects/engine-mvp-example)를 만들고 계획을 불러온다
# 안내된 명령으로 차례대로:
node tools/catena.ts run A --store ~/.catena/projects/engine-mvp-example --base-ref <안내된 commit>   # Claude Code
node tools/catena.ts run B --store ~/.catena/projects/engine-mvp-example                             # Codex, 승인 대기
node tools/catena.ts approve B-r1-s1-a1 --store ~/.catena/projects/engine-mvp-example                # 다른 터미널에서
# 진행은 대시보드 http://127.0.0.1:5180/?live=engine-mvp-example 에서 실시간으로 본다(T30)
```

실행에는 사용자의 Claude 구독과 Codex 계정 사용량이 든다. 결과는 아래에 적는다.

### 사용자 실행 결과 (2026-11-15)

사용자가 자기 터미널에서 실행했다. 저장소는 `~/.catena/examples/engine-mvp/store`(T30 뒤로 `~/.catena/projects/engine-mvp-example`이 이 폴더를 가리키는 링크)이고, T34(확정된 이벤트 형식 반영) 이후의 코드다.

| 단계 | 기록 |
|---|---|
| `run A` | 명령 `run.start`(사용자, `cli-tty`) → Agent 노드 actor `agent / Worker / claude-code` → 검사 A-C1 통과(검사 노드 actor `code / 검사`) → 승인 없이 슬롯·Task 검수 → Run 종료. 토큰 220,377(구독) |
| `run B` | 명령 `run.start`(사용자, `cli-tty`) → A의 제출 commit에서 시작 → Agent 노드 actor `agent / Worker / codex` → 검사 B-C1 통과 → 승인 요청 `B-r1-s1-a1`(종류 `품질`, 조건 B-C2) |
| 승인 | 명령 `approval.decide`(사용자, `cli-tty`), 결정 `승인`, 채널 한계 문구 기록 → B 슬롯·Task 검수 → Run 종료. 토큰 98,546(과금 방식 알 수 없음) |
| 결과 | 검증된 완료 조건 3/3, 두 Task 검수됨. 제출 commit `refs/catena/submissions/A-r1-s1`(6edb05d), `B-r1-s1`(7f8735e). 이벤트 54건이 검사 규칙 E1~E11과 형식 버전 1을 모두 통과 |

수정 반복은 없었다(두 Task 모두 검사 1회차 통과). 실패나 감독 상실은 일어나지 않았다.
