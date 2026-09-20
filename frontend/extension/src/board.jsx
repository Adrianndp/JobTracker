/**
 * The full kanban board, in a real tab. Six drag-and-drop columns are unusable
 * at popup or side-panel width, so this reuses the web app's App component
 * wholesale and only swaps in token auth.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@app/App'
import '@app/index.css'
import { setupApi } from './apiSetup'
import { clearToken, setToken } from './tokenStore'

async function main() {
  await setupApi()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App
        authMode="token"
        onSignIn={(_username, grant) => grant?.token && setToken(grant.token)}
        onSignOut={() => clearToken()}
      />
    </StrictMode>,
  )
}

main()
