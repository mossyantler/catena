// Agent 계획을 공정으로(T38): Claude Code나 Codex에 goal을 주어 작업 분해를 계획 파일 형식(JSON)으로 받고,
// plan import와 같은 검사(계획 파일 형식, 읽기 모델 E2~E4·E11)를 거쳐 불러온다. 어기면 아무것도 남기지 않고 이유를 돌려준다.
// Agent는 계획만 낸다: Claude Code는 plan 권한 모드, Codex는 read-only로 띄워 저장소를 바꾸지 않게 한다.
import { lines, start } from './runner.ts';
import { prepareCodex } from './codex.ts';
import { prepare } from './runner.ts';
import { AGENTS, execute, type Reason } from './commands.ts';
import type { Store } from './store.ts';

export function plannerPrompt(goal: string, projectId: string): string {
  return [
    '다음 goal을 이룰 작업 분해(공정 계획)를 만든다. 코드는 바꾸지 말고, 설명 없이 JSON 하나만 출력한다.',
    `goal: ${goal}`,
    '형식(Catena 계획 파일):',
    `{"project":{"project_id":"${projectId}","name":"<프로젝트 이름>"},"phases":[{"id":"P1","name":"설계"},{"id":"P2","name":"구현"},{"id":"P3","name":"시험"}],`,
    ' "milestones":[],"wbs":[{"id":"T01","name":"<대상 + 일의 종류(…구현, …설계, …시험)>","phase":"P2","goal":"<무엇을 만드는지>",',
    '  "inputs":{"<입력 항목>":"<선행 Task ID>.<그 Task의 결과 항목>"},"outputs":{"<결과 항목>":"코드"},',
    '  "conditions":[{"id":"T01-C1","method":"auto","slot":"<결과 항목>","text":"<완료 조건>","verify":{"command":"<검사 명령>"}}],',
    `  "agent":"<${AGENTS.join(' 또는 ')}>"}]}`,
    '규칙: Task끼리의 순서는 inputs로만 표현하고 순환이 없어야 한다. inputs는 이미 있는 Task의 결과 항목만 가리킨다.',
    '사람이 확인해야 하는 조건은 method를 "human"으로 두고 verify를 적지 않는다.',
  ].join('\n');
}

/** Agent 출력에서 계획 JSON을 꺼낸다. 코드 블록이나 앞뒤 설명이 있어도 가장 바깥 중괄호를 찾는다. */
export function extractPlan(text: string): any {
  const t = text.replace(/```(?:json)?/g, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('Agent 출력에 계획 JSON이 없다');
  return JSON.parse(t.slice(i, j + 1));
}

/** Agent를 한 번 띄워 마지막 응답 글을 받는다. Claude Code는 result 메시지, Codex는 마지막 agent_message다. */
export async function askAgent(o: { agent: string; prompt: string; cwd: string; tmpDir: string; command?: string[] }): Promise<string> {
  const spec = o.agent === 'codex'
    ? { ...prepareCodex({ command: o.command, worktree: o.cwd, tmpDir: o.tmpDir, prompt: o.prompt }) }
    : prepare({ command: o.command, worktree: o.cwd, tmpDir: o.tmpDir, prompt: o.prompt, permissionMode: 'plan', maxTurns: 20 });
  if (o.agent === 'codex') spec.argv = spec.argv.map(a => (a === 'workspace-write' ? 'read-only' : a)); // 계획만 낸다
  const h = start(spec);
  let last = '';
  for await (const msg of lines(h, [])) {
    if (msg.type === 'result' && typeof msg.result === 'string') last = msg.result;
    if (msg.type === 'item.completed' && msg.item?.type === 'agent_message' && msg.item.text) last = msg.item.text;
  }
  const code = await h.exit;
  if (!last) throw new Error(`Agent가 응답 없이 끝났다(종료 코드 ${code})`);
  return last;
}

export type GoalPlanResult = { ok: true; plan: any; version: number } | { ok: false; reason: Reason | '형식 오류'; message: string; plan?: any };

/** Agent가 낸 계획을 plan import로 불러온다. 형식이나 검사 규칙을 어기면 아무것도 남기지 않는다. */
export function importAgentPlan(s: Store, text: string): GoalPlanResult {
  let plan: any;
  try { plan = extractPlan(text); } catch (err) { return { ok: false, reason: '형식 오류', message: (err as Error).message }; }
  const r = execute(s, { command: 'plan.import', principal: { kind: 'human', id: 'user' }, channel: 'cli-batch', args: { plan } });
  return r.ok ? { ok: true, plan, version: r.version } : { ok: false, reason: r.reason, message: r.message, plan };
}
