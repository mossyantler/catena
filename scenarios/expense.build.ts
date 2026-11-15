// 사용자 시험용 두 번째 시나리오 "사내 경비 정산 서비스"를 데이터 묶음(scenarios/expense/)으로 만든다.
// 시뮬레이션 데이터다. roombook과 구조가 같고(WBS 깊이, 의존 모양, 차단 이유, 수정 반복, 양방향 집계 엣지, Runtime 구성, 이벤트 순서)
// 도메인·이름·Task 번호가 다르다. 참가자가 첫 시나리오의 번호를 외워 답하지 못하게 번호를 섞었다(docs/user-test.md의 대응표).
// 사용: node scenarios/expense.build.ts && node tools/fold.ts scenarios/expense
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario, USER, CATENA, MGR, W, RV, TEST, diff, log, transcript } from './sim.ts';

const { ev, art, at, node, contract, link, simpleFlow, runStart, runEnd, start, finish, act, submit, usage, evidence, request, decide, accept, write } =
  scenario('expense-sim-1', '2026-11-08');

// ================= 1일차: 계획 =================
at(1, '09:00');
ev('project.defined', 'expense', USER, 'Planning', {
  project_id: 'expense', name: '사내 경비 정산 서비스',
  phases: [['P1', '요구사항'], ['P2', '설계'], ['P3', '구현'], ['P4', '테스트'], ['P5', '배포']].map(([phase_id, name], i) => ({ phase_id, name, order: i + 1 })),
});
node('T01', null, 'task', '요구사항 정리', 1, 'P1');
node('S1', null, 'summary', '서버', 2);
node('S11', 'S1', 'summary', '정산 도메인', 1);
node('T02', 'S11', 'task', '청구 테이블 설계', 1, 'P2');
node('T03', 'S11', 'task', '청구 API 구현', 2, 'P3');
node('T04', 'S11', 'task', '한도 초과 검사 테스트', 3, 'P4');
node('S12', 'S1', 'summary', '영수증 처리', 2);
node('T05', 'S12', 'task', '영수증 API 설계', 1, 'P2');
node('S121', 'S12', 'summary', '인식 구현', 2);
node('T06', 'S121', 'task', '금액 추출 구현', 1, 'P3');
node('T07', 'S121', 'task', '이미지 저장 구현', 2, 'P3');
node('T08', 'S12', 'task', '영수증 처리 통합 테스트', 3, 'P4');
node('S2', null, 'summary', '웹 화면', 3);
node('T09', 'S2', 'task', '화면 흐름 설계', 1, 'P2');
node('T10', 'S2', 'task', '영수증 올리기 화면 구현', 2, 'P3');
node('T11', 'S2', 'task', '청구 화면 구현', 3, 'P3');
node('T12', 'S2', 'task', '회계 연동 화면', 4, 'P3');
node('S3', null, 'summary', '출시', 4);
node('T13', 'S3', 'task', 'CI 파이프라인 구성', 1, 'P5');
node('T14', 'S3', 'task', '운영 반영', 2, 'P5');

at(1, '09:10');
contract('T01', '사내 경비 정산 서비스 v1의 요구사항을 ID와 수용 기준으로 정리한다', '회계 시스템 연동', ['docs/requirements.md'],
  ['brief'], [['requirements', '문서']],
  [['T01-C1', '요구사항마다 ID와 수용 기준이 있다', 'auto', 'requirements'], ['T01-C2', '요구사항 검토', 'human', 'requirements']]);
contract('T02', '청구·영수증 테이블과 마이그레이션을 설계한다', '회계 전표 테이블', ['db/migrations/'],
  ['requirements'], [['schema', 'SQL']],
  [['T02-C1', '마이그레이션 적용·참조 검사 통과', 'auto', 'schema'], ['T02-C2', '스키마 검토', 'human', 'schema'],
   ['T02-C3', '요구사항 R-03~R-05의 데이터를 모두 담는다', 'human']]);
