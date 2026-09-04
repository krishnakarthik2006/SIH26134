import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'frontend',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // The trailing slash keeps Vite source modules such as /api.js local;
      // only actual backend requests (for example /api/auth/login) proxy.
      '/api/': 'http://localhost:4000',
    },
  },
})
