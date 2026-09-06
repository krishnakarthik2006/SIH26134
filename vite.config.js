import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'frontend',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '^/api/': {
        target:       'http://127.0.0.1:4000',
        changeOrigin: true,
        secure:       false,
        // Don't crash the dev server if the backend hasn't started yet
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // Suppress ECONNREFUSED noise during backend restarts
            if (err.code !== 'ECONNREFUSED') console.error('[proxy]', err.message)
          })
        },
      },
    },
  },
})
