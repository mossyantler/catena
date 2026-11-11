// 데이터 묶음을 Node에서 불러와 검사하고 읽기 모델을 글로 보여 준다. 규칙과 계산은 readmodel.ts에 있다.
// 사용: node tools/fold.ts <데이터 묶음 폴더> [--at N]
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkStream, foldAll, card, waitsOf, edgesAt, CLOSED, type Ref } from './readmodel.ts';

export { card, edgesAt } from './readmodel.ts';

export function foldBundle(dir: string, at?: number) {
  const manifest = JSON.parse(readFileSync(join(dir, 'dataset.json'), 'utf8'));
  const events = checkStream(manifest, readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean));
  const refCheck = (r: Ref) => {
    const f = join(dir, 'artifacts', 'sha256', r.id.slice(7));
    if (!existsSync(f)) return '원문 파일 없음';
    if (createHash('sha256').update(readFileSync(f)).digest('hex') !== r.id.slice(7)) return '해시 불일치';
  };
  const pos = at ?? manifest.default_position ?? events.length;
  return { manifest, model: foldAll(events, refCheck, pos), position: pos, total: events.length };
}

function main() {
  const dir = process.argv[2];
  const atArg = process.argv.indexOf('--at');
  const at = atArg > 0 ? Number(process.argv[atArg + 1]) : undefined;
  let r;
  try { r = foldBundle(dir, at); } catch (err) {
    console.error(`검사 실패 — 묶음을 불러오지 않음\n  ${(err as Error).message}`);
    process.exit(1);
  }
  const { manifest, model: m, position, total } = r;
  const out: string[] = [];
  out.push(`[${manifest.origin}] ${manifest.dataset_id} · 재생 위치 ${position} / ${total} · 검사 통과`);
  out.push(`${m.project.name}`);
  const walk = (parent: string | undefined, depth: number) => {
    const kids = [...m.nodes.values()].filter(n => n.parent === parent).sort((a, b) => a.order - b.order);
    for (const n of kids) {
      const pad = '  '.repeat(depth);
      if (n.kind === 'summary') { out.push(`${pad}▸ ${n.name}`); walk(n.id, depth + 1); continue; }
      if (CLOSED.includes(n.lifecycle)) { out.push(`${pad}  (${n.lifecycle}: ${n.id} ${n.name} — 기본 화면에서는 숨김)`); continue; }
      const c = card(m, n.id);
      const phase = m.project.phases.find((p: any) => p.phase_id === n.phase)?.name ?? '-';
      const st = c.stages.length ? ` · ${c.stages.join(', ')}` : '';
      const w = c.waits[0];
      out.push(`${pad}  ${n.id} ${n.name} [${phase}]`);
      out.push(`${pad}    ① ${c.rep}${st}  (실행 ${c.exec} · 인수 ${c.acceptance})`);
      out.push(`${pad}    ② ${c.accepted} / ${c.total} 인수${c.passed ? ` · ${c.passed} 검증 통과(인수 대기)` : ''}`);
      out.push(`${pad}    ③ ${w ? `${w.type}: ${w.resolve}${c.waits.length > 1 ? ` (외 ${c.waits.length - 1}건)` : ''}` : '-'}`);
      out.push(`${pad}    ④ ${w ? `${w.action.actor}: ${w.action.text}` : '-'}`);
    }
  };
  walk(undefined, 0);

  out.push('\n최상위 공정표의 엣지');
  const top = edgesAt(m).edges;
  const name = (id: string) => m.nodes.get(id).name;
  for (const e of top) {
    const back = top.find(x => x.from === e.to && x.to === e.from);
    if (back && e.from > e.to) continue;
    const label = (x: any) => `${name(x.from)} → ${name(x.to)} ${x.count}개(인수 ${x.accepted})`;
    out.push(`  ${e.aggregated ? '[집계]' : '[원본]'} ${back ? `${label(e)} · ${label(back)}  ← 양방향, 순환 아님` : label(e)}`);
  }

  out.push('\n사용자 개입 목록');
  const items = [...m.nodes.values()].filter(n => n.kind === 'task' && n.lifecycle === '활성')
    .flatMap(n => waitsOf(m, n.id).filter(w => w.action.actor === '사용자').map(w => ({ n, w })))
    .sort((a, b) => a.w.raised_at.localeCompare(b.w.raised_at));
  for (const { n, w } of items) out.push(`  ${n.id} ${n.name} — ${w.type}: ${w.action.text} → ${w.action.screen}`);

  out.push('\nMilestone');
  for (const ms of m.milestones.values()) {
    const left = ms.items.filter((it: any) => !(it.slot ? m.slotAccepted.has(`${it.task_id}/${it.slot}`) : m.taskAccepted.has(it.task_id)));
    out.push(`  ${ms.name}: ${ms.items.length - left.length} / ${ms.items.length} 도달 · 남은 항목 ${left.map((it: any) => it.slot ? `${it.task_id}.${it.slot}` : it.task_id).join(', ')}`);
  }

  out.push('\nPhase별 Task 대표 상태');
  for (const ph of m.project.phases) {
    const ts = [...m.nodes.values()].filter(n => n.kind === 'task' && n.phase === ph.phase_id && !CLOSED.includes(n.lifecycle));
    const counts = new Map<string, number>();
    for (const t of ts) { const s = card(m, t.id).rep; counts.set(s, (counts.get(s) ?? 0) + 1); }
    out.push(`  ${ph.name}: ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
  }
  console.log(out.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