contract('T03', '경비 청구 생성·조회·취소 API와 월 한도 검사를 구현한다', '결재선 지정', ['src/api/claims.ts', 'src/domain/limit.ts'],
  ['schema', 'screen_flow'], [['claim_api', '코드']],
  [['T03-C1', '청구 CRUD 단위 테스트 통과', 'auto', 'claim_api'], ['T03-C2', '월 한도 초과 테스트 통과', 'auto', 'claim_api'],
   ['T03-C3', 'API 계약 일치 검토', 'human', 'claim_api']]);
contract('T04', '월 한도 초과 시나리오를 테스트로 만든다', '성능 시험', ['tests/claims/'],
  ['claim_api'], [['limit_test_report', '테스트 보고서']],
  [['T04-C1', '한도 초과 시나리오 테스트 통과', 'auto', 'limit_test_report'], ['T04-C2', '테스트 범위 검토', 'human', 'limit_test_report']]);
contract('T05', '영수증 올리기·인식 결과 API와 금액 추출 규칙을 설계한다', '외부 OCR 서비스 선정', ['docs/receipt-api.yaml', 'docs/extract-rules.md'],
  ['requirements'], [['ocr_api_spec', 'OpenAPI'], ['field_rules', '문서']],
  [['T05-C1', 'OpenAPI 문서가 스키마 검사를 통과한다', 'auto', 'ocr_api_spec'], ['T05-C2', '개인정보 검토', 'human', 'ocr_api_spec'],
   ['T05-C3', '금액·부가세 추출 규칙이 명시돼 있다', 'human', 'field_rules']]);
contract('T06', '추출 규칙에 맞춰 영수증 합계에서 공급가액을 계산한다', '이미지 저장', ['src/receipt/amount.ts'],
  ['field_rules'], [['amount_parser', '코드']],
  [['T06-C1', '금액 추출 단위 테스트 통과', 'auto', 'amount_parser'], ['T06-C2', '코드 검토', 'human', 'amount_parser']]);
contract('T07', '영수증 API 명세에 맞춰 영수증 이미지를 저장하고 지운다', '금액 추출', ['src/receipt/store.ts'],
  ['ocr_api_spec'], [['image_store', '코드']],
  [['T07-C1', '이미지 저장·삭제 단위 테스트 통과', 'auto', 'image_store'], ['T07-C2', '코드 검토', 'human', 'image_store']]);
contract('T08', '영수증 올리기부터 금액 추출까지 통합 테스트를 작성하고 통과시킨다', '부하 시험', ['tests/receipt/'],
  ['amount_parser', 'image_store'], [['receipt_test_report', '테스트 보고서']],
  [['T08-C1', '영수증 처리 통합 테스트 통과', 'auto', 'receipt_test_report'], ['T08-C2', '테스트 범위 검토', 'human', 'receipt_test_report']]);
contract('T09', '영수증 올리기·청구 화면 흐름과 와이어프레임을 만든다', '회계 연동 화면', ['docs/screens.md', 'docs/ui-mock.md'],
  ['requirements'], [['screen_flow', '문서'], ['ui_mock', '문서']],
  [['T09-C1', '화면 흐름이 요구사항 ID를 모두 덮는다', 'auto', 'screen_flow'], ['T09-C2', '디자인 검토', 'human', 'ui_mock']]);
contract('T10', '와이어프레임과 영수증 API 명세대로 영수증 올리기 화면을 구현한다', '카메라 촬영', ['web/src/upload/'],
  ['ui_mock', 'ocr_api_spec'], [['upload_ui', '코드']],
  [['T10-C1', '올리기 화면 컴포넌트 테스트 통과', 'auto', 'upload_ui'], ['T10-C2', '화면 검토', 'human', 'upload_ui']]);
contract('T11', '와이어프레임대로 청구 화면을 구현한다', '회계 연동 화면', ['web/src/claim/'],
  ['ui_mock', 'claim_api'], [['claim_ui', '코드']],
  [['T11-C1', '청구 화면 컴포넌트 테스트 통과', 'auto', 'claim_ui'], ['T11-C2', '화면 검토', 'human', 'claim_ui']]);

