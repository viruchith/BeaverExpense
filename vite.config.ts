import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${packageJson.version}`),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }
          if (id.includes('/node_modules/firebase/')) {
            return 'firebase'
          }
          if (id.includes('/node_modules/recharts/')) {
            return 'charts'
          }
          if (id.includes('/node_modules/react-hook-form/') || id.includes('/node_modules/@hookform/')) {
            return 'forms'
          }
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react-core'
          }
          return 'vendor'
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/vitest.setup.ts',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
