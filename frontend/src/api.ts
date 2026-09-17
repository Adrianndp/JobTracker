import { useCallback, useEffect, useRef, useState } from 'react'

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
  setup_required: boolean
}

export interface Credentials {
  username: string
  password: string
}

export interface SignupData extends Credentials {
  email: string
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ── Request helper (internal — components use the hooks below) ──────────────

const unauthorizedListeners = new Set<() => void>()

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  // Login/signup answer 401 for wrong credentials, which isn't an expired session
  notifyUnauthorized?: boolean
}

async function request<T>(url: string, { method = 'GET', body, notifyUnauthorized = true }: RequestOptions = {}): Promise<T> {
  const res = await fetch(url, {
    method,
    // The backend only accepts JSON for POST/PATCH, even without a body
    headers: method === 'POST' || method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401 && notifyUnauthorized) {
    unauthorizedListeners.forEach(listener => listener())
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.')
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

const login = (credentials: Credentials) =>
  request<{ username: string }>('/api/auth/login', { method: 'POST', body: credentials, notifyUnauthorized: false })

const signup = (data: SignupData) =>
  request<{ username: string }>('/api/auth/signup', { method: 'POST', body: data, notifyUnauthorized: false })

const logout = () =>
  request<null>('/api/auth/logout', { method: 'POST', notifyUnauthorized: false })

export function useLogin() {
  const { run, ...state } = useRequest(login)
  return { login: run, ...state }
}

export function useSignup() {
  const { run, ...state } = useRequest(signup)
  return { signup: run, ...state }
}

export function useLogout() {
  const { run, ...state } = useRequest(logout)
  return { logout: run, ...state }
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
