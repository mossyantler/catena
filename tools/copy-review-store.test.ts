import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCopyReviewApi, loadReviews, saveReview, exportCopyMarkdown } from './copy-review-store.ts';
import type { CopyItem, CopyData } from './copy-review-types.ts';

const item: CopyItem = { id: 'copy-001', category: '용어', original: '인수', suggested: '완료 확인', context: '조건 충족 확인' };
test('첨삭: 재조회·항목별 저장·충돌 거부·기존 파일 보존·내보내기', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catena-copy-'));
  const file = join(dir, 'review.json');
  try {
    assert.deepEqual(loadReviews(file), {});
    const input = { text: '완료 확인', note: '사람 승인과 구분', decision: 'approved', revision: 0 };
    const r = saveReview(file, item, input);
    assert.equal(loadReviews(file)[item.id].text, input.text);
    const second = { ...item, id: 'copy-002' };
    saveReview(file, second, { ...input, decision: 'keep' });
    assert.equal(loadReviews(file)[second.id].text, item.original);
    assert.equal(loadReviews(file)[item.id].revision, 1);
    assert.throws(() => saveReview(file, item, input), /다른 화면/);
    assert.throws(() => saveReview(file, item, { ...input, revision: r.revision, text: '' }), /입력/);
    assert.throws(() => saveReview(file, item, { ...input, decision: '삭제' }), /6,000/);
    const markdown = exportCopyMarkdown({ items: [item], reviews: loadReviews(file) });
    assert.match(markdown, /확정.*완료 확인.*사람 승인과 구분/);
    writeFileSync(file, '{깨진 파일');
    assert.throws(() => saveReview(file, item, input));
    assert.equal(readFileSync(file, 'utf8'), '{깨진 파일');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('첨삭 API: 저장·재조회·내보내기·다른 출처와 잘못된 입력 거부', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catena-copy-api-'));
  const api = createCopyReviewApi([item], join(dir, 'review.json'));
  const server = createServer((req, res) => { void api(req, res, () => { res.writeHead(404); res.end(); }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/copy-review`;
  const body = JSON.stringify({ text: '완료 확인', note: '', decision: 'approved', revision: 0 });
  const put = (suffix: string, value = body, origin = '') => fetch(base + suffix, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: value });
  try {
    assert.equal((await put('/copy-001', body, 'https://example.com')).status, 403);
    assert.equal((await put('/copy-001', '{')).status, 400);
    assert.equal((await put('/unknown')).status, 404);
    assert.equal((await put('/copy-001')).status, 200);
    assert.equal((await put('/copy-001')).status, 409);
    const data = await (await fetch(base)).json() as CopyData;
    assert.equal(data.reviews[item.id].text, '완료 확인');
    assert.match(await (await fetch(base + '/export.md')).text(), /완료 확인/);
    assert.equal((await fetch(base + '/export.json')).headers.get('Content-Disposition'), 'attachment; filename="catena-copy-review.json"');
  } finally {
    await new Promise<void>((ok, fail) => server.close(e => e ? fail(e) : ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('첨삭 목록: 식별자와 문구가 빠지지 않고 작업 이름 제안도 포함한다', () => {
  const items: CopyItem[] = JSON.parse(readFileSync(new URL('../docs/copy-review-items.json', import.meta.url), 'utf8'));
  assert.equal(new Set(items.map(i => i.id)).size, items.length);
  assert.ok(items.every(i => i.id && i.category && i.original && i.suggested && i.context));
  assert.match(exportCopyMarkdown({ items: [{ ...items[0], basis: 'copy-005' }], reviews: {} }), /용어 결정 적용\(copy-005\)/);
  assert.equal(items.filter(i => i.category === 'Catena 작업 이름').length, 30);
});
