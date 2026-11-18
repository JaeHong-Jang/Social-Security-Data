import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// design/ 의 토큰·에셋을 직접 import 하므로 프로젝트 루트를 허용한다.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [resolve(__dirname, '../..')] }, proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8787' } },
})
