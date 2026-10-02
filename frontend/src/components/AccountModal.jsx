import { useEffect, useRef, useState } from 'react'
import { ApiError, formatMoney, getBillingDetails, getInvoiceUrl, openBillingPortal, useDeleteAccount } from '../api'
import styles from './AccountModal.module.css'

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
}

function message(err) {
  return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong. Please try again.'
}

/**
 * Opens a link we only get after an API call. The tab is opened before the
 * await, while the click still counts, so it isn't blocked as a popup.
 */
async function openFetchedLink(fetchUrl) {
  const tab = window.open('', '_blank')
  try {
    const url = await fetchUrl()
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.href = url
    }
  } catch (err) {
    tab?.close()
    throw err
  }
}

const CARD_BRANDS = { visa: 'Visa', mastercard: 'Mastercard', american_express: 'American Express', maestro: 'Maestro' }
const METHOD_NAMES = { paypal: 'PayPal', apple_pay: 'Apple Pay', google_pay: 'Google Pay', sepa_debit: 'SEPA Direct Debit' }

function paymentMethodText(method) {
  if (!method) return ''
  if (method.type === 'card') {
    const brand = CARD_BRANDS[method.brand] || 'Card'
    return method.last4 ? `${brand} •••• ${method.last4}` : brand
  }
  return METHOD_NAMES[method.type] || method.type.replace(/_/g, ' ')
}

function FreePlan({ billing, onShowPlans }) {
  const used = Math.min(billing.active_jobs, billing.active_limit ?? billing.active_jobs)
  const percent = billing.active_limit ? Math.min(100, (used / billing.active_limit) * 100) : 0
  const full = billing.active_limit != null && billing.active_jobs >= billing.active_limit

  return (
    <section className={styles.section}>
      <div className={styles.planHeader}>
        <h3 className={styles.sectionTitle}>Plan</h3>
        <span className={styles.badgeFree}>Free</span>
      </div>
      <div className={styles.usage}>
        <div className={styles.usageLabel}>
          <span>Active applications</span>
          <strong>{billing.active_jobs} / {billing.active_limit}</strong>
        </div>
        <div className={`${styles.meter} ${full ? styles.meterFull : ''}`}><span style={{ width: `${percent}%` }} /></div>
        <p className={styles.hint}>Jobs in Rejected, Offer or Ghosted don’t count.</p>
      </div>
      <div className={styles.upsell}>
        <div>
          <strong>Pro: no limit on active applications</strong>
          <span>
            {cheapestPerMonth(billing.prices) && `From ${formatMoney(cheapestPerMonth(billing.prices))} a month. `}
            Cancel anytime.
          </span>
        </div>
        <button type="button" className={styles.primaryBtn} onClick={onShowPlans}>See plans</button>
      </div>
    </section>
  )
}

function cheapestPerMonth(prices = []) {
  const monthly = prices.map(p => ({ amount: Math.round(p.amount / p.months), currency: p.currency }))
  return monthly.sort((a, b) => a.amount - b.amount)[0] || null
}

