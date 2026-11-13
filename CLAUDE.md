# CLAUDE.md

이 저장소에서 일하는 Coding Agent(Claude Code, Codex 등)를 위한 안내다. `AGENTS.md`는 이 파일을 가리키는 심볼릭 링크이므로, 고칠 때는 이 파일만 고친다.

## 프로젝트 상태

Catena는 AI 개발 과정을 사람이 이해할 수 있는 공정(작업 단계별 상태, WBS, 의존 관계, Agent Graph)으로 보여 주는 AI 개발 공정관리 시스템이다. 지금은 **설계 단계**다. 주 산출물은 명세 문서다. 코드는 Product MVP 화면 가설을 시험하는 읽기 전용 시안뿐이고, 시뮬레이션 데이터만 다룬다. 실행 엔진은 아직 없다.

- git 저장소다. 의존성은 npm으로 설치한다(`npm install`). `.npmrc`의 `legacy-peer-deps`는 `@vitejs/plugin-react`의 선택적 peer(Babel 8)가 shadcn CLI(Babel 7)와 부딪혀서 둔 것이다.
- 화면은 React 19 + Vite 8 + TypeScript + Tailwind CSS 4 + shadcn(Radix)이다. academic-assistant 대시보드와 같은 구성이다.
- Node 24가 `tools/`와 `scenarios/`의 `.ts`를 직접 실행한다(타입 제거 방식). 그래서 TypeScript는 지울 수 있는 문법만 쓴다. enum, namespace, 생성자 매개변수 속성은 쓰지 않는다(`erasableSyntaxOnly`로 검사). 상대 import에는 `.ts` 확장자를 붙인다.
- 문서, 코드 주석, 화면 문구는 한국어로 쓴다.

## 명령

```bash
npm run dev                                                      # 시안 보기: http://127.0.0.1:5180 (고치면 바로 반영)
npm test                                                         # 전체 시험(tools/*.test.ts, engine/*.test.ts, prototype/src/**/*.test.ts)
npm run check                                                    # 타입 검사(tsc -b, 화면과 Node 코드 둘 다)
npm run lint                                                     # oxlint + @shadcn/lint 디자인 규칙
npm run build                                                    # 게시용 빌드 → dist/ (타입 검사 포함)
npm run preview                                                  # dist/ 보기: http://127.0.0.1:5181
node --test --test-name-pattern="E4" tools/fold.test.ts          # 시험 하나
node tools/fold.ts scenarios/roombook [--at N]                   # 읽기 모델을 글로 출력(N = 재생 위치)
node tools/catena.ts status [--bundle 폴더] [--at N] [--json]    # CLI 질의(C-12): status·ready·inbox·graph·show·agents·activity
node scenarios/roombook.build.ts                                 # 시나리오 묶음 다시 만들기(expense.build.ts도 같다)
node tools/plan.ts [--hash <Task ID>]                            # Catena 제작 공정: 계획 검사, Task 상태, 착수 가능 Task
tailscale serve --bg --https=5180 http://127.0.0.1:5180          # 폰에서 보기: tailnet 안에서만 https://<기기>.<tailnet>.ts.net:5180 (끄기: --https=5180 off)
```

시안 주소: `?data=<묶음 이름>`으로 묶음을 고르고(없으면 `roombook`), `?mode=baseline`이면 사용자 시험의 비교 기준 화면(Task 목록과 실행 로그)을 연다. 예: `http://127.0.0.1:5180/?data=expense#overview`, `http://127.0.0.1:5180/?data=expense&mode=baseline`. 사용자 시험 진행은 `docs/user-test.md`를 따른다.

코드를 바꾼 뒤 `npm test`, `npm run check`, `npm run lint`를 실행한다. 화면을 바꿨으면 데스크톱(1440px)과 폰(375px), 밝은 모드와 어두운 모드에서 확인한다. 화면 자체의 자동 시험은 없고, 공정표 배치는 `prototype/src/lib/graph.test.ts`가 시험한다. `.claude/launch.json`의 `prototype`(개발 서버)과 `dist`(빌드 결과) 설정이 미리보기 서버를 띄운다.

## Catena 제작 공정

Catena 자신의 개발도 Catena 공정(WBS, Task 계약, 슬롯 의존, 완료 조건, 인수)으로 진행한다(2026-11-11 사용자 결정). 작업하는 Coding Agent 세션은 Catena가 시작한 Run이 아니므로(0-11) 실행·제출·인수 이벤트로 적지 않는다. 계획은 계획 파일로, 인수는 사용자가 대화에서 승인한 기록으로 남긴다. 화면은 `?data=catena`로 연다(출처 `계획 파일`, 실행 기록과 재생 위치 없음).

