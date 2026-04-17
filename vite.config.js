import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 把所有 /api/* 请求代理到本地 vercel dev (localhost:3000)
      // 本地开发时需要在另一个终端跑 `vercel dev`
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
