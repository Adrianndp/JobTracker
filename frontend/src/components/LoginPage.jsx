import { useState } from 'react'
import { ApiError, useLogin, usePasswordReset, useSignup, useTokenLogin, useVerifyEmail } from '../api'
import styles from './LoginPage.module.css'

const MIN_PASSWORD_LENGTH = 10
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Links in allauth's emails open the app at /?mode=signup or /?mode=forgot
function initialMode() {
  const mode = new URLSearchParams(window.location.search).get('mode')
  return mode === 'signup' || mode === 'forgot' ? mode : 'login'
}

const TITLES = {
  login: 'Login',
  signup: 'Create your account',
  verify: 'Check your inbox',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}

/**
 * authMode 'session' (default) is the web app: allauth handles sign-up, login,
 * email verification and password reset, all with emailed codes typed in here.
 * 'token' is the extension: email + password exchanged for a bearer token,
 * because a cross-origin extension page never receives the cookie. Everything
 * else about the account happens on the website.
 * onAuthenticated(username, grant) -- grant is only present in token mode.
 */
export default function LoginPage({ onAuthenticated, authMode = 'session' }) {
  const isTokenMode = authMode === 'token'
  const [mode, setMode] = useState(isTokenMode ? 'login' : initialMode)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useLogin()
  const { signup } = useSignup()
  const { tokenLogin } = useTokenLogin()
  const { verifyEmail, resendVerification } = useVerifyEmail()
  const { requestPasswordReset, resetPassword } = usePasswordReset()

  const switchMode = (next, message = '') => {
    setMode(next)
    setError('')
    setNotice(message)
    setPassword('')
    setConfirm('')
    setCode('')
  }

  // An allauth step either signs the user in or leaves an emailed code pending
  const follow = (result) => {
    if (result.done) {
      onAuthenticated(result.username)
    } else if (result.pending === 'verify_email') {
      switchMode('verify', `We sent a code to ${email.trim()}.`)
    } else if (result.pending === 'password_reset_by_code') {
      switchMode('reset', `If ${email.trim()} has an account, we sent it a code.`)
    } else {
      switchMode('login', 'Please log in.')
    }
  }

  const validate = () => {
    const needsEmail = mode === 'login' || mode === 'signup' || mode === 'forgot'
    if (needsEmail && !EMAIL_RE.test(email.trim())) return 'Enter a valid email address.'
    if (mode === 'login' && !password) return 'Enter your password.'
    if (mode === 'signup' && !username.trim()) return 'Choose a username.'
    if ((mode === 'verify' || mode === 'reset') && !code.trim()) return 'Enter the code from the email.'
    if (mode === 'signup' || mode === 'reset') {
      if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      if (password !== confirm) return 'Passwords do not match.'
    }
    return ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setLoading(true)
    try {
      if (isTokenMode) {
        const grant = await tokenLogin({ email: email.trim(), password, device_name: 'Chrome extension' })
        onAuthenticated(grant.username, grant)
        return
      }
      if (mode === 'login') follow(await login({ email: email.trim(), password }))
      if (mode === 'signup') follow(await signup({ email: email.trim(), username: username.trim(), password }))
      if (mode === 'verify') follow(await verifyEmail(code.trim()))
      if (mode === 'forgot') follow(await requestPasswordReset(email.trim()))
      if (mode === 'reset') {
        const result = await resetPassword(code.trim(), password)
        result.done ? follow(result) : switchMode('login', 'Password changed. Log in with your new password.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.')
      if (mode !== 'verify' && mode !== 'reset') {
        setPassword('')
        setConfirm('')
      }
    } finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    setError('')
    try {
      await resendVerification()
      setNotice(`We sent a new code to ${email.trim() || 'your email'}.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.')
    }
  }

  const subtitle = {
    login: isTokenMode
      ? 'Sign in to connect this browser to your tracker.'
      : 'Welcome back. Log in to see your board.',
    signup: 'Track every application on one board. Free for up to 5 jobs.',
    verify: 'Enter the code we emailed you to confirm your address.',
    forgot: 'Enter your email and we will send you a reset code.',
    reset: 'Enter the code from the email and your new password.',
  }[mode]

  const submitLabel = {
    login: ['Login', 'Logging in...'],
    signup: ['Create account', 'Creating account...'],
    verify: ['Confirm email', 'Confirming...'],
    forgot: ['Send code', 'Sending...'],
    reset: ['Set new password', 'Saving...'],
  }[mode][loading ? 1 : 0]

  const showEmail = mode === 'login' || mode === 'signup' || mode === 'forgot'
  const showNewPassword = mode === 'signup' || mode === 'reset'

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </span>
          <span className={styles.brandName}>Job Tracker</span>
        </div>

        <h1 className={styles.title}>{TITLES[mode]}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          {notice && <p className={styles.notice} role="status">{notice}</p>}

          {showEmail && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className={styles.input}
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="username">Username</label>
              <input
                id="username"
                className={styles.input}
                autoComplete="username"
                placeholder="Shown on your board"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
          )}

          {(mode === 'verify' || mode === 'reset') && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="code">Code</label>
              <input
                id="code"
                className={`${styles.input} ${styles.codeInput}`}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoFocus
                placeholder="XXXX-XXXX"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
              />
            </div>
          )}

          {(mode === 'login' || showNewPassword) && (
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.label} htmlFor="password">
                  {mode === 'reset' ? 'New password' : 'Password'}
                </label>
                {mode === 'login' && !isTokenMode && (
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                className={styles.input}
                autoComplete={showNewPassword ? 'new-password' : 'current-password'}
                placeholder={showNewPassword ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          )}

          {showNewPassword && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                className={styles.input}
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading && <span className={styles.btnSpinner} />}
            {submitLabel}
          </button>

          {!isTokenMode && (
            <p className={styles.altAction}>
              {mode === 'login' && (
                <>Don&rsquo;t have an account?{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('signup')}>
                    Sign up
                  </button>
                </>
              )}
              {mode === 'signup' && (
                <>Already have an account?{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('login')}>
                    Log in
                  </button>
                </>
              )}
              {mode === 'verify' && (
                <>Didn&rsquo;t get it?{' '}
                  <button type="button" className={styles.linkBtn} onClick={resend}>
                    Send a new code
                  </button>
                </>
              )}
              {(mode === 'forgot' || mode === 'reset') && (
                <button type="button" className={styles.linkBtn} onClick={() => switchMode('login')}>
                  Back to login
                </button>
              )}
            </p>
          )}

          {isTokenMode && (
            <p className={styles.altAction}>
              New here or forgot your password? Use the website, then sign in here.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