- **계획**: `plan/catena.plan.json`. Phase, WBS, Task마다 목표, 입력 슬롯과 공급 Task(`"슬롯": "T01.출력슬롯"`), 출력 슬롯, 완료 조건(`auto`: 명령으로 확인, `human`: 사용자 검토), Milestone. Engine MVP의 `plan import` 형식 후보다(T14).
- **인수 기록**: `plan/accepted.json`. 인수한 순서대로 쌓는다. 항목은 `task_id`, `contract`(인수 시점의 계약 해시, `node tools/plan.ts --hash <Task>`), `evidence`(조건 ID마다 증거: 실행한 명령과 결과, commit, 사용자가 본 산출물), `approved_at`, `channel`이다.
- **검사**: `tools/planfold.ts`가 계획을 계획 이벤트로 바꿔 읽기 모델 검사 규칙(E2~E4, E11)을 거치고, 인수 기록마다 입력 슬롯이 먼저 인수됐는지, 조건마다 증거가 있는지, 계약 해시가 같은지 확인한다. `node tools/plan.ts`(글), 화면(`?data=catena`), `npm test`가 모두 이 코드를 쓴다.
- **화면**: `plan/dataset.json`이 `origin: "plan"`으로 계획 파일과 인수 기록을 가리키고, `prototype/public/data/catena`가 `plan/`을 가리킨다. 사람 인수는 이벤트가 아니므로 접은 모델에 따로 더하고(`Bundle.accept`), Task 상세의 근거 칸에 인수 기록의 증거를 보인다.
- **진행 순서**
  1. `node tools/plan.ts`로 착수 가능한 Task를 확인한다. 사용자가 고르지 않았으면 어느 Task를 하는지 먼저 말한다.
  2. 그 Task의 계약(목표, 완료 조건) 안에서만 일한다. 계약 밖의 일이 필요하면 먼저 계획을 고친다.
  3. 완료 조건마다 증거를 모은다.
  4. 사용자에게 조건별 증거를 보이고 인수를 묻는다. 사용자가 승인한 때만 `accepted.json`에 적는다. Agent가 스스로 인수하지 않는다.
  5. 인수되면 그 Task의 작업과 인수 기록을 한 커밋에 함께 넣고 push까지 한다(2026-11-12 사용자 결정). 인수 전의 작업은 따로 묻지 않고 커밋하지 않는다.
- **계획 고치기**: 인수되지 않은 Task는 고칠 수 있다. 인수된 Task의 계약을 바꾸면 계약 해시가 달라져 검사가 실패한다(9-4, 승인은 승인한 버전에만 적용된다). 바꿔야 하면 새 Task를 만든다.
- 계획에 예상 소요나 일정을 넣지 않는다(0-7). 진척은 인수된 완료 조건으로만 본다.
- 명세 「13장 개발 단계」의 착수 순서(Engine MVP는 저장소·명령 계층부터)는 의존이 아니라 순서 원칙이라 계획 파일에 엣지로 넣지 않았다. 착수 가능한 Task가 여럿이면 이 원칙으로 고른다.

## 구조

이벤트 기록을 접어(fold) 화면 상태를 만드는 구조다. 검사 규칙과 읽기 모델 코드는 한 곳에 있고, Node와 브라우저가 함께 쓴다.

**데이터 묶음** (`scenarios/<이름>/`)
- `dataset.json`: 묶음 선언. `dataset_id`, `origin`(`simulated`/`recorded`/`live`), `schema_version`, `default_position`(기본 재생 위치)이 있다.
- `events.jsonl`: ExecutionEvent 한 줄에 하나. `seq`는 1부터 빈틈없이 이어진다.
- `artifacts/sha256/<hex>`: 원문(transcript 발췌, diff, 검사 로그). 이벤트 payload는 원문을 `{kind: 'artifact', id: 'sha256:<hex>'}`로 참조하고, 불러올 때 해시를 다시 계산한다.
- 묶음은 둘이다. `roombook`(회의실 예약, 기준 시나리오)과 `expense`(사내 경비 정산, 사용자 시험용). 둘은 구조가 같고 내용과 Task 번호가 다르다(대응표는 `docs/user-test.md`).
- `prototype/public/data/<이름>`은 `scenarios/<이름>`을 가리키는 심볼릭 링크다(`catena`만 `plan/`을 가리킨다, 「Catena 제작 공정」). 묶음을 더하면 링크도 더한다. 빌드하면 `dist/data/<이름>/`에 실제 파일로 복사된다.

