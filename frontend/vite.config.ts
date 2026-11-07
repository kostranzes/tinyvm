import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // CORS на backend разрешает только http://localhost:5173,
    // поэтому при занятом порту лучше упасть, чем уйти на другой.
    port: 5173,
    strictPort: true,
  },
})