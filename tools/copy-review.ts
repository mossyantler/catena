// node tools/copy-review.ts: 별도 포트에서 문구 첨삭 화면(?review=copy)과 검수표(?review=accept, T36)를 저장 API와 함께 연다.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createCopyReviewApi } from './copy-review-store.ts';
import { createAcceptanceApi } from './acceptance-store.ts';
import type { CopyItem } from './copy-review-types.ts';

const root = resolve(import.meta.dirname, '..');
const items: CopyItem[] = JSON.parse(readFileSync(resolve(root, 'docs/copy-review-items.json'), 'utf8'));
const file = resolve(homedir(), '.catena/reviews/dashboard-copy.json');
const api = createCopyReviewApi(items, file);
const accept = createAcceptanceApi({ planFile: resolve(root, 'plan/catena.plan.json'), acceptedFile: resolve(root, 'plan/accepted.json'),
  decisionsFile: resolve(homedir(), '.catena/reviews/acceptance.json'), sheetFile: resolve(root, 'docs/user-test-results.csv') });
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5182, strictPort: true },
  plugins: [{ name: 'copy-review', configureServer(s) { s.middlewares.use((req, res, next) => { void api(req, res, next); }); s.middlewares.use((req, res, next) => { void accept(req, res, next); }); } }],
});
await server.listen();
console.log(`문구 첨삭: http://127.0.0.1:5182/?review=copy\n검수표: http://127.0.0.1:5182/?review=accept\n저장 파일: ${file}`);
