/**
 * How api.ts talks to the backend. The defaults are exactly the web app's
 * behaviour -- same origin, cookie session -- so main.jsx needs no change. The
 * extension calls configureApi() once at start-up to point at an absolute API
 * host and supply a bearer token instead.
 */
export interface Transport {
  /** Prefixed to every request path. '' means same-origin. */
  baseUrl: string
  credentials: RequestCredentials
  /** Returns a bearer token, or null to fall back to the cookie session. */
  getToken?: () => string | null | Promise<string | null>
}

let transport: Transport = {
  baseUrl: '',
  credentials: 'same-origin',
}

export function configureApi(partial: Partial<Transport>): void {
  transport = { ...transport, ...partial }
}

export function getTransport(): Transport {
  return transport
}
