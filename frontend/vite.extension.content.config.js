import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Content scripts are classic scripts, not modules: one self-contained IIFE at
// a fixed path, so no imports, no code splitting and no hashed name.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-extension',
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: fileURLToPath(new URL('./extension/src/linkedin.js', import.meta.url)),
      formats: ['iife'],
      name: 'jobTrackerLinkedIn',
      fileName: () => 'linkedin.js',
    },
  },
})
