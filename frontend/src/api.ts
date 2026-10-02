import { useCallback, useEffect, useRef, useState } from 'react'
import { getTransport } from './lib/transport'

// ── Types ───────────────────────────────────────────────────────────────────

export type JobStatus = 'to_be_applied' | 'applied' | 'in_interview' | 'rejected' | 'offer' | 'ghosted'

export interface Job {
  id: number
  name: string
  company: string | null
  link: string | null
  salary: string | null
  status: JobStatus
  had_interview: boolean
  applied_date: string | null
  created_at: string
}

export interface JobForm {
  name: string
  company: string
  link: string
  salary: string
  had_interview: boolean
}

export interface AuthStatus {
  authenticated: boolean
  username: string | null
}

export interface Credentials {
  email: string
  password: string
}

export interface SignupData extends Credentials {
  username: string
}

/**
 * Outcome of an allauth step: signed in, or waiting on an emailed code
 * (verify_email after sign-up/login, password_reset_by_code after a reset request).
 */
export type AuthResult =
  | { done: true, username: string }
  | { done: false, pending: 'verify_email' | 'password_reset_by_code' | null }

export class ApiError extends Error {
  status: number
  /** Machine-readable reason, e.g. 'plan_limit' with a 402 */
  code: string | null

  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface Money {
  /** In the currency's minor unit (cents) */
  amount: number
  currency: string
}

export interface PriceOption {
  id: 'monthly' | 'quarterly'
  label: string
  /** List price in cents, tax included */
  amount: number
  currency: string
  /** Billing period length */
  months: number
}

export interface PublicPlans {
  enabled: boolean
  free_active_limit: number
  prices: PriceOption[]
}

export interface PricePreview {
  total: Money
  tax: Money | null
  tax_rate: string | null
  country: string | null
}

export interface Invoice {
  id: string
  number: string | null
  billed_at: string | null
  total: Money | null
}

export interface SubscriptionDetails {
  plan: PriceOption['id'] | null
  label: string | null
  status: string
  interval: string | null
  frequency: number | null
  started_at: string | null
  next_billed_at: string | null
  next_payment: Money | null
  cancel_at: string | null
  payment_method: { type: string, brand: string | null, last4: string | null } | null
  invoices: Invoice[]
}

export interface BillingStatus {
  /** false when the server has no Paddle configured: no plans, no limits */
  enabled: boolean
  plan: 'free' | 'pro' | 'unlimited'
  active_jobs: number
  active_limit: number | null
  status?: string
  complimentary?: boolean
  cancel_at_period_end?: boolean
  current_period_end?: string | null
  can_manage?: boolean
  prices?: PriceOption[]
}

export interface CheckoutSession {
  transaction_id: string
  client_token: string
  environment: 'sandbox' | 'production'
  email: string | null
}

// ── Request helper (internal — components use the hooks below) ──────────────

const unauthorizedListeners = new Set<() => void>()

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  // Login/signup answer 401 for wrong credentials, which isn't an expired session
  notifyUnauthorized?: boolean
}

/** Django's CSRF cookie. Not HttpOnly, precisely so this can read it. */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

