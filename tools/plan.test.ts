// Catena 제작 공정의 계획 파일과 사람 인수 기록 시험 (tools/plan.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlan, foldPlan } from './plan.ts';
import { card } from './readmodel.ts';

test('Catena 제작 계획이 검사 규칙을 통과하고, 인수 기록이 의존 순서와 계약 버전을 지킨다', () => {
  const { model: m, accepted } = loadPlan();
  for (const a of accepted) assert.equal(card(m, a.task_id).rep, '인수됨');
});

test('인수 기록: 입력 슬롯이 인수되기 전이거나 계약이 바뀐 뒤의 인수, 순환하는 계획을 거부한다', () => {
  const t = (id: string, inputs?: Record<string, string>) => ({
    id, name: id, phase: 'P1', goal: id, inputs, outputs: { out: '코드' },
    conditions: [{ id: `${id}-C1`, method: 'auto', slot: 'out', text: '시험' }],
  });
  const plan = { project: { project_id: 'p', name: 'p' }, phases: [{ id: 'P1', name: '설계' }], wbs: [t('A'), t('B', { in: 'A.out' })], milestones: [] };
  const { contractHash } = foldPlan(plan, []);
  const ok = (id: string) => ({ task_id: id, contract: contractHash(id), evidence: { [`${id}-C1`]: '통과' }, approved_at: '2026-11-11', channel: '대화' });

  assert.equal(card(foldPlan(plan, [ok('A'), ok('B')]).model, 'B').rep, '인수됨');
  assert.equal(card(foldPlan(plan, [ok('A')]).model, 'B').rep, '착수 가능');
  assert.throws(() => foldPlan(plan, [ok('B')]), /입력 슬롯이 인수되기 전/);
  assert.throws(() => foldPlan(plan, [{ ...ok('A'), contract: 'sha256:00' }]), /계약이 바뀌었다/);
  assert.throws(() => foldPlan(plan, [{ ...ok('A'), evidence: {} }]), /A-C1의 증거가 없다/);
  assert.throws(() => foldPlan({ ...plan, wbs: [t('A', { in: 'B.out' }), t('B', { in: 'A.out' })] }, []), /E4: 순환/);
});
