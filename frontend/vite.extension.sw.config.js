import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// The MV3 service worker must be a single file at a fixed path, so no code
// splitting and no hashed name.
export default defineConfig({
  // The pages build already copied extension/public. Without this, the default
  // publicDir (frontend/public) would also be copied into the extension.
  publicDir: false,
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-extension',
    emptyOutDir: false,
    target: 'esnext',
    rollupOptions: {
      input: fileURLToPath(new URL('./extension/src/background.js', import.meta.url)),
      output: {
        format: 'es',
        entryFileNames: 'background.js',
        inlineDynamicImports: true,
      },
    },
  },
})
