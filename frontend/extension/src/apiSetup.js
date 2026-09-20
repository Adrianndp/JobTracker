/**
 * Points the shared api.ts at the configured backend with bearer auth. Both
 * extension pages call this before rendering.
 *
 * credentials: 'omit' matters -- the extension is a different origin, the
 * cookie would never be sent anyway, and the backend deliberately never emits
 * Access-Control-Allow-Credentials.
 */

import { configureApi } from '@app/lib/transport'
import { getApiBase } from './settings'
import { getCachedToken, loadToken } from './tokenStore'

export async function setupApi() {
  const [base] = await Promise.all([getApiBase(), loadToken()])
  configureApi({
    baseUrl: base,
    credentials: 'omit',
    getToken: getCachedToken,
  })
  return base
}
