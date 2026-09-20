import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@app/index.css'
import { setupApi } from './apiSetup'
import SavePanel from './SavePanel'

async function main() {
  await setupApi()
  const root = createRoot(document.getElementById('root'))
  root.render(
    <StrictMode>
      {/* Changing the API host re-points api.ts, so remount everything below it. */}
      <SavePanel onApiBaseChanged={() => window.location.reload()} />
    </StrictMode>,
  )
}

main()
