// Catena 제작 공정(CLAUDE.md 「Catena 제작 공정」): 계획 파일과 사람 인수 기록을 검사하고 Task 상태를 글로 보여 준다.
// 접는 규칙은 planfold.ts에 있고 화면(?data=catena)도 같은 코드를 쓴다.
// 사용: node tools/plan.ts [--hash <Task ID>]   (--hash: 인수 기록에 적을 계약 해시)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { card, CLOSED } from './readmodel.ts';
import { foldPlan as fold } from './planfold.ts';
import { describe } from './fold.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const foldPlan = (plan: any, accepted: any[]) => fold(plan, accepted, sha);

export function loadPlan(dir = join(import.meta.dirname, '..', 'plan')) {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const plan = read('catena.plan.json');
  const accepted: any[] = read('accepted.json');
  return { plan, accepted, ...foldPlan(plan, accepted) };
}

function main() {
  let r;
  try { r = loadPlan(); } catch (err) {
    console.error(`계획 검사 실패\n  ${(err as Error).message}`);
    process.exit(1);
  }
  const { model: m, accepted, contractHash } = r;
  const at = process.argv.indexOf('--hash');
  if (at > 0) { console.log(contractHash(process.argv[at + 1]) ?? '계획에 없는 Task'); return; }
  const tasks = [...m.nodes.values()].filter(n => n.kind === 'task' && !CLOSED.includes(n.lifecycle));
  const ready = tasks.filter(n => card(m, n.id).rep === '착수 가능');
  console.log([
    `[계획 파일] plan/catena.plan.json · Task ${tasks.length}개 · 사람 인수 ${accepted.length}건 · 검사 통과`,
    '작업은 Catena가 시작하지 않은 Coding Agent 세션에서 한다(0-11). 인수는 사용자가 대화에서 승인한 기록이다(plan/accepted.json).',
    `지금 착수할 수 있는 Task: ${ready.map(n => `${n.id}: ${n.name}`).join(', ') || '없음'}`,
    '',
    ...describe(m),
  ].join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
