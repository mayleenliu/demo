import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the build works under any path (e.g. GitHub Pages /demo/).
  base: './',
  plugins: [react(), tailwindcss()],
})
