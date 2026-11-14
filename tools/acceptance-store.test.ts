// 검수표 시험(T36-C1): 검수할 Task 고르기, 결정 저장·재조회·잘못된 입력 거부·동시 수정 충돌 거부, 측정표 저장이 다른 열을 보존하는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDecisions, loadSheet, parseCsv, reviewItems, saveDecision, saveSheet, writeCsv } from './acceptance-store.ts';

const plan = JSON.parse(readFileSync(new URL('../plan/catena.plan.json', import.meta.url), 'utf8'));
const accepted = JSON.parse(readFileSync(new URL('../plan/accepted.json', import.meta.url), 'utf8'));

test('T36-C1: 사람 확인 조건이 남은 Task만 고르고, 선행 Task가 검수된 것만 지금 검수할 것으로 둔다', () => {
  const items = reviewItems(plan, accepted);
  const done = new Set(accepted.map((a: any) => a.task_id));
  assert.ok(items.length && items.every(i => !done.has(i.task_id) && i.conditions.length), '검수된 Task와 auto 조건만 있는 Task는 빠진다');
  assert.ok(items.every(i => i.conditions.every(c => /-C\d+$/.test(c.id))));
  const t07 = items.find(i => i.task_id === 'T07');
  assert.ok(t07 && !t07.now, 'T07은 T06을 기다린다');
  assert.ok(items.some(i => i.now), '지금 검수할 Task가 있다');
});

test('T36-C1: 결정은 승인·반려·보류만, 반려는 이유가 있어야 하며, 다른 화면에서 바꾼 결정은 덮어쓰지 않는다', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'catena-accept-')), 'acceptance.json');
  const ids = ['T35-C2'];
  assert.deepEqual(loadDecisions(file), {});
  const d = saveDecision(file, ids, 'T35-C2', { decision: '승인', note: '', revision: 0 });
  assert.equal(loadDecisions(file)['T35-C2'].decision, '승인');
  assert.throws(() => saveDecision(file, ids, 'T35-C2', { decision: '승인', note: '', revision: 0 }), /다른 화면/);
  assert.throws(() => saveDecision(file, ids, 'T35-C2', { decision: '삭제', note: '', revision: d.revision }), /승인·반려·보류/);
  assert.throws(() => saveDecision(file, ids, 'T35-C2', { decision: '반려', note: ' ', revision: d.revision }), /이유/);
  assert.throws(() => saveDecision(file, ids, 'T99-C1', { decision: '승인', note: '', revision: 0 }), /검수할 조건이 아닙니다/);
  assert.equal(saveDecision(file, ids, 'T35-C2', { decision: '반려', note: '내보내기가 안 된다', revision: d.revision }).revision, 2);
});

test('T36-C1: 측정표 저장은 사용자 열만 바꾸고 과제 문장·정답 열과 BOM을 보존하며, 숫자 칸과 충돌을 확인한다', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'catena-sheet-')), 'sheet.csv');
  copyFileSync(new URL('../docs/user-test-results.csv', import.meta.url), file);
  const before = loadSheet(file);
  const q1 = before.rows[0];
  const saved = saveSheet(file, { revision: before.revision, rows: [{ 블록: q1['블록'], 과제: q1['과제'], '답(요약)': 'T01, T02 완료, "따옴표", 쉼표', '이동 수': '2', 정답: 'O' }] });
  assert.equal(saved.rows[0]['답(요약)'], 'T01, T02 완료, "따옴표", 쉼표');
  assert.equal(saved.rows[0]['이동 수'], '2');
  assert.equal(saved.rows[0]['정답(O/X)'], q1['정답(O/X)'], '사용자 열이 아닌 칸은 바꾸지 않는다');
  assert.deepEqual(saved.rows.map(r => r['과제 문장']), before.rows.map(r => r['과제 문장']));
  assert.ok(readFileSync(file, 'utf8').startsWith('﻿'));
  assert.throws(() => saveSheet(file, { revision: before.revision, rows: [] }), /다른 화면/);
  assert.throws(() => saveSheet(file, { revision: saved.revision, rows: [{ 블록: q1['블록'], 과제: q1['과제'], '이동 수': '두 번' }] }), /숫자/);
  assert.throws(() => saveSheet(file, { revision: saved.revision, rows: [{ 블록: '9', 과제: 'Q1' }] }), /없는 과제/);
  assert.deepEqual(parseCsv(writeCsv([['a', 'b,c', 'd"e', 'f\ng']])), [['a', 'b,c', 'd"e', 'f\ng']]);
});
