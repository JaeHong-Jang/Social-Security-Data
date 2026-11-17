import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = { '/api/ordinance-impact': 'http://127.0.0.1:8788' }
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: apiProxy },
  preview: { proxy: apiProxy },
})
