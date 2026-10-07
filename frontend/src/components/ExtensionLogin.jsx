import { useState } from 'react'
import { ApiError, useTokenLogin, webAppUrl } from '../api'
import AuthCard from './AuthCard'
import ui from './AuthForm.module.css'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * The extension's sign-in (side panel and board tab): email + password
 * exchanged for a bearer token, because a cross-origin extension page never
 * receives the website's session cookie. Sign-up and password reset are
 * allauth session flows, so they only exist on the website; the links open it
 * on the matching screen.
 * onAuthenticated(username, grant) -- grant carries the token to store.
 * compact: for the narrow side panel, without the full-page frame.
 */
export default function ExtensionLogin({ onAuthenticated, compact = false }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { tokenLogin } = useTokenLogin()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.')
    if (!password) return setError('Enter your password.')

    setError('')
    setLoading(true)
    try {
      const grant = await tokenLogin({ email: email.trim(), password, device_name: 'Chrome extension' })
      onAuthenticated(grant.username, grant)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard title="Log in" subtitle="Connect this browser to your board." compact={compact}>
      <form onSubmit={handleSubmit} className={ui.form} noValidate>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className={ui.input}
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div className={ui.field}>
          <div className={ui.labelRow}>
            <label className={ui.label} htmlFor="password">Password</label>
            <a className={ui.linkBtn} href={webAppUrl('/?mode=forgot')} target="_blank" rel="noopener noreferrer">
              Forgot password?
            </a>
          </div>
          <input
            id="password"
            type="password"
            className={ui.input}
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        {error && <p className={ui.error} role="alert">{error}</p>}

        <button type="submit" className={ui.submitBtn} disabled={loading}>
          {loading && <span className={ui.btnSpinner} />}
          {loading ? 'Logging in…' : 'Log in'}
        </button>

        <p className={ui.altAction}>
          New here?{' '}
          <a className={ui.linkBtn} href={webAppUrl('/?mode=signup')} target="_blank" rel="noopener noreferrer">
            Create an account
          </a>
          {' '}on the website, then log in here.
        </p>
      </form>
    </AuthCard>
  )
}
