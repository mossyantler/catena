// 문구 첨삭 전용 저장소. 제작 공정의 인수·승인 기록과는 별개다.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CopyItem, CopyDecision, CopyReview, CopyData } from './copy-review-types.ts';
const decisions = ['draft', 'approved', 'keep', 'deferred'];
const labels: Record<CopyDecision, string> = { draft: '검토 중', approved: '확정', keep: '현재 표현 유지', deferred: '보류' };

class ReviewError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function loadReviews(file: string): Record<string, CopyReview> {
  if (!existsSync(file)) return {};
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (saved.version !== 1 || !saved.reviews || typeof saved.reviews !== 'object' || Array.isArray(saved.reviews))
    throw new Error('저장된 첨삭 파일 형식을 확인해 주세요. 기존 파일은 덮어쓰지 않았습니다.');
  return saved.reviews;
}

export function saveReview(file: string, item: CopyItem, input: unknown): CopyReview {
  if (!input || typeof input !== 'object') throw new ReviewError(400, '저장할 내용이 없습니다.');
  const p = input as Record<string, unknown>;
  if (typeof p.text !== 'string' || typeof p.note !== 'string' || p.text.length > 6000 || p.note.length > 6000
    || !decisions.includes(p.decision as string) || !Number.isSafeInteger(p.revision) || (p.revision as number) < 0)
    throw new ReviewError(400, '문구와 메모는 각각 6,000자 이내로 입력해 주세요.');
  if (p.decision === 'approved' && !p.text.trim()) throw new ReviewError(400, '확정할 문구를 입력해 주세요.');
  const reviews = loadReviews(file);
  if ((reviews[item.id]?.revision ?? 0) !== p.revision)
    throw new ReviewError(409, '다른 화면에서 이 항목을 수정했습니다. 입력 내용은 이 브라우저에 남아 있습니다. 새로고침 후 비교해 주세요.');
  const review: CopyReview = {
    text: p.decision === 'keep' ? item.original : p.text,
    note: p.note, decision: p.decision as CopyDecision,
    revision: (p.revision as number) + 1, updatedAt: new Date().toISOString(),
  };
  reviews[item.id] = review;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, reviews }, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  return review;
}

export function exportCopyMarkdown(data: CopyData): string {
  const cell = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('\n', '<br>');
  return '# Catena 화면 문구 첨삭\n\n문구 검토 기록이며, 제작 공정의 인수나 명세 반영을 뜻하지 않습니다.\n\n'
    + '| 항목 | 분류 | 현재 표현 | 최초 제안 | 검토 상태 | 첨삭 문구 | 메모 |\n|---|---|---|---|---|---|---|\n'
    + data.items.map(item => {
      const r = data.reviews[item.id];
      return '| ' + [item.id, item.category, item.original, item.suggested, r ? labels[r.decision] : '미검토', r?.text ?? '', r?.note ?? ''].map(cell).join(' | ') + ' |';
    }).join('\n') + '\n';
}

export function createCopyReviewApi(items: CopyItem[], file: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/copy-review')) return next();
    res.setHeader('Cache-Control', 'no-store');
    const json = (code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && ['/api/copy-review', '/api/copy-review/export.json', '/api/copy-review/export.md'].includes(url.pathname)) {
        const data = { items, reviews: loadReviews(file) };
        if (url.pathname.endsWith('/export.md')) {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="catena-copy-review.md"' });
          res.end(exportCopyMarkdown(data));
        } else {
          if (url.pathname.endsWith('/export.json')) res.setHeader('Content-Disposition', 'attachment; filename="catena-copy-review.json"');
          json(200, data);
        }
        return;
      }
      if (req.method !== 'PUT') throw new ReviewError(405, '이 요청 방식은 지원하지 않습니다.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))
        throw new ReviewError(403, '같은 첨삭 화면에서만 저장할 수 있습니다.');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new ReviewError(415, 'JSON 형식으로 저장해 주세요.');
      const id = url.pathname.slice('/api/copy-review/'.length);
      const item = items.find(i => i.id === id);
      if (!item) throw new ReviewError(404, '해당 문구를 찾을 수 없습니다.');
      req.setEncoding('utf8');
      let body = '';
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 65536) throw new ReviewError(413, '저장할 내용이 너무 큽니다.');
        body += chunk.toString();
      }
      let input: unknown;
      try { input = JSON.parse(body); } catch { throw new ReviewError(400, '저장할 JSON을 읽을 수 없습니다.'); }
      json(200, saveReview(file, item, input));
    } catch (error) {
      json(error instanceof ReviewError ? error.status : 500, { error: error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.' });
    }
  };
}