**`tools/readmodel.ts`: 규칙의 유일한 출처**
- `checkStream`: 중복, 순서, 출처 선언을 확인한다(E1, E10).
- `apply`: 이벤트 하나를 모델에 반영하면서 나머지 검사 규칙을 확인한다. 위반하면 `RuleError("E<n>: …")`를 던진다.
- `foldAll(events, refCheck, at)`: 재생 위치 `at`까지 접는다.
- 화면용 질의: `card`, `waitsOf`, `edgesAt`, `relations`, `blocking`, `tasksUnder`, `path`, `conditionState`, `aggregate`, `inbox`, `taskEdges`, `rework`·`hasRework`(Q8), `agentGraph`, `nodeActivity`. 화면(`prototype/src/`)과 CLI(`tools/catena.ts`)는 값을 이 함수로만 계산한다. 시험이 CLI JSON과 이 함수 값의 일치를 확인한다(인수 기준 11).
- 실행 환경에 의존하지 않으므로 `node:*`를 import하지 않는다. 원문 확인은 `refCheck`로 주입한다. Node 쪽 구현은 `tools/fold.ts`(fs + crypto), 브라우저 쪽 구현은 `prototype/src/lib/data.ts`(fetch + `crypto.subtle`)에 있다.

**화면** (`prototype/`, Vite의 root)
- 화면은 `prototype/src/lib/rm.ts`를 거쳐 `tools/readmodel.ts`를 직접 불러온다. 생성 파일은 없다.
- 상태 판단 로직은 넣지 않고 읽기 모델 질의 결과만 그린다. 상태 이름과 색의 대응만 `lib/status.ts`에 있다.
- 불러오기 순서: 묶음 전체를 끝까지 접어 검사하고, 통과하면 기본 재생 위치로 다시 접는다(`App.tsx`, `lib/data.ts`, `lib/store.tsx`). 검사에 실패하면 화면을 그리지 않는다. 네트워크 오류는 "불러오기 실패", 규칙 위반은 "검사 실패"로 나눠 표시한다.
- 화면은 해시 라우팅이다: `#overview`, `#wbs[-id]`, `#dag[-id]`, `#task-<id>`, `#agent-<id>`, `#approval-<id>`, `#phase`, `#milestone`(`lib/route.ts`, 화면은 `pages/`).
- 묶음 고르기(`?data=`)와 비교 기준 화면(`?mode=baseline`, `pages/baseline.tsx`)은 주소 쿼리로 정한다(`lib/data.ts`). 비교 기준 화면에는 Catena의 해석(대표 상태, 차단 이유, 공정표, 집계, 상태 색)을 넣지 않는다.
- 공정표 세 가지(WBS 공정표, 전체 의존, Agent Graph)는 `components/flow-graph.tsx`(React Flow)가 그리고, 배치는 `lib/graph.ts`(ELK)가 정한다. 노드는 끌 수 없다. 전체 의존은 후행 노드에 엣지마다 입력 포트를 줘서 슬롯 숫자가 겹치지 않게 한다(`labels: 'head'`). ELK(1.6MB)는 그래프 화면에서만 따로 불러온다.
- 서로 얽힌 묶음 안의 집계 엣지는 그리지 않고 묶음에 방향별 개수(`note`)를 적으며, 묶음을 누르면 펼친다(명세 집계 엣지 표시 규칙 2·3). 화살촉은 `HEAD` 크기로 고정하고, 선은 화살촉 밑변에서 끝낸다. 직선 엣지는 `trimEnd`로 끝을 당기고, 호는 끝에 곧은 구간을 둔다. 공정표 시험(`graph.test.ts`)이 이 모양을 확인한다.
- shadcn 부품은 `components/ui/`에 있다. academic-assistant에서 가져왔고, 배지 variant만 공정 상태 색으로 바꿨다. 부품을 더할 때 shadcn CLI가 import 경로를 `"cn"`으로 잘못 쓰고 `cn` 패키지를 설치하는 일이 있었다. 더한 뒤 확인한다.
- 디자인 규칙은 `DESIGN.md`에 있다. 화면을 바꾸기 전에 읽는다.

