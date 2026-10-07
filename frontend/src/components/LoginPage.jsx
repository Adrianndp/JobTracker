import { useState } from 'react'
import { ApiError, useLogin, usePasswordReset, useSignup, useVerifyEmail, webAppUrl } from '../api'
import AuthCard from './AuthCard'
import ui from './AuthForm.module.css'
import styles from './LoginPage.module.css'

const MIN_PASSWORD_LENGTH = 10
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Links in allauth's emails open the app at /?mode=signup or /?mode=forgot
function initialMode() {
  const mode = new URLSearchParams(window.location.search).get('mode')
  return mode === 'signup' || mode === 'forgot' ? mode : 'login'
}

const TITLES = {
  login: 'Welcome back',
  signup: 'Create your account',
  verify: 'Check your inbox',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}

/**
 * The website's sign-in: allauth handles sign-up, login, email verification and
 * password reset, all with emailed codes typed in here, on the session cookie.
 * The extension can't use that cookie and has its own ExtensionLogin.
 */
export default function LoginPage({ onAuthenticated, onShowPlans }) {
  const [mode, setMode] = useState(initialMode)
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
    login: 'Log in to see your board.',
    signup: 'Track every application on one board. Free for up to 30 active applications.',
    verify: 'Enter the code we emailed you to confirm your address.',
    forgot: 'Enter your email and we will send you a reset code.',
    reset: 'Enter the code from the email and your new password.',
  }[mode]

  const submitLabel = {
    login: ['Log in', 'Logging in…'],
    signup: ['Create account', 'Creating account…'],
    verify: ['Confirm email', 'Confirming…'],
    forgot: ['Send code', 'Sending…'],
    reset: ['Set new password', 'Saving…'],
  }[mode][loading ? 1 : 0]

  const showEmail = mode === 'login' || mode === 'signup' || mode === 'forgot'
  const showNewPassword = mode === 'signup' || mode === 'reset'

  return (
    <AuthCard title={TITLES[mode]} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className={ui.form} noValidate>
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        {showEmail && (
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
        )}

        {mode === 'signup' && (
          <div className={ui.field}>
            <label className={ui.label} htmlFor="username">Username</label>
            <input
              id="username"
              className={ui.input}
              autoComplete="username"
              placeholder="Shown on your board"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>
        )}

        {(mode === 'verify' || mode === 'reset') && (
          <div className={ui.field}>
            <label className={ui.label} htmlFor="code">Code</label>
            <input
              id="code"
              className={`${ui.input} ${styles.codeInput}`}
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
          <div className={ui.field}>
            <div className={ui.labelRow}>
              <label className={ui.label} htmlFor="password">
                {mode === 'reset' ? 'New password' : 'Password'}
              </label>
              {mode === 'login' && (
                <button type="button" className={ui.linkBtn} onClick={() => switchMode('forgot')}>
                  Forgot password?
                </button>
              )}
            </div>
            <input
              id="password"
              type="password"
              className={ui.input}
              autoComplete={showNewPassword ? 'new-password' : 'current-password'}
              placeholder={showNewPassword ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
        )}

        {showNewPassword && (
          <div className={ui.field}>
            <label className={ui.label} htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              className={ui.input}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />
          </div>
        )}

        {error && <p className={ui.error} role="alert">{error}</p>}

        <button type="submit" className={ui.submitBtn} disabled={loading}>
          {loading && <span className={ui.btnSpinner} />}
          {submitLabel}
        </button>

        {mode === 'signup' && (
          <p className={styles.terms}>
            By creating an account you accept the{' '}
            <a href={webAppUrl('/legal/agb.html')} target="_blank" rel="noopener noreferrer">terms (AGB)</a>
            {' '}and have read the{' '}
            <a href={webAppUrl('/legal/datenschutz.html')} target="_blank" rel="noopener noreferrer">privacy policy</a>.
          </p>
        )}

        <div className={styles.divider} />

        <p className={ui.altAction}>
          {mode === 'login' && (
            <>Don&rsquo;t have an account?{' '}
              <button type="button" className={ui.linkBtn} onClick={() => switchMode('signup')}>
                Sign up
              </button>
            </>
          )}
          {mode === 'signup' && (
            <>Already have an account?{' '}
              <button type="button" className={ui.linkBtn} onClick={() => switchMode('login')}>
                Log in
              </button>
            </>
          )}
          {mode === 'verify' && (
            <>Didn&rsquo;t get it?{' '}
              <button type="button" className={ui.linkBtn} onClick={resend}>
                Send a new code
              </button>
            </>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" className={ui.linkBtn} onClick={() => switchMode('login')}>
              Back to login
            </button>
          )}
          {onShowPlans && (mode === 'login' || mode === 'signup') && (
            <>
              {' · '}
              <button type="button" className={ui.linkBtn} onClick={onShowPlans}>Plans &amp; pricing</button>
            </>
          )}
        </p>
      </form>
    </AuthCard>
  )
}
