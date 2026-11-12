import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// 시안은 데이터 묶음(prototype/public/data/<이름> → scenarios/<이름>)을 fetch로 읽는다. 묶음은 ?data=<이름>으로 고른다.
// base를 './'로 두어 빌드 결과(dist/)를 어느 경로에 올려도(Artifact, 이후 catena ui) 그대로 열린다.
export default defineConfig({
  root: 'prototype',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'prototype/src') },
  },
  // ELK(elk.bundled.js 1.6MB)는 그래프 화면에서만 따로 불러오는 한 덩어리라 경고 기준을 그보다 크게 둔다.
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1800 },
  // 폰에서 볼 때는 tailscale serve가 tailnet 안에서 HTTPS로 넘겨준다(CLAUDE.md 「명령」). 서버는 127.0.0.1에만 열리므로
  // .ts.net 이름을 허용해도 tailnet 밖에서는 닿지 않는다. preview.allowedHosts는 이 값을 그대로 쓴다.
  server: { host: '127.0.0.1', port: 5180, strictPort: true, allowedHosts: ['.ts.net'] },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
})
