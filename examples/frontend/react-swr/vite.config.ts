import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/express': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/express/, '') },
      '/api/hono': { target: 'http://localhost:3001', changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/hono/, '') },
      '/api/fastify': { target: 'http://localhost:3002', changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/fastify/, '') },
      '/api/node': { target: 'http://localhost:3003', changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/node/, '') },
    },
  },
})