**Engine** (`engine/`, Engine MVP)
- `store.ts`: Project 저장소(14-3). Node 내장 `node:sqlite`로 SQLite 파일 하나(WAL)에 소유 Core별 테이블과 append-only `events` 테이블을 둔다. 기본 위치는 `~/.catena/projects/<project_id>/`(`catena.db`, `artifacts/sha256/`)로, 저장소 작업 트리 밖이다.
- 쓰기는 `tx()`(BEGIN IMMEDIATE)로만 하고, 이벤트는 그 안에서 `append()`로 덧붙인다. seq는 트랜잭션 안에서 매기므로 여러 프로세스가 써도 빈틈이 없다. 불변 기록(계약, Baseline, 제출 기록, 증거, 인수, 승인 요청·결정, 이벤트)은 trigger로 수정·삭제를 거부한다.
- `events()`는 읽기 모델의 입력 검사(`checkStream`)를 거친 이벤트를, `refCheck`는 산출물 원문 확인을 돌려준다. 그대로 `foldAll`에 넣는다.

**시나리오 생성기** (`scenarios/roombook.build.ts`, `scenarios/expense.build.ts`, 공용 도구 `scenarios/sim.ts`)
- 결정적이다. `event_id`는 `sha256(dataset:seq)`에서 만들고, 시각은 `at()`으로 정한다. `Date.now()`나 난수를 쓰지 않는다.
- 실행하면 `scenarios/<이름>/`을 지우고 새로 쓴다.
- `expense.build.ts`는 `roombook.build.ts`와 이벤트 순서까지 같은 모양으로 쓴다. 한쪽 구조를 바꾸면 다른 쪽도 같이 바꾼다.

**시험과 시나리오는 맞물려 있다**
- `fold.test.ts`는 roombook의 특정 상태(예: T07 `실행 중`, T03 `decision` 대기)를 단정한다.
- 거부 시험은 묶음을 임시 폴더에 복사해 이벤트를 고친 뒤 실행한다.
- 재생성 시험은 두 생성기를 그 자리에서 다시 실행해 `events.jsonl` 해시가 그대로인지 본다. 생성기를 고쳤다면 먼저 생성기를 실행해 묶음을 다시 만든 뒤 시험을 돌린다.
- 구조 시험은 ID 대응표(`TO_ROOMBOOK`)로 expense를 roombook ID로 바꿔, 두 묶음의 공정 구조(카드, 차단 이유, 엣지, 집계, 수정 반복, Agent Graph)가 같은지 본다.

## 명세 문서

- **최신은 `core_spec_v0.10.md`다(상태: 제안).** v0.9.2에서 Catena가 시작한 실행에 대한 실행 통제 약속(Hard Invariant 강제, A-4 시험, 샌드박스, 도구 호출마다의 Ticket 검사)을 폐지했다(2026-11-12 사용자 결정: 공정 프로그램이지 막는 프로그램이 아니다). 공정의 사실(시스템 증거, 제출 기록, 사람 인수, 승인의 버전 결합)은 9-8의 공정 규칙으로 남는다. v0.9.2는 v0.9.1에서 묶음 안 집계 엣지 표시(규칙 2·3), 14-10 결정(Product MVP는 시뮬레이션만), 사용자 시험의 두 번째 시나리오와 비교 기준 화면을 반영했다. v0.9.1은 v0.9에서 화면 구현 방식(14-11)만 바꿨다. 이전 버전 파일은 이력으로 남겨 두고 고치지 않는다. 개정할 때는 새 버전 파일을 만들고, "vX 대비 변경" 절과 부록 변경 대조표를 둔다.
- `runner_spec_v0.4.md`: Runner 연결부(Agent 띄우기, stream-json 정규화, 프로세스 그룹, 인증 정책)와 Engine MVP Claude Code Runner 구성. 규칙 자체를 바꾸려면 core spec을 고친다. `runner_security_spec_v0.1~0.3`은 이력이다.
- `dashboard_interaction_design.md`: 대시보드에서 할 수 있는 조작의 설계 초안(T29). 객체·상태별 조작, 설계 규칙 I1~I13, 열린 질문, 비교 도구 조사. 인수되면 다음 명세 개정에 반영한다.
- `orchestration_architecture_review.md`: v0.9의 기술 조사(Beads, Gas Town, Gas City, Herdr, LangGraph, ADK, MAF, Coding Agent CLI, MCP·ACP·A2A)와 아키텍처 결정 근거, Spike 목록.
- Catena는 독립 CLI이고 공식 상태와 Scheduler는 Catena만 가진다(0-9). CLI·Web UI·MCP는 같은 Core 라이브러리의 명령 계층과 읽기 모델을 쓴다(0-10). 상주 서버는 강제하지 않고, Run 감독은 감독 임대로 소유자를 정한다(0-6, 6-10).
- Engine Runner는 Agent SDK를 넣지 않는다. Orchestrator가 공식 Claude Code CLI(`claude -p`)를 사용자 설정 그대로 띄우고, 권한 모드는 Project 설정으로 정한다(14-2). Catena는 Agent의 행위를 막지 않는다(0-5). 다른 CLI Agent는 확장 단계에서 Runner로 붙인다.
- 코드 주석의 번호(`1-4`, `B-7`, `E6`, `9-8` 등)는 core spec의 feature 번호와 검사 규칙 번호다.
- 코드 작업과 관련 깊은 절:
  - 「사용자 경험과 화면 구조」: Drill-down 경로, 이동 수 기준
  - 「사용 형태와 실행 구조」: 구성 요소, 명령 계층, CLI 명령 예(C-12)
  - 「ExecutionEvent」: 이벤트 타입, 검사 규칙 E1~E11, v0.9 선택 필드(`node.started.profile` 등)
  - 13장 「Product MVP」: 기준 시나리오 요건, 인수 기준(11: CLI JSON과 화면 값 일치), 사용자 시험(Q1~Q6, Q8)
  - 「공정 관점」의 집계 엣지 표시 규칙: 묶음 안에는 화살표 대신 방향별 개수를 적고, 집계 엣지나 묶음을 누르면 원본 의존을 펼친다(규칙 2·3), 묶음 배치(규칙 4)
  - 14장: 14-10 기록 데이터 출처(결정: Product MVP와 사용자 시험은 시뮬레이션만, 실제 기록 변환은 Engine MVP 이후), 14-11 화면 구현 방식(결정: 로컬 Web UI, React·Vite, React Flow·ELK)