at(1, '09:15');
const BRIEF = '# 기획 메모 (사람이 등록한 초기 입력)\n\n- 직원 300명, 종이 영수증을 손으로 옮겨 적는다.\n- 영수증 사진만 올리면 금액이 채워져야 한다.\n- 첫 버전에는 회계 시스템 연동이 없어도 된다.\n';
ev('dependency.linked', 'T01', USER, 'Planning', { from: { external_ref: art(BRIEF) }, to: { task_id: 'T01', slot: 'brief' } });
link('T01', 'requirements', 'T02', 'requirements');
link('T01', 'requirements', 'T05', 'requirements');
link('T01', 'requirements', 'T09', 'requirements');
link('T05', 'field_rules', 'T06', 'field_rules');
link('T05', 'ocr_api_spec', 'T07', 'ocr_api_spec');
link('T05', 'ocr_api_spec', 'T10', 'ocr_api_spec');
link('T06', 'amount_parser', 'T08', 'amount_parser');
link('T07', 'image_store', 'T08', 'image_store');
link('T02', 'schema', 'T03', 'schema');
link('T09', 'screen_flow', 'T03', 'screen_flow');
link('T03', 'claim_api', 'T04', 'claim_api');
link('T03', 'claim_api', 'T11', 'claim_api');
link('T09', 'ui_mock', 'T11', 'ui_mock');
link('T09', 'ui_mock', 'T10', 'ui_mock');

