/**
 * Paddle.js, the checkout overlay. Loaded only when someone clicks Upgrade, so
 * nobody else downloads it. Paddle requires loading it from its own CDN rather
 * than bundling it; the CSP (backend/config/security.py, nginx.conf) allows it.
 *
 * Extension pages can't load remote scripts at all (Manifest V3), so they send
 * people to the web app for the checkout instead.
 */

import type { CheckoutSession } from '../api'

const SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

interface PaddleEvent {
  name?: string
}

interface PaddleGlobal {
  Environment: { set: (env: string) => void }
  Initialize: (options: { token: string, eventCallback?: (event: PaddleEvent) => void }) => void
  Checkout: { open: (options: Record<string, unknown>) => void }
}

declare global {
  interface Window { Paddle?: PaddleGlobal }
}

let loading: Promise<PaddleGlobal> | null = null
let initializedWith: string | null = null
let onEvent: ((event: PaddleEvent) => void) | null = null

function loadScript(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle)
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js did not load')))
    script.onerror = () => {
      loading = null
      reject(new Error('Could not load the checkout. Check your connection or ad blocker and try again.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Opens Paddle's checkout for a transaction the backend created. Resolves with
 * 'completed' once payment went through, or 'closed' if it was dismissed.
 */
export async function openCheckout(session: CheckoutSession): Promise<'completed' | 'closed'> {
  const Paddle = await loadScript()
  if (initializedWith !== session.client_token) {
    if (session.environment === 'sandbox') Paddle.Environment.set('sandbox')
    Paddle.Initialize({
      token: session.client_token,
      eventCallback: (event) => onEvent?.(event),
    })
    initializedWith = session.client_token
  }

  return new Promise((resolve) => {
    let completed = false
    onEvent = (event) => {
      if (event.name === 'checkout.completed') completed = true
      if (event.name === 'checkout.closed') {
        onEvent = null
        resolve(completed ? 'completed' : 'closed')
      }
    }
    Paddle.Checkout.open({
      transactionId: session.transaction_id,
      ...(session.email ? { customer: { email: session.email } } : {}),
      settings: { displayMode: 'overlay', theme: 'light' },
    })
  })
}
