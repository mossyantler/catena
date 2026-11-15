// 검수표(T36): 사용자가 어느 기기에서든 사람 확인 조건에 결정(승인·반려·보류)과 메모를 남기고, 사용자 시험 측정표를 채운다.
// 결정은 저장소 밖 파일에 남긴다. plan/accepted.json의 검수 기록은 Claude가 이 결정을 근거로 적는다(자동 적용 없음).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { card } from './readmodel.ts';
import { foldPlan, planTasks } from './planfold.ts';

import type { Decision, ReviewItem } from './acceptance-types.ts';
const DECISIONS = ['승인', '반려', '보류'];
// 측정표에서 사용자가 채우는 열. 나머지 열(과제 문장, 정답, 기준 이동 수 등)은 그대로 둔다
export const USER_COLUMNS = ['답(요약)', '판단 이유', '이동 수', '막힌 지점', '탐색 시간(초)', '메모'];
const NUMBER_COLUMNS = ['이동 수', '탐색 시간(초)'];

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export class SheetError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** 사람 확인 조건이 남은 Task. now: 선행 Task가 모두 검수돼 지금 확인할 수 있다. */
export function reviewItems(plan: any, accepted: any[]): ReviewItem[] {
  const { model } = foldPlan(plan, accepted, sha);
  const done = new Set(accepted.map(a => a.task_id));
  return planTasks(plan)
    .filter(t => !done.has(t.id) && t.conditions.some((c: any) => c.method === 'human'))
    .map(t => ({ task_id: t.id, name: t.name, goal: t.goal, now: card(model, t.id).rep === '착수 가능',
      conditions: t.conditions.filter((c: any) => c.method === 'human').map((c: any) => ({ id: c.id, text: c.text })) }));
}

export function loadDecisions(file: string): Record<string, Decision> {
  if (!existsSync(file)) return {};
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (saved.version !== 1 || !saved.decisions || typeof saved.decisions !== 'object') throw new Error('저장된 검수표 파일 형식을 확인해 주세요. 기존 파일은 덮어쓰지 않았습니다.');
  return saved.decisions;
}

const atomicWrite = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
};

export function saveDecision(file: string, conditionIds: string[], id: string, input: any): Decision {
  if (!conditionIds.includes(id)) throw new SheetError(404, '검수할 조건이 아닙니다.');
  if (!input || !DECISIONS.includes(input.decision) || typeof input.note !== 'string' || input.note.length > 4000 || !Number.isSafeInteger(input.revision))
    throw new SheetError(400, '결정은 승인·반려·보류 가운데 하나이고, 메모는 4,000자 이내입니다.');
  if (input.decision === '반려' && !input.note.trim()) throw new SheetError(400, '반려할 때는 이유를 메모에 적어 주세요.');
  const all = loadDecisions(file);
  if ((all[id]?.revision ?? 0) !== input.revision) throw new SheetError(409, '다른 화면에서 이 조건의 결정을 바꿨습니다. 새로고침한 뒤 다시 저장해 주세요.');
  all[id] = { decision: input.decision, note: input.note, revision: input.revision + 1, updatedAt: new Date().toISOString() };
  atomicWrite(file, JSON.stringify({ version: 1, decisions: all }, null, 2) + '\n');
  return all[id];
}

// 측정표 CSV(따옴표로 감싼 칸 지원). 첫 줄은 머리줄이고, 엑셀용 BOM은 그대로 둔다
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
export const writeCsv = (rows: string[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function loadSheet(file: string) {
  const raw = readFileSync(file, 'utf8');
  const bom = raw.startsWith('﻿');
  const [header, ...body] = parseCsv(bom ? raw.slice(1) : raw);
  return { bom, header, rows: body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), revision: sha(raw) };
}

/** 사용자 열만 바꿔 쓴다. 행은 블록·과제로 찾고, 다른 열은 보존한다. */
export function saveSheet(file: string, input: any) {
  const cur = loadSheet(file);
  if (!input || input.revision !== cur.revision) throw new SheetError(409, '다른 화면에서 측정표를 저장했습니다. 새로고침한 뒤 다시 입력해 주세요.');
  if (!Array.isArray(input.rows)) throw new SheetError(400, '저장할 측정표가 없습니다.');
  for (const r of input.rows) {
    const row = cur.rows.find(x => x['블록'] === r?.['블록'] && x['과제'] === r?.['과제']);
    if (!row) throw new SheetError(400, `측정표에 없는 과제입니다: ${r?.['블록']}/${r?.['과제']}`);
    for (const c of USER_COLUMNS) {
      const v = r[c] ?? '';
      if (typeof v !== 'string' || v.length > 2000) throw new SheetError(400, `${c}은(는) 2,000자 이내의 글이어야 합니다.`);
      if (NUMBER_COLUMNS.includes(c) && v.trim() && !/^\d{1,6}$/.test(v.trim())) throw new SheetError(400, `${c}에는 숫자만 적어 주세요(${r['과제']}).`);
      row[c] = v.trim();
    }
  }
  const text = (cur.bom ? '﻿' : '') + writeCsv([cur.header, ...cur.rows.map(r => cur.header.map(h => r[h] ?? ''))]);
  atomicWrite(file, text);
  return loadSheet(file);
}

export function createAcceptanceApi(o: { planFile: string; acceptedFile: string; decisionsFile: string; sheetFile: string }) {
  const items = () => reviewItems(JSON.parse(readFileSync(o.planFile, 'utf8')), JSON.parse(readFileSync(o.acceptedFile, 'utf8')));
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/acceptance')) return next();
    res.setHeader('Cache-Control', 'no-store');
    const json = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && url.pathname === '/api/acceptance')
        return json(200, { items: items(), decisions: loadDecisions(o.decisionsFile), sheet: loadSheet(o.sheetFile) });
      if (req.method !== 'PUT') throw new SheetError(405, '이 요청 방식은 지원하지 않습니다.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))
        throw new SheetError(403, '같은 검수표 화면에서만 저장할 수 있습니다.');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new SheetError(415, 'JSON 형식으로 저장해 주세요.');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 262144) throw new SheetError(413, '저장할 내용이 너무 큽니다.'); }
      let input: unknown;
      try { input = JSON.parse(body); } catch { throw new SheetError(400, '저장할 JSON을 읽을 수 없습니다.'); }
      if (url.pathname === '/api/acceptance/sheet') return json(200, saveSheet(o.sheetFile, input));
      const id = url.pathname.match(/^\/api\/acceptance\/decision\/([\w-]+)$/)?.[1];
      if (!id) throw new SheetError(404, '없는 주소입니다.');
      json(200, saveDecision(o.decisionsFile, items().filter(i => i.now).flatMap(i => i.conditions.map(c => c.id)), id, input));
    } catch (error) {
      json(error instanceof SheetError ? error.status : 500, { error: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.' });
    }
  };
}