at(1, '09:20');
for (const t of ['T01', 'T02', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11']) simpleFlow(t);
ev('workflow.bound', 'T03', CATENA, 'Graph Design', {
  task_id: 'T03',
  nodes: [
    { node_id: 'plan', name: '작업 나누기', stage: '계획', executor: 'agent', role: 'Manager' },
    { node_id: 'impl-api', name: '청구 핸들러 구현', stage: '구현', executor: 'agent', role: 'Worker' },
    { node_id: 'check-api', name: '청구 단위 테스트', stage: '검증', executor: 'code' },
    { node_id: 'review-api', name: 'API 계약 검토', stage: '검증', executor: 'agent', role: 'Reviewer' },
    { node_id: 'impl-limit', name: '한도 검사 구현', stage: '구현', executor: 'agent', role: 'Worker' },
    { node_id: 'check-limit', name: '한도 테스트', stage: '검증', executor: 'code' },
    { node_id: 'approve', name: '검수 승인', stage: '승인', executor: 'human', role: '승인자' },
  ],
  edges: [
    { from: 'plan', to: 'impl-api', kind: '분기' }, { from: 'plan', to: 'impl-limit', kind: '분기' },
    { from: 'impl-api', to: 'check-api', kind: '순차' }, { from: 'check-api', to: 'impl-api', kind: '반복' },
    { from: 'check-api', to: 'review-api', kind: '순차' },
    { from: 'impl-limit', to: 'check-limit', kind: '순차' }, { from: 'check-limit', to: 'impl-limit', kind: '반복' },
    { from: 'review-api', to: 'approve', kind: '합류' }, { from: 'check-limit', to: 'approve', kind: '합류' },
  ],
});
ev('milestone.defined', 'M1', USER, 'Planning', { milestone_id: 'M1', name: '영수증 인식 완성',
  items: [{ task_id: 'T05', slot: 'ocr_api_spec' }, { task_id: 'T05', slot: 'field_rules' }, { task_id: 'T06' }, { task_id: 'T07' }, { task_id: 'T08' }] });
ev('milestone.defined', 'M2', USER, 'Planning', { milestone_id: 'M2', name: '청구 기능 첫 동작',
  items: [{ task_id: 'T02' }, { task_id: 'T03' }, { task_id: 'T04' }, { task_id: 'T11' }] });

// ================= 1일차: T01 요구사항 =================
const REQ = [
  '# 사내 경비 정산 서비스 요구사항 v1', '',
  '| ID | 요구사항 | 수용 기준 |', '|---|---|---|',
  '| R-01 | 영수증 사진을 올린다 | JPG·PNG, 10MB 이하 |',
  '| R-02 | 영수증에서 금액과 날짜를 읽는다 | 부가세를 분리하고 1원 단위는 내림 |',
  '| R-03 | 경비를 청구한다 | 영수증 1장 이상 첨부 |',
  '| R-04 | 월 한도를 넘는 청구를 막는다 | 직원별 월 50만 원 |',
  '| R-05 | 자기 청구를 취소한다 | 승인 전까지 |',
  '| R-06 | 회계 시스템 연동 | v1 범위 제외 |',
];
at(1, '09:30'); runStart('T01', 'R01-1'); start('R01-1', 'work', 1, W(4));
at(1, '09:50'); act('R01-1', 'work', 1, W(4), '도구 호출', 'docs/requirements.md 작성', '시스템 기록');
at(1, '10:05'); act('R01-1', 'work', 1, W(4), '메시지', '요구사항 6개를 ID와 수용 기준으로 정리했습니다', 'Agent 보고');
at(1, '10:10'); submit('R01-1', 'work', 'S01-1', [{ output_slot: 'requirements', path: 'docs/requirements.md', artifact_ref: art(REQ.join('\n') + '\n') }], diff('docs/requirements.md', REQ));
usage('R01-1', 'work', 0.39); finish('R01-1', 'work', 1, W(4));
at(1, '10:12'); start('R01-1', 'check', 1, TEST);
evidence('S01-1', 'E01-1', 'T01-C1', '통과', log('npm run lint:requirements', ['requirements.md: 6개 요구사항, ID 누락 0, 수용 기준 누락 0', 'PASS']));
finish('R01-1', 'check', 1, TEST);
at(1, '10:15'); start('R01-1', 'approve', 1, USER); request('S01-1', 'A01-1', ['T01-C2']);
at(1, '10:40'); decide('A01-1', '회계 연동(R-06)을 범위 제외로 둔 것 확인');
accept('AC01-1', 'T01', 'requirements', 'S01-1', ['T01-C1', 'T01-C2'], ['E01-1'], 'A01-1');
accept('AC01-2', 'T01', null, 'S01-1', [], [], 'A01-1');
finish('R01-1', 'approve', 1, USER); runEnd('R01-1', '종료');

// ================= 1일차: T05·T02·T09 병렬 =================
at(1, '11:00'); runStart('T05', 'R05-1'); start('R05-1', 'work', 1, W(5));
runStart('T02', 'R02-1'); start('R02-1', 'work', 1, W(1));
at(1, '11:05'); runStart('T09', 'R09-1'); start('R09-1', 'work', 1, W(6));

const SQL1 = ['CREATE TABLE claims (id INTEGER PRIMARY KEY, employee_id INTEGER REFERENCES employees(id), amount INTEGER NOT NULL, status TEXT NOT NULL);',
  'CREATE TABLE receipts (id INTEGER PRIMARY KEY, claim_id INTEGER REFERENCES claims(id), image_key TEXT, total INTEGER, issued_on TEXT);'];
at(1, '11:40'); act('R02-1', 'work', 1, W(1), '도구 호출', 'db/migrations/001_init.up.sql 작성 (claims, receipts)', '시스템 기록');
at(1, '11:50'); submit('R02-1', 'work', 'S02-1', [{ output_slot: 'schema', path: 'db/migrations/' }], diff('db/migrations/001_init.up.sql', SQL1));
usage('R02-1', 'work', 0.51); finish('R02-1', 'work', 1, W(1));
at(1, '11:52'); start('R02-1', 'check', 1, TEST);
evidence('S02-1', 'E02-1', 'T02-C1', '실패', log('npm run migrate:check', ['apply 001_init ... ok', 'check references ... FAIL', 'error: claims.employee_id가 가리키는 employees 테이블이 없음']));
finish('R02-1', 'check', 1, TEST, '실패');

at(1, '12:00'); act('R09-1', 'work', 1, W(6), '도구 호출', 'docs/screens.md 작성 (화면 흐름 5개)', '시스템 기록');
at(1, '12:05'); start('R02-1', 'work', 2, W(1));
act('R02-1', 'work', 2, W(1), '메시지', '참조 검사 실패 원인은 employees 테이블 누락입니다. 추가하겠습니다', 'Agent 보고');
at(1, '12:20'); act('R05-1', 'work', 1, W(5), '도구 호출', 'docs/receipt-api.yaml 작성 (OpenAPI 3.1, /receipts, /receipts/{id})', '시스템 기록');
at(1, '12:30'); submit('R02-1', 'work', 'S02-2', [{ output_slot: 'schema', path: 'db/migrations/' }],
  diff('db/migrations/000_employees.up.sql', ['CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, monthly_limit INTEGER NOT NULL);']));
usage('R02-1', 'work', 0.27); finish('R02-1', 'work', 2, W(1));
at(1, '12:32'); start('R02-1', 'check', 2, TEST);
evidence('S02-2', 'E02-2', 'T02-C1', '통과', log('npm run migrate:check', ['apply 000_employees ... ok', 'apply 001_init ... ok', 'check references ... ok', 'PASS']));
finish('R02-1', 'check', 2, TEST);
at(1, '12:35'); start('R02-1', 'approve', 1, USER); request('S02-2', 'A02-1', ['T02-C2', 'T02-C3']);

const SCREENS = ['# 화면 흐름', '- F1 영수증 올리기 (R-01, R-02)', '- F2 청구 만들기 (R-03)', '- F3 한도 초과 안내 (R-04)', '- F4 내 청구 (R-05)', '- F5 읽은 금액 고치기 (R-02)'];
const MOCK = ['# 와이어프레임', '[올리기] 사진 끌어 놓기 | 파일 고르기', '[청구] 금액·날짜(영수증에서 채움), 사용처, 제출 버튼', '[내 청구] 상태별 목록, 취소 버튼'];
at(1, '12:50'); act('R09-1', 'work', 1, W(6), '도구 호출', 'docs/ui-mock.md 와이어프레임 작성', '시스템 기록');
at(1, '13:00'); submit('R09-1', 'work', 'S09-1', [
  { output_slot: 'screen_flow', path: 'docs/screens.md', artifact_ref: art(SCREENS.join('\n') + '\n') },
  { output_slot: 'ui_mock', path: 'docs/ui-mock.md', artifact_ref: art(MOCK.join('\n') + '\n') }],
  diff('docs/screens.md', SCREENS) + diff('docs/ui-mock.md', MOCK));
usage('R09-1', 'work', 0.44); finish('R09-1', 'work', 1, W(6));
at(1, '13:02'); start('R09-1', 'check', 1, TEST);
evidence('S09-1', 'E09-1', 'T09-C1', '통과', log('npm run check:coverage -- docs/screens.md', ['R-01..R-05 모두 화면 흐름에 연결됨 (R-06 범위 제외)', 'PASS']));
finish('R09-1', 'check', 1, TEST);
at(1, '13:05'); start('R09-1', 'approve', 1, USER); request('S09-1', 'A09-1', ['T09-C2']);

const RECEIPT_API = ['openapi: 3.1.0', 'paths:', '  /receipts: { post: { summary: 영수증 올리기 } }', '  /receipts/{id}: { get: { summary: 인식 결과 조회 } }'];
const RULES = ['# 금액 추출 규칙', '- 합계는 부가세를 포함한 금액으로 읽는다 (R-02)', '- 공급가액 = 합계 ÷ 1.1, 1원 단위 끝수는 내림', '- 날짜를 읽지 못하면 사람이 입력한다'];
at(1, '13:20'); act('R05-1', 'work', 1, W(5), '도구 호출', 'docs/extract-rules.md 작성', '시스템 기록');
at(1, '13:30'); act('R05-1', 'work', 1, W(5), '메시지', '영수증 API 명세와 금액 추출 규칙 두 문서를 작성했습니다', 'Agent 보고');
submit('R05-1', 'work', 'S05-1', [
  { output_slot: 'ocr_api_spec', path: 'docs/receipt-api.yaml', artifact_ref: art(RECEIPT_API.join('\n') + '\n') },
  { output_slot: 'field_rules', path: 'docs/extract-rules.md', artifact_ref: art(RULES.join('\n') + '\n') }],
  diff('docs/receipt-api.yaml', RECEIPT_API) + diff('docs/extract-rules.md', RULES));
usage('R05-1', 'work', 0.58); finish('R05-1', 'work', 1, W(5));
at(1, '13:32'); start('R05-1', 'check', 1, TEST);
evidence('S05-1', 'E05-1', 'T05-C1', '통과', log('npx openapi-lint docs/receipt-api.yaml', ['0 errors, 0 warnings', 'PASS']));
finish('R05-1', 'check', 1, TEST);
at(1, '13:35'); start('R05-1', 'approve', 1, USER); request('S05-1', 'A05-1', ['T05-C3']);

at(1, '14:00'); decide('A02-1', '청구·한도·취소에 필요한 컬럼 확인');
accept('AC02-1', 'T02', 'schema', 'S02-2', ['T02-C1', 'T02-C2'], ['E02-2'], 'A02-1');
accept('AC02-2', 'T02', null, 'S02-2', ['T02-C3'], [], 'A02-1');
finish('R02-1', 'approve', 1, USER); runEnd('R02-1', '종료');

at(1, '15:00'); decide('A09-1', '와이어프레임 확인');
accept('AC09-1', 'T09', 'screen_flow', 'S09-1', ['T09-C1'], ['E09-1'], 'A09-1');
accept('AC09-2', 'T09', 'ui_mock', 'S09-1', ['T09-C2'], [], 'A09-1');
accept('AC09-3', 'T09', null, 'S09-1', [], [], 'A09-1');
finish('R09-1', 'approve', 1, USER); runEnd('R09-1', '종료');

// T05는 금액 추출 규칙만 먼저 인수하고, 영수증 API 명세는 개인정보 검토 승인을 기다린다.
at(1, '15:30'); decide('A05-1', '추출 규칙 먼저 승인. API 명세는 개인정보 검토 후');
accept('AC05-1', 'T05', 'field_rules', 'S05-1', ['T05-C3'], [], 'A05-1');
at(1, '15:35'); request('S05-1', 'A05-2', ['T05-C2']);

// ================= 2일차 =================
const AMOUNT_TS = ['export function parse(total: number) {', '  return { total, supply: Math.round(total / 1.1) };', '}'];
const failLog = (n: number) => log('npm test -- tests/receipt/amount.test.ts', [
  '✓ 합계 금액을 읽는다', '✓ 부가세를 분리한다',
  `✗ 공급가액의 1원 단위 끝수는 내림한다 (시도 ${n})`, '  expected parse(11001).supply to be 10000, got 10001', 'FAIL 1 of 3']);

at(2, '09:00'); runStart('T06', 'R06-1'); start('R06-1', 'work', 1, W(3));
at(2, '09:10'); ev('wbs_node.closed', 'T12', USER, 'Planning', { node_id: 'T12', lifecycle: '취소됨', reason: '요구사항 R-06(회계 시스템 연동)이 v1 범위에서 빠짐' });
at(2, '09:30');
contract('T13', '테스트와 배포를 자동으로 돌리는 CI 파이프라인을 만든다', '운영 서버 구성', ['.ci/'],
  [], [['pipeline', '설정']],
  [['T13-C1', 'CI 파이프라인 시험 실행 성공', 'auto', 'pipeline'], ['T13-C2', '배포 권한 검토', 'human']]);
simpleFlow('T13');
// 운영 반영은 서버·화면 결과와 파이프라인이 모두 인수돼야 착수한다. 파이프라인(T13)은 구현과 따로 먼저 만들 수 있다.
contract('T14', '인수된 서버와 화면을 파이프라인으로 운영 서버에 반영한다', '무중단 배포', ['deploy/'],
  ['receipt_test_report', 'limit_test_report', 'claim_ui', 'upload_ui', 'pipeline'], [['release', '배포 기록']],
  [['T14-C1', '스테이징 반영 뒤 스모크 시험 통과', 'auto', 'release'], ['T14-C2', '운영 반영 승인', 'human', 'release']]);
simpleFlow('T14');
link('T08', 'receipt_test_report', 'T14', 'receipt_test_report');
link('T04', 'limit_test_report', 'T14', 'limit_test_report');
link('T11', 'claim_ui', 'T14', 'claim_ui');
link('T10', 'upload_ui', 'T14', 'upload_ui');
link('T13', 'pipeline', 'T14', 'pipeline');
at(2, '09:40'); act('R06-1', 'work', 1, W(3), '도구 호출', 'src/receipt/amount.ts 작성', '시스템 기록');
at(2, '09:50'); submit('R06-1', 'work', 'S06-1', [{ output_slot: 'amount_parser', path: 'src/receipt/amount.ts' }], diff('src/receipt/amount.ts', AMOUNT_TS));
usage('R06-1', 'work', 0.36); finish('R06-1', 'work', 1, W(3));
at(2, '09:52'); start('R06-1', 'check', 1, TEST); evidence('S06-1', 'E06-1', 'T06-C1', '실패', failLog(1)); finish('R06-1', 'check', 1, TEST, '실패');

at(2, '10:00'); runStart('T03', 'R03-1'); start('R03-1', 'plan', 1, MGR);
at(2, '10:05');
ev('wait.raised', 'T13', CATENA, 'Resource', { wait_id: 'W-T13-budget', wait_type: 'resource', target_id: 'T13',
  resolve_condition: '예약 가능한 예산 $3.50 이상 필요', action: { actor: '시스템', text: 'T03 실행의 비용 정산 대기', screen: 'Project 개요' } });
start('R06-1', 'work', 2, W(3));
act('R06-1', 'work', 2, W(3), '메시지', '반올림을 올림으로 바꿨습니다', 'Agent 보고');
at(2, '10:10');
act('R03-1', 'plan', 1, MGR, '메시지', '청구 API를 CRUD 핸들러와 월 한도 검사로 나눠 맡깁니다', 'Agent 보고',
  { raw_ref: art(transcript([['manager-1', '계약 T03의 조건 3개를 보면 CRUD와 한도 검사는 서로 다른 파일을 고친다.'], ['manager-1', 'worker-1: src/api/claims.ts, worker-2: src/domain/limit.ts로 나눈다.']])) });
at(2, '10:12');
act('R03-1', 'plan', 1, MGR, '위임', '청구 CRUD 핸들러 구현을 맡김', '시스템 기록', { to_instance: 'worker-1' });
act('R03-1', 'plan', 1, MGR, '위임', '월 한도 검사 구현을 맡김', '시스템 기록', { to_instance: 'worker-2' });
at(2, '10:15'); usage('R03-1', 'plan', 0.22); finish('R03-1', 'plan', 1, MGR);
start('R03-1', 'impl-api', 1, W(1)); start('R03-1', 'impl-limit', 1, W(2));

at(2, '10:30'); submit('R06-1', 'work', 'S06-2', [{ output_slot: 'amount_parser', path: 'src/receipt/amount.ts' }],
  diff('src/receipt/amount.ts', ['  return { total, supply: Math.ceil(total / 1.1) };']));
usage('R06-1', 'work', 0.27); finish('R06-1', 'work', 2, W(3));
at(2, '10:32'); start('R06-1', 'check', 2, TEST); evidence('S06-2', 'E06-2', 'T06-C1', '실패', failLog(2)); finish('R06-1', 'check', 2, TEST, '실패');
at(2, '10:40'); start('R06-1', 'work', 3, W(3));

const API_TS = ['router.post("/claims", create);', 'router.get("/claims", list);', 'router.delete("/claims/:id", cancel);'];
at(2, '11:00'); act('R03-1', 'impl-api', 1, W(1), '도구 호출', 'src/api/claims.ts 작성 (생성·조회·취소)', '시스템 기록',
  { raw_ref: art(transcript([['tool', 'Edit src/api/claims.ts (+52 -0)'], ['worker-1', '생성·조회·취소 핸들러를 추가했다. 조회는 직원별로 거른다.']])) });
at(2, '11:20'); act('R06-1', 'work', 3, W(3), '메시지', '모든 테스트를 통과했습니다', 'Agent 보고',
  { raw_ref: art(transcript([['worker-3', '끝수 처리를 반올림 보정으로 바꿨고 로컬에서 테스트가 통과했다고 판단한다.'], ['worker-3', '모든 테스트를 통과했습니다.']])) });
submit('R06-1', 'work', 'S06-3', [{ output_slot: 'amount_parser', path: 'src/receipt/amount.ts' }],
  diff('src/receipt/amount.ts', ['  return { total, supply: Math.trunc(total / 1.1 + 0.5) };']));
usage('R06-1', 'work', 0.31); finish('R06-1', 'work', 3, W(3));
at(2, '11:22'); start('R06-1', 'check', 3, TEST); evidence('S06-3', 'E06-3', 'T06-C1', '실패', failLog(3)); finish('R06-1', 'check', 3, TEST, '실패');
at(2, '11:25'); runEnd('R06-1', '실패', '수정 반복 상한 3회 도달');
ev('wait.raised', 'T06', CATENA, 'Execution', { wait_id: 'W-T06-decision', wait_type: 'decision', target_id: 'T06',
  resolve_condition: '다음 진행을 사용자가 정해야 함', action: { actor: '사용자', text: '실패한 검사 로그를 보고 다시 실행할지 결정', screen: 'Task 상세' } });

at(2, '11:40'); act('R03-1', 'impl-limit', 1, W(2), '도구 호출', 'src/domain/limit.ts 작성 시작', '시스템 기록');
at(2, '12:00'); act('R03-1', 'impl-api', 1, W(1), '도구 호출', 'npm test -- claims (로컬 실행)', '시스템 기록');
at(2, '12:10'); act('R03-1', 'impl-api', 1, W(1), '메시지', 'CRUD 핸들러 구현을 마쳤습니다', 'Agent 보고');
at(2, '12:15'); submit('R03-1', 'impl-api', 'S03-1', [{ output_slot: 'claim_api', path: 'src/api/claims.ts' }], diff('src/api/claims.ts', API_TS));
usage('R03-1', 'impl-api', 0.69); finish('R03-1', 'impl-api', 1, W(1));
at(2, '12:17'); start('R03-1', 'check-api', 1, TEST);
evidence('S03-1', 'E03-1', 'T03-C1', '통과', log('npm test -- tests/api/claims.test.ts', ['✓ 청구를 만든다', '✓ 직원별로 조회한다', '✓ 청구를 취소한다', 'PASS 3 of 3']));
finish('R03-1', 'check-api', 1, TEST);
at(2, '12:20'); start('R03-1', 'review-api', 1, RV);
at(2, '12:40'); act('R03-1', 'review-api', 1, RV, '판단', '응답 형식은 API 계약과 일치한다. 청구 목록에 반려 사유 필드가 빠졌다', 'Agent 보고',
  { raw_ref: art(transcript([['reviewer-1', 'POST /claims 응답 필드가 계약과 같다.'], ['reviewer-1', 'GET /claims 응답에 반려 사유(reject_reason)가 없다. 한도 초과(R-04)로 막힌 청구를 구분하려면 필요하다.']])) });
at(2, '13:00'); act('R03-1', 'impl-limit', 1, W(2), '메시지', '월 한도 합산 규칙을 구현하고 있습니다', 'Agent 보고');

write(join(dirname(fileURLToPath(import.meta.url)), 'expense'),
  '사내 경비 정산 서비스 개발 2일차 오후의 공정. 만든 데이터이며 실제 실행이 아니다. Product MVP 사용자 시험의 두 번째 시나리오다. Agent 노드의 Runtime·모델 구성(Codex 포함)은 확장 단계를 가정한 값이다.');