/** Pro: the subscription as Paddle has it, invoices, and the customer portal. */
function ProPlan({ billing }) {
  const [details, setDetails] = useState(undefined) // undefined: loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (billing.complimentary || !billing.can_manage) {
      setDetails(null)
      return undefined
    }
    let cancelled = false
    getBillingDetails()
      .then(result => { if (!cancelled) setDetails(result.subscription) })
      .catch(err => { if (!cancelled) { setDetails(null); setError(message(err)) } })
    return () => { cancelled = true }
  }, [billing.complimentary, billing.can_manage])

  const run = async (key, fetchUrl) => {
    setError('')
    setBusy(key)
    try {
      await openFetchedLink(fetchUrl)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy('')
    }
  }

  const cancelAt = details?.cancel_at || (billing.cancel_at_period_end && billing.current_period_end)
  let status = { text: 'Active', tone: styles.statusOk }
  if (billing.complimentary) status = { text: 'Complimentary', tone: styles.statusOk }
  else if (billing.status === 'past_due') status = { text: 'Payment failed', tone: styles.statusBad }
  else if (cancelAt) status = { text: `Ends ${formatDate(cancelAt)}`, tone: styles.statusWarn }

  const nextDate = details?.next_billed_at || (!cancelAt && billing.current_period_end)

  return (
    <section className={styles.section}>
      <div className={styles.planHeader}>
        <h3 className={styles.sectionTitle}>Plan & billing</h3>
        <span className={styles.badgePro}>Pro</span>
      </div>

      {billing.status === 'past_due' && (
        <p className={styles.alert} role="alert">
          Your last payment didn’t go through. Update your payment method under Manage billing to keep Pro.
        </p>
      )}

      <dl className={styles.rows}>
        <div>
          <dt>Plan</dt>
          <dd>{billing.complimentary ? 'Pro, no payment needed' : `Pro${details?.label ? ` · ${details.label}` : ''}`}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd><span className={`${styles.status} ${status.tone}`}>{status.text}</span></dd>
        </div>
        {!billing.complimentary && (
          <>
            <div>
              <dt>{cancelAt ? 'Access until' : 'Next payment'}</dt>
              <dd>
                {details === undefined ? <span className={styles.skeleton} /> : cancelAt
                  ? formatDate(cancelAt)
                  : [formatMoney(details?.next_payment), nextDate && `on ${formatDate(nextDate)}`].filter(Boolean).join(' ') || '—'}
              </dd>
            </div>
            <div>
              <dt>Payment method</dt>
              <dd>{details === undefined ? <span className={styles.skeleton} /> : paymentMethodText(details?.payment_method) || '—'}</dd>
            </div>
          </>
        )}
      </dl>

      {details?.invoices?.length > 0 && (
        <div className={styles.invoices}>
          <h4 className={styles.subTitle}>Invoices</h4>
          <ul>
            {details.invoices.map(invoice => (
              <li key={invoice.id}>
                <span>{formatDate(invoice.billed_at)}</span>
                <span className={styles.invoiceAmount}>{formatMoney(invoice.total)}</span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => run(invoice.id, () => getInvoiceUrl(invoice.id).then(r => r.url))}
                  disabled={busy === invoice.id}
                >
                  {busy === invoice.id ? 'Opening…' : 'Download'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {billing.can_manage && (
        <div className={styles.manage}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => run('portal', () => openBillingPortal().then(r => r.url))}
            disabled={busy === 'portal'}
          >
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
          <span className={styles.hint}>Change plan or payment method, or cancel, in Paddle’s secure portal.</span>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}

function DeleteSection({ onDeleted }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { deleteAccount, loading } = useDeleteAccount()

  const submit = async (e) => {
    e.preventDefault()
    if (!password) return setError('Enter your password to confirm.')
    setError('')
    try {
      await deleteAccount(password)
      onDeleted()
    } catch (err) {
      setPassword('')
      setError(message(err))
    }
  }

  return (
    <section className={`${styles.section} ${styles.danger}`}>
      <h3 className={styles.sectionTitle}>Delete account</h3>
      <p className={styles.text}>
        Removes your account, every job on your board and all connected browsers. A Pro subscription
        is cancelled straight away. This can’t be undone, so export your board first if you want a copy.
      </p>
      {open ? (
        <form className={styles.deleteForm} onSubmit={submit} noValidate>
          <label className={styles.label} htmlFor="delete-password">Your password</label>
          <input
            id="delete-password"
            type="password"
            className={styles.input}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryBtn} onClick={() => { setOpen(false); setError('') }}>
              Cancel
            </button>
            <button type="submit" className={styles.deleteBtn} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={styles.deleteLink} onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      )}
    </section>
  )
}

export default function AccountModal({ username, billing, onShowPlans, onClose, onDeleted }) {
  const closeBtn = useRef(null)

  useEffect(() => {
    closeBtn.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="account-title" className={styles.title}>Account</h2>
            <p className={styles.subtitle}>{username}</p>
          </div>
          <button ref={closeBtn} className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {billing?.enabled && (billing.plan === 'pro'
            ? <ProPlan billing={billing} />
            : <FreePlan billing={billing} onShowPlans={onShowPlans} />)}
          <DeleteSection onDeleted={onDeleted} />
        </div>
      </div>
    </div>
  )
}
