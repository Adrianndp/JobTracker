import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The extension's HTML pages. Code-split ESM is fine here -- only the service
// worker and content script have single-file / IIFE constraints, which is why
// they get their own configs.
export default defineConfig({
  root: 'extension',
  publicDir: 'public',          // manifest.json + icons, copied verbatim
  plugins: [react()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist-extension',
    emptyOutDir: true,          // only this one: the other two builds add to it
    rollupOptions: {
      input: {
        board: fileURLToPath(new URL('./extension/board.html', import.meta.url)),
        sidepanel: fileURLToPath(new URL('./extension/sidepanel.html', import.meta.url)),
      },
    },
  },
})
