import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Content scripts are classic scripts, not modules: one self-contained IIFE at
// a fixed path, so no imports, no code splitting and no hashed name. Rollup
// can't emit several IIFEs from one build, so build:ext runs this once per
// script with CONTENT_SCRIPT set to its name (linkedin, xing, stepstone).
const name = process.env.CONTENT_SCRIPT
if (!/^[a-z]+$/.test(name || '')) {
  throw new Error('Set CONTENT_SCRIPT to the content script to build, e.g. CONTENT_SCRIPT=linkedin')
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-extension',
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: fileURLToPath(new URL(`./extension/src/${name}.js`, import.meta.url)),
      formats: ['iife'],
      name: `jobTracker_${name}`,
      fileName: () => `${name}.js`,
    },
  },
})
