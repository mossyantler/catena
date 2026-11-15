// 확정된 이벤트 형식 버전 1(T34-C1): 두 시나리오 묶음이 형식에 맞고, 형식을 어긴 이벤트는 이유와 함께 걸린다.
// Engine이 발행하는 이벤트는 명령 계층이 같은 검사로 거부하므로, engine 시험 전체(mvp.test.ts의 A → B 포함)가 그 확인이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatErrors } from './eventformat.ts';

const bundle = (name: string) => readFileSync(join(import.meta.dirname, '..', 'scenarios', name, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('T34-C1: 두 시나리오 묶음의 이벤트가 모두 형식 버전 1에 맞는다', () => {
  for (const name of ['roombook', 'expense']) {
    const bad = bundle(name).map(e => ({ seq: e.seq, errs: formatErrors(e) })).filter(x => x.errs.length);
    assert.deepEqual(bad, [], name);
  }
});

test('T34: 형식을 어긴 이벤트는 어디가 틀렸는지 알려 준다', () => {
  const actor = { kind: 'system', instance: 'orchestrator' };
  assert.deepEqual(formatErrors({ type: 'approval.requested', actor, payload: { approval_id: 'a', kind: '검수', condition_ids: [] } }), ['kind 값 검수']);
  assert.deepEqual(formatErrors({ type: 'wait.resolved', actor, payload: { wait_id: 'w', extra: 1 } }), ['형식에 없는 필드 extra']);
  assert.deepEqual(formatErrors({ type: 'node.finished', actor, payload: { run_id: 'r', node_id: 'n', iteration: 1 } }), ['필수 필드 result 없음']);
  assert.deepEqual(formatErrors({ type: 'run.renamed', actor, payload: {} }), ['형식에 없는 유형 run.renamed']);
  assert.deepEqual(formatErrors({ type: 'wait.resolved', actor: { kind: 'robot' }, payload: { wait_id: 'w' } }), ['actor {"kind":"robot"}']);
});
