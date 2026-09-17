import { useState } from 'react'
import styles from './LoginPage.module.css'

const MIN_PASSWORD_LENGTH = 8

export default function LoginPage({ setupRequired, onAuthenticated }) {
  const [mode, setMode] = useState(setupRequired ? 'register' : 'login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isRegister = mode === 'register'
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setEmail('')
    setPassword('')
    setConfirm('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    if (isRegister) {
      if (!email.trim() || !EMAIL_RE.test(email.trim())) {
        setError('Enter a valid email address.')
        return
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
        return
      }
      if (password !== confirm) {
        setError('Passwords do not match.')
        return
      }
    }

    setError('')
    setLoading(true)
    try {
      const res = await fetch(isRegister ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isRegister
            ? { username: username.trim(), email: email.trim(), password }
            : { username: username.trim(), password }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setPassword('')
        setConfirm('')
        setLoading(false)
        return
      }
      onAuthenticated(data.username)
    } catch {
      setError('Could not reach the server. Please try again.')
      setLoading(false)
    }
  }

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

        <h1 className={styles.title}>{isRegister ? 'Create your account' : 'Login'}</h1>
        <p className={styles.subtitle}>
          {isRegister
            ? 'This is the only account for this tracker. Sign-up closes once it is created.'
            : 'Welcome back. Log in to see your board.'}
        </p>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="username">Username</label>
            <input
              id="username"
              className={styles.input}
              autoComplete="username"
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>

          {isRegister && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className={styles.input}
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className={styles.input}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              placeholder={isRegister ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {isRegister && (
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
            {isRegister
              ? (loading ? 'Creating account...' : 'Create account')
              : (loading ? 'Logging in...' : 'Login')}
          </button>

          {!setupRequired && (
            <p className={styles.altAction}>
              {isRegister ? (
                <>Already have an account?{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('login')}>
                    Login here
                  </button>
                </>
              ) : (
                <>Don&rsquo;t have an account?{' '}
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('register')}>
                    Sign up here
                  </button>
                </>
              )}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
