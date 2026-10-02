import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_EXT_TARGET=store builds the Chrome Web Store package (npm run build:ext:store):
// - host_permissions is the production API host from VITE_API_BASE, which must be https;
// - no optional_host_permissions: the API host is fixed, so nothing asks for more,
//   and a broad https://*/* draws extra review;
// - no "key": the store assigns the extension's ID and rejects uploads with one.
//   Unpacked dev builds keep it so their ID stays stable (see README).
const STORE = process.env.VITE_EXT_TARGET === 'store'

function storeManifest() {
  if (!STORE) return null
  let api
  try {
    api = new URL(process.env.VITE_API_BASE || '')
  } catch {
    api = null
  }
  if (api?.protocol !== 'https:') {
    throw new Error('A store build needs VITE_API_BASE=https://<your API host>')
  }
  return {
    name: 'store-manifest',
    closeBundle() {
      const path = fileURLToPath(new URL('./dist-extension/manifest.json', import.meta.url))
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      delete manifest.key
      delete manifest.optional_host_permissions
      manifest.host_permissions = [`${api.origin}/*`]
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
    },
  }
}

// The extension's HTML pages. Code-split ESM is fine here -- only the service
// worker and content script have single-file / IIFE constraints, which is why
// they get their own configs.
export default defineConfig({
  root: 'extension',
  publicDir: 'public',          // manifest.json + icons, copied verbatim
  plugins: [react(), storeManifest()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist-extension',
    emptyOutDir: true,          // only this one: the other builds add to it
    rollupOptions: {
      input: {
        board: fileURLToPath(new URL('./extension/board.html', import.meta.url)),
        sidepanel: fileURLToPath(new URL('./extension/sidepanel.html', import.meta.url)),
      },
    },
  },
})
