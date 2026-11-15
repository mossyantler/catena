// 실시간 화면용 읽기 전용 API(T30, B-7): Project 저장소(기본 ~/.catena/projects/<project_id>)의 이벤트와 원문을
// 데이터 묶음과 같은 모양으로 내준다. 화면은 같은 검사(checkStream, foldAll)와 같은 읽기 모델로 그린다.
// 읽기는 읽기 전용 연결로 한다. 쓰는 것은 화면 승인·반려 하나이고 CLI와 같은 명령 계층(approval.decide, 채널 web)을 거친다(T31).
// 개발 서버·미리보기 서버(vite.config.ts)와 첨삭 서버가 함께 쓴다.
//   GET live/index.json                       → { projects: [project_id] }
//   GET live/<id>/dataset.json                → { origin: 'live', schema_version, project_id }
//   GET live/<id>/events.jsonl[?after=N]      → seq가 N보다 큰 이벤트(한 줄에 하나)
//   GET live/<id>/artifacts/sha256/<hex>      → 원문
//   POST live/<id>/approvals/<approval_id>    ← { decision: 승인 | 반려, comment?, submission_id } → { ok, version } | { ok: false, reason, message }
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../engine/store.ts';
import { execute } from '../engine/commands.ts';
import { recoverExpired } from '../engine/supervise.ts';
import '../engine/accept.ts';

const ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const STATUS: Record<string, number> = { '권한 거부': 403, '대상 없음': 404, '버전 충돌': 409, '규칙 위반': 422 };

export function createLiveApi(root = join(homedir(), '.catena', 'projects')) {
  const db = (id: string) => join(root, id, 'catena.db');
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const post = url.pathname.match(/\/live\/([^/]+)\/approvals\/([A-Za-z0-9._-]+)$/);
    if (req.method === 'POST' && post) return void decide(post[1], post[2], req, res);
    const m = url.pathname.match(/\/live\/(?:index\.json|([^/]+)\/(dataset\.json|events\.jsonl|artifacts\/sha256\/([0-9a-f]{64})))$/);
    if (req.method !== 'GET' || !m) return next();
    const send = (status: number, type: string, body: string | Buffer) => { res.statusCode = status; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store'); res.end(body); };
    const [, id, what, hex] = m;
    if (!id) {
      const projects = existsSync(root) ? readdirSync(root).filter(n => ID.test(n) && existsSync(db(n))).sort() : [];
      return send(200, 'application/json', JSON.stringify({ projects }));
    }
    if (!ID.test(id) || !existsSync(db(id))) return send(404, 'text/plain; charset=utf-8', `Project 저장소가 없다: ${id}`);
    if (what === 'dataset.json') return send(200, 'application/json', JSON.stringify({ origin: 'live', schema_version: 1, project_id: id }));
    if (hex) {
      const f = join(root, id, 'artifacts', 'sha256', hex);
      return existsSync(f) ? send(200, 'application/octet-stream', readFileSync(f)) : send(404, 'text/plain; charset=utf-8', '원문 파일 없음');
    }
    const after = Number(url.searchParams.get('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) return send(400, 'text/plain; charset=utf-8', `after는 0 이상의 정수다: ${url.searchParams.get('after')}`);
    const d = new DatabaseSync(db(id), { readOnly: true });
    try {
      const rows = d.prepare('SELECT body FROM events WHERE seq > ? ORDER BY seq').all(after) as { body: string }[];
      send(200, 'application/x-ndjson; charset=utf-8', rows.map(r => r.body).join('\n') + (rows.length ? '\n' : ''));
    } finally { d.close(); }
  };

  // 화면 승인·반려(T31, 9-10): 사람이 화면에서 확인한 결정만 받는다. 다른 사이트가 사용자 브라우저로 보내는 요청은
  // JSON 형식(사전 확인 요청이 필요하다)과 Origin 확인으로 막는다. 같은 사용자 권한의 Agent가 흉내 내는 것은 14-15의 한계다
  async function decide(id: string, approval_id: string, req: IncomingMessage, res: ServerResponse) {
    const reply = (status: number, body: object) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    const sameSite = (o: string) => { try { return new URL(o).host === req.headers.host; } catch { return false; } };
    if (origin && !sameSite(origin)) return reply(403, { ok: false, reason: '권한 거부', message: `다른 사이트에서 온 요청이다: ${origin}` });
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(415, { ok: false, reason: '규칙 위반', message: '요청 본문은 JSON이다' });
    if (!ID.test(id) || !existsSync(db(id))) return reply(404, { ok: false, reason: '대상 없음', message: `Project 저장소가 없다: ${id}` });
    let body: any;
    try {
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 10_000) throw new Error('본문이 너무 크다'); }
      body = JSON.parse(raw);
    } catch (err) { return reply(400, { ok: false, reason: '규칙 위반', message: `요청 본문을 읽지 못했다: ${(err as Error).message}` }); }
    if (typeof body?.submission_id !== 'string') return reply(400, { ok: false, reason: '규칙 위반', message: '화면에 보인 제출 기록(submission_id)을 함께 보낸다(7-8)' });
    const s = openStore(join(root, id));
    try {
      recoverExpired(s);
      const r = execute(s, { command: 'approval.decide', principal: { kind: 'human', id: 'user' }, channel: 'web',
        args: { approval_id, decision: body.decision, comment: typeof body.comment === 'string' ? body.comment : '', submission_id: body.submission_id } });
      reply(r.ok ? 200 : STATUS[r.reason] ?? 422, r.ok ? { ok: true, version: r.version } : { ok: false, reason: r.reason, message: r.message });
    } finally { s.close(); }
  }
}
