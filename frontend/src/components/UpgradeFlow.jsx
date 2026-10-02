import { useEffect, useRef, useState } from 'react'
import { ApiError, formatMoney, previewPrice, startCheckout } from '../api'
import { openCheckout } from '../lib/paddle'
import styles from './UpgradeFlow.module.css'

const STEPS = ['Plan', 'Review', 'Payment', 'Done']
// Paddle's webhook usually lands within seconds of payment; poll until it has.
const ACTIVATION_POLL_MS = 2000
const ACTIVATION_TIMEOUT_MS = 60000

function periodText(price) {
  return price.months === 1 ? 'month' : `${price.months} months`
}

function addMonths(months) {
  const date = new Date()
  date.setMonth(date.getMonth() + months)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function errorText(err) {
  return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong. Please try again.'
}

function Stepper({ step }) {
  return (
    <ol className={styles.stepper}>
      {STEPS.map((label, index) => {
        const state = index < step ? 'done' : index === step ? 'current' : 'todo'
        return (
          <li key={label} className={styles[state]} aria-current={state === 'current' ? 'step' : undefined}>
            <span className={styles.dot}>
              {state === 'done' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : index + 1}
            </span>
            <span className={styles.stepLabel}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Upgrading as four steps: choose the period, review what you'll pay and how
 * cancelling works, pay in Paddle's overlay, and wait for the account to turn Pro.
 *
 * prices: offered plans; initialPrice preselects one and starts at Review.
 */
export default function UpgradeFlow({ prices, initialPrice, billing, reloadBilling, onClose, onDone }) {
  const [step, setStep] = useState(initialPrice ? 1 : 0)
  const [priceId, setPriceId] = useState(initialPrice || prices.find(p => p.id === 'monthly')?.id || prices[0]?.id)
  const [preview, setPreview] = useState(undefined) // undefined: loading, null: unavailable
  const [payment, setPayment] = useState('idle') // idle | opening | open | closed | activating | timeout
  const [error, setError] = useState('')
  const dialog = useRef(null)
  const price = prices.find(p => p.id === priceId)
  const monthly = prices.find(p => p.id === 'monthly')
  const isPro = billing?.plan === 'pro'
  // Paddle's overlay sits above us; Escape there mustn't close this too
  const busy = payment === 'opening' || payment === 'open' || payment === 'activating'

  useEffect(() => {
    dialog.current?.focus()
  }, [step])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // The VAT for the buyer's country, for the review step
  useEffect(() => {
    if (step !== 1 || !priceId) return undefined
    let cancelled = false
    setPreview(undefined)
    previewPrice(priceId).then(result => { if (!cancelled) setPreview(result) })
    return () => { cancelled = true }
  }, [step, priceId])

  // After payment: wait for the webhook to make the account Pro
  useEffect(() => {
    if (payment !== 'activating') return undefined
    if (isPro) {
      setStep(3)
      setPayment('idle')
      return undefined
    }
    const poll = setInterval(reloadBilling, ACTIVATION_POLL_MS)
    const giveUp = setTimeout(() => setPayment('timeout'), ACTIVATION_TIMEOUT_MS)
    return () => { clearInterval(poll); clearTimeout(giveUp) }
  }, [payment, isPro, reloadBilling])

  const pay = async () => {
    setStep(2)
    setError('')
    setPayment('opening')
    try {
      const session = await startCheckout(priceId)
      setPayment('open')
      const result = await openCheckout(session)
      setPayment(result === 'completed' ? 'activating' : 'closed')
      if (result === 'completed') reloadBilling()
    } catch (err) {
      setPayment('closed')
      setError(errorText(err))
    }
  }

  const savings = (p) => (monthly && p.months > 1
    ? Math.round((1 - p.amount / (monthly.amount * p.months)) * 100) : 0)

  const total = preview?.total || (price && { amount: price.amount, currency: price.currency })
  const taxRate = preview?.tax_rate ? `${Math.round(Number(preview.tax_rate) * 1000) / 10}%` : ''
  const vatWhere = [taxRate, preview?.country].filter(Boolean).join(', ')

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onClose}>
      <div
        ref={dialog}
        tabIndex={-1}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.top}>
          <h2 id="upgrade-title" className={styles.title}>Upgrade to Pro</h2>
          {!busy && (
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <Stepper step={step} />

        <div className={styles.body}>
          {step === 0 && (
            <>
              <p className={styles.lead}>How often would you like to pay?</p>
              <div className={styles.options} role="radiogroup" aria-label="Billing period">
                {prices.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={priceId === p.id}
                    className={priceId === p.id ? styles.optionOn : styles.option}
                    onClick={() => setPriceId(p.id)}
                  >
                    <span className={styles.radio} aria-hidden="true" />
                    <span className={styles.optionText}>
                      <strong>{p.months === 1 ? 'Monthly' : `Every ${p.months} months`}</strong>
                      <span>
                        {p.months === 1
                          ? 'Flexible, cancel anytime'
                          : `${formatMoney({ amount: Math.round(p.amount / p.months), currency: p.currency })} a month`}
                      </span>
                    </span>
                    <span className={styles.optionPrice}>
                      {formatMoney(p, { trim: true })}
                      {savings(p) > 0 && <span className={styles.save}>Save {savings(p)}%</span>}
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
                <button type="button" className={styles.primaryBtn} onClick={() => setStep(1)} disabled={!price}>Continue</button>
              </div>
            </>
          )}

          {step === 1 && price && (
            <>
              <dl className={styles.summary}>
                <div>
                  <dt>Plan</dt>
                  <dd>Job Tracker Pro, every {periodText(price)}</dd>
                </div>
                <div>
                  <dt>Due today</dt>
                  <dd className={styles.totalCell}>
                    {preview === undefined ? <span className={styles.skeleton} /> : formatMoney(total)}
                  </dd>
                </div>
                <div>
                  <dt>VAT</dt>
                  <dd>
                    {preview?.tax
                      ? `Includes ${formatMoney(preview.tax)}${vatWhere ? ` (${vatWhere})` : ''}`
                      : 'Included. The checkout shows the exact amount for your country.'}
                  </dd>
                </div>
                <div>
                  <dt>Renews</dt>
                  <dd>Every {periodText(price)} until you cancel. Next payment on {addMonths(price.months)}.</dd>
                </div>
              </dl>
              <ul className={styles.notes}>
                <li>Cancel anytime under Account → Manage billing. Pro stays active until the end of the period you paid for.</li>
                <li>Paddle, our reseller, takes the payment, sends your VAT invoice and handles your 14-day withdrawal right.</li>
              </ul>
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryBtn} onClick={() => setStep(0)}>Back</button>
                <button type="button" className={styles.primaryBtn} onClick={pay}>Continue to payment</button>
              </div>
            </>
          )}

          {step === 2 && (
            <div className={styles.center}>
              {payment === 'opening' || payment === 'open' ? (
                <>
                  <span className={styles.lockIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </span>
                  <p className={styles.centerTitle}>{payment === 'opening' ? 'Opening the secure checkout…' : 'Complete your payment in the Paddle window'}</p>
                  <p className={styles.hint}>Your card details go straight to Paddle. We never see them.</p>
                </>
              ) : payment === 'activating' ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  <p className={styles.centerTitle} role="status">Payment received. Activating Pro…</p>
                  <p className={styles.hint}>This usually takes a few seconds.</p>
                </>
              ) : payment === 'timeout' ? (
                <>
                  <p className={styles.centerTitle}>Your payment went through</p>
                  <p className={styles.hint}>Pro isn’t active yet. It can take a minute; reload the page shortly. Your receipt is on its way by email.</p>
                  <div className={styles.actions}>
                    <button type="button" className={styles.primaryBtn} onClick={onClose}>Close</button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.centerTitle}>{error ? 'The checkout couldn’t open' : 'The payment wasn’t completed'}</p>
                  <p className={styles.hint}>{error || 'You closed the payment window. Nothing was charged.'}</p>
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondaryBtn} onClick={() => { setStep(1); setPayment('idle'); setError('') }}>Back</button>
                    <button type="button" className={styles.primaryBtn} onClick={pay}>Try again</button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className={styles.center}>
              <span className={styles.successIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <p className={styles.centerTitle}>You’re on Pro</p>
              <p className={styles.hint}>
                Unlimited active applications are unlocked. Paddle has emailed your receipt; invoices are under Account.
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.primaryBtn} onClick={onDone}>Back to my board</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