async function send(url: string, method: string, body?: unknown): Promise<Response> {
  const transport = getTransport()
  const headers: Record<string, string> = {}

  // The backend only accepts JSON for POST/PATCH, even without a body
  if (method === 'POST' || method === 'PATCH' || body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const token = transport.getToken ? await transport.getToken() : null
  if (token) {
    // A bearer token carries no ambient authority, so CSRF doesn't apply and
    // the backend exempts it.
    headers.Authorization = `Bearer ${token}`
  } else if (method !== 'GET') {
    const csrf = csrfToken()
    if (csrf) headers['X-CSRFToken'] = csrf
  }

  return fetch(transport.baseUrl + url, {
    method,
    headers,
    credentials: transport.credentials,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function request<T>(url: string, { method = 'GET', body, notifyUnauthorized = true }: RequestOptions = {}): Promise<T> {
  const res = await send(url, method, body)
  if (res.status === 401 && notifyUnauthorized) {
    unauthorizedListeners.forEach(listener => listener())
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.', data?.code ?? null)
  }
  return data as T
}

function useRequest<Args extends unknown[], T>(fn: (...args: Args) => Promise<T>) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async (...args: Args) => {
    setLoading(true)
    setError(null)
    try {
      return await fn(...args)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [fn])

  return { run, loading, error }
}

// ── Auth ────────────────────────────────────────────────────────────────────

/** Calls `handler` whenever an API request finds the session expired (401). */
export function useUnauthorized(handler: () => void) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const listener = () => handlerRef.current()
    unauthorizedListeners.add(listener)
    return () => { unauthorizedListeners.delete(listener) }
  }, [])
}

export function useAuthStatus() {
  const [data, setData] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    request<AuthStatus>('/api/auth/status', { notifyUnauthorized: false })
      .then(result => { if (!cancelled) setData(result) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

// allauth's headless API. It answers 200 when signed in, 401 with a list of
// flows when a step is still pending (e.g. the emailed code), and 400 with
// errors[] when the input is wrong.
const ALLAUTH = '/api/_allauth/browser/v1'

async function allauth(path: string, body: unknown): Promise<AuthResult> {
  const res = await send(ALLAUTH + path, 'POST', body)
  const data = await res.json().catch(() => null)
  if (res.status === 200 && data?.meta?.is_authenticated) {
    return { done: true, username: data.data.user.username }
  }
  if (res.status === 200 || res.status === 401) {
    const flow = data?.data?.flows?.find((f: { is_pending?: boolean }) => f.is_pending)
    return { done: false, pending: flow?.id ?? null }
  }
  if (res.status === 429) {
    throw new ApiError(429, 'Too many attempts. Please wait a minute and try again.')
  }
  throw new ApiError(res.status, data?.errors?.[0]?.message || 'Something went wrong. Please try again.')
}

const login = (credentials: Credentials) => allauth('/auth/login', credentials)
const signup = (data: SignupData) => allauth('/auth/signup', data)
const verifyEmail = (code: string) => allauth('/auth/email/verify', { key: code })
const resendVerification = () => allauth('/auth/email/verify/resend', {})
const requestPasswordReset = (email: string) => allauth('/auth/password/request', { email })
const resetPassword = (code: string, password: string) => allauth('/auth/password/reset', { key: code, password })

const logout = () =>
  request<null>('/api/auth/logout', { method: 'POST', notifyUnauthorized: false })

export interface TokenGrant {
  token: string
  expires_at: string
  username: string
}

/** Extension sign-in: exchanges credentials for a bearer token. */
const tokenLogin = (data: Credentials & { device_name?: string }) =>
  request<TokenGrant>('/api/auth/token', { method: 'POST', body: data, notifyUnauthorized: false })

export function useLogin() {
  const { run, ...state } = useRequest(login)
  return { login: run, ...state }
}

export function useSignup() {
  const { run, ...state } = useRequest(signup)
  return { signup: run, ...state }
}

export function useVerifyEmail() {
  const verify = useRequest(verifyEmail)
  const resend = useRequest(resendVerification)
  return { verifyEmail: verify.run, resendVerification: resend.run }
}

export function usePasswordReset() {
  const request = useRequest(requestPasswordReset)
  const reset = useRequest(resetPassword)
  return { requestPasswordReset: request.run, resetPassword: reset.run }
}

export function useTokenLogin() {
  const { run, ...state } = useRequest(tokenLogin)
  return { tokenLogin: run, ...state }
}

export function useLogout() {
  const { run, ...state } = useRequest(logout)
  return { logout: run, ...state }
}

/** Closes the account for good; the server re-checks the password. */
const deleteAccount = (password: string) =>
  request<null>('/api/auth/account', { method: 'DELETE', body: { password } })

export function useDeleteAccount() {
  const { run, ...state } = useRequest(deleteAccount)
  return { deleteAccount: run, ...state }
}

// ── Billing ─────────────────────────────────────────────────────────────────

/** Plan and usage while `enabled`; reload() after anything that changes them. */
export function useBilling(enabled: boolean) {
  const [data, setData] = useState<BillingStatus | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setData(null)
      return
    }
    let cancelled = false
    request<BillingStatus>('/api/billing/status')
      .then(result => { if (!cancelled) setData(result) })
      .catch(() => {}) // the board works without it
    return () => { cancelled = true }
  }, [enabled, version])

  const reload = useCallback(() => setVersion(v => v + 1), [])
  return { billing: data, reload }
}

/** What's on sale. Public, so the pricing page works before sign-up. */
export function usePlans() {
  const [plans, setPlans] = useState<PublicPlans | null>(null)
  useEffect(() => {
    let cancelled = false
    request<PublicPlans>('/api/billing/plans', { notifyUnauthorized: false })
      .then(result => { if (!cancelled) setPlans(result) })
      .catch(() => { if (!cancelled) setPlans({ enabled: false, free_active_limit: 0, prices: [] }) })
    return () => { cancelled = true }
  }, [])
  return plans
}

/** The price with VAT for the buyer's country, or null when it can't be told yet. */
export const previewPrice = (price: PriceOption['id']) =>
  request<{ preview: PricePreview | null }>(`/api/billing/preview?price=${encodeURIComponent(price)}`)
    .then(result => result.preview)
    .catch(() => null)

export const getBillingDetails = () =>
  request<{ subscription: SubscriptionDetails | null }>('/api/billing/details')

export const getInvoiceUrl = (id: string) =>
  request<{ url: string }>(`/api/billing/invoices/${encodeURIComponent(id)}`)

/** "€7.00" -- minor units to the currency's own format. */
export function formatMoney(money: Money | null | undefined, { trim = false } = {}) {
  if (!money) return ''
  const format = (digits?: number) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: money.currency,
    ...(digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  })
  const digits = format().resolvedOptions().maximumFractionDigits ?? 2
  const value = money.amount / 10 ** digits
  // trim: "€7" rather than "€7.00" for whole amounts, as on the pricing page
  return format(trim && Number.isInteger(value) ? 0 : undefined).format(value)
}