## 설계 판단 기준 (명세 「제품 정의」, 0-7)

- **가치 우선순위:** Visibility 50%, Orchestration 25%, Control 25%. 이 비중은 UX와 개발 우선순위를 정하는 기준이다. 두 설계가 부딪히면 사용자가 진행 상황을 더 쉽게 이해하는 쪽을 고른다. 기술적으로 정교해진다는 이유만으로 기능이나 Core를 늘리지 않는다. Catena는 Agent의 행위를 막는 보안 도구가 아니다(0-5). 대신 공식 상태가 사실과 어긋나지 않게 하는 공정 규칙(9-8)은 승인으로도 넘지 않는다.
- **MVP 순서:** Product(시뮬레이션 데이터로 화면 검증, 14-10) → Engine → Integrated → 확장.
- **시간은 예측하지 않는다.** 예상 소요, 계획 일정, 계획 대비 지연은 제안하지 않는다. 진척은 시간이 아니라 인수된 완료 조건으로 표현한다.
- 명세 논의가 실행 통제·보안 쪽으로 치우쳐 작업 단계별 공정 상태가 빠진 적이 있다(v0.6, v0.7). 명세를 고칠 때는 공정표 쪽이 함께 다뤄지는지 확인한다.
- 모든 화면에 데이터 출처(`simulated`/`recorded`)를 표시하고, 시뮬레이션을 실제 실행처럼 보이게 하지 않는다.
- Engine 단계의 인증은 사용자가 직접 로그인한 CLI(본인 구독)나 사용자가 설정한 `ANTHROPIC_API_KEY`를 쓴다. Catena 코드도, 작업하는 Claude도 자격증명을 읽거나 저장하거나 입력하지 않는다. Catena를 다른 사람에게 제공하면 API 키 인증으로 바꾼다.

## 게시된 시안

시안은 비공개 Artifact로 게시돼 있다: https://claude.ai/artifact/HRCwfqrbETHVE4FrSfL4Sn
- 갱신할 때는 `npm run build` 뒤 이 URL로 다시 게시한다.
- 페이지는 `dist/index.html`이다. 함께 올리는 파일은 `dist/assets/*`(해시 붙은 JS·CSS·글꼴), 묶음마다 `data/<이름>/dataset.json`, `data/<이름>/events.jsonl`, `data/<이름>/artifacts/sha256/*`다. 옛 경로(`data/dataset.json` 등)는 `null`로 지운다. 빌드마다 assets 이름이 바뀌므로 옛 이름은 `null`로 지운다.
- 확장자 없는 원문 파일과 `events.jsonl`은 contentType을 정확히 `"text/plain"`으로 지정해야 게시된다.
