// node tools/copy-review.ts: 별도 포트에서 문구 첨삭 화면과 저장 API를 함께 연다.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createCopyReviewApi } from './copy-review-store.ts';
import type { CopyItem } from './copy-review-types.ts';

const root = resolve(import.meta.dirname, '..');
const items: CopyItem[] = JSON.parse(readFileSync(resolve(root, 'docs/copy-review-items.json'), 'utf8'));
const file = resolve(homedir(), '.catena/reviews/dashboard-copy.json');
const api = createCopyReviewApi(items, file);
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5182, strictPort: true },
  plugins: [{ name: 'copy-review', configureServer(s) { s.middlewares.use((req, res, next) => { void api(req, res, next); }); } }],
});
await server.listen();
console.log(`문구 첨삭: http://127.0.0.1:5182/?review=copy\n저장 파일: ${file}`);