export const startCheckout = (price: PriceOption['id']) =>
  request<CheckoutSession>('/api/billing/checkout', { method: 'POST', body: { price } })

export const openBillingPortal = () =>
  request<{ url: string }>('/api/billing/portal', { method: 'POST' })

/** The web app's own address, for pages (like the extension's) that can't run the checkout. */
export function webAppUrl(path = '/') {
  return (getTransport().baseUrl || window.location.origin) + path
}

// ── Jobs ────────────────────────────────────────────────────────────────────

/** Loads the job list while `enabled` is true; clears it when it turns false. */
export function useJobs(enabled: boolean) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled) {
      setJobs([])
      setLoading(true)
      return
    }
    let cancelled = false
    request<Job[]>('/api/jobs')
      .then(result => { if (!cancelled) setJobs(result) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled])

  return { jobs, setJobs, loading, error }
}

const createJob = (form: JobForm) =>
  request<Job>('/api/jobs', { method: 'POST', body: form })

const updateJob = (jobId: number, changes: Partial<JobForm> & { status?: JobStatus }) =>
  request<Job>(`/api/jobs/${jobId}`, { method: 'PATCH', body: changes })

const deleteJob = (jobId: number) =>
  request<null>(`/api/jobs/${jobId}`, { method: 'DELETE' })

export function useCreateJob() {
  const { run, ...state } = useRequest(createJob)
  return { createJob: run, ...state }
}

export function useUpdateJob() {
  const { run, ...state } = useRequest(updateJob)
  return { updateJob: run, ...state }
}

export function useDeleteJob() {
  const { run, ...state } = useRequest(deleteJob)
  return { deleteJob: run, ...state }
}
