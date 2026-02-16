import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    watch: {
      usePolling: true,
    },
    host: true,
    strictPort: true,
    port: 5173,
    allowedHosts: ['frontend'],
    hmr: {
      protocol: 'wss',
      host: 'localhost',
      port: 5173,
      clientPort: 443,
    },
  }
})
