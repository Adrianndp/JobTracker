import { useState } from 'react'
import { formatMoney } from '../api'
import LegalLinks from './LegalLinks'
import styles from './PricingPage.module.css'

const FAQ = [
  ['What counts as an active application?',
    'Jobs in To Be Applied, Applied and In Interview. Once a job moves to Rejected, Offer or Ghosted it no longer counts, so your history never fills up the free plan.'],
  ['What happens if I cancel Pro?',
    'Pro stays active until the end of the period you paid for, then your account goes back to Free. Nothing is deleted. If you have more than the free limit of active jobs, you just can’t add new ones until some are finished.'],
  ['Who handles the payment?',
    'Paddle, our reseller. It runs the secure checkout, charges the right VAT for your country and sends the invoice. We never see your card details.'],
  ['Can I get my data out?',
    'Yes. Export your board as CSV or PDF at any time, on any plan, and delete your account yourself under Account.'],
]

function Check() {
  return (
    <svg className={styles.check} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

/**
 * Free vs Pro, with a monthly / 3-month switch.
 *
 * plans: the public /api/billing/plans answer. billing: the signed-in user's
 * status, or null on the public version (before sign-up). onChoose(priceId)
 * starts the upgrade; onManage opens the account dialog for Pro users.
 */
export default function PricingPage({ plans, billing, onBack, backLabel, onChoose, onSignUp, onManage }) {
  const prices = plans?.prices || []
  const [period, setPeriod] = useState(prices.some(p => p.id === 'monthly') ? 'monthly' : prices[0]?.id)
  const monthly = prices.find(p => p.id === 'monthly')
  const selected = prices.find(p => p.id === period) || prices[0]
  const limit = plans?.free_active_limit || billing?.active_limit || 30
  const signedIn = Boolean(billing)
  const isPro = billing?.plan === 'pro'

  const savings = (price) => {
    if (!monthly || price.months <= 1) return 0
    return Math.round((1 - price.amount / (monthly.amount * price.months)) * 100)
  }

  const perMonth = selected && selected.months > 1
    ? formatMoney({ amount: Math.round(selected.amount / selected.months), currency: selected.currency })
    : ''

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}>
            <span className={styles.brandIcon} aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              </svg>
            </span>
            Job Tracker
          </span>
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← {backLabel}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Pricing</p>
          <h1 className={styles.title}>Start free. Go Pro when your search picks up.</h1>
          <p className={styles.lead}>
            Every plan tracks your whole search on one board, with one-click saving from LinkedIn, XING and StepStone.
          </p>
        </section>

        {!plans?.enabled && plans && (
          <p className={styles.offline}>
            Billing isn’t set up on this server, so every account is unlimited.
          </p>
        )}

        {prices.length > 1 && (
          <div className={styles.toggle} role="radiogroup" aria-label="Billing period">
            {prices.map(price => (
              <button
                key={price.id}
                type="button"
                role="radio"
                aria-checked={period === price.id}
                className={period === price.id ? styles.toggleOn : styles.toggleBtn}
                onClick={() => setPeriod(price.id)}
              >
                {price.months === 1 ? 'Monthly' : `Every ${price.months} months`}
                {savings(price) > 0 && <span className={styles.save}>Save {savings(price)}%</span>}
              </button>
            ))}
          </div>
        )}

        <div className={styles.cards}>
          <article className={styles.card}>
            <h2 className={styles.planName}>Free</h2>
            <p className={styles.planTagline}>For a focused search.</p>
            <p className={styles.price}>
              <span className={styles.amount}>{formatMoney({ amount: 0, currency: selected?.currency || 'EUR' }, { trim: true })}</span>
              <span className={styles.per}>forever</span>
            </p>
            <p className={styles.billing}>No card needed.</p>
            {signedIn ? (
              <button type="button" className={styles.ghostBtn} disabled>
                {isPro ? 'Included in Pro' : 'Your current plan'}
              </button>
            ) : (
              <button type="button" className={styles.ghostBtn} onClick={onSignUp}>Create free account</button>
            )}
            <ul className={styles.features}>
              <li><Check />Up to {limit} active applications</li>
              <li><Check />Unlimited finished ones: Rejected, Offer, Ghosted</li>
              <li><Check />One-click save from LinkedIn, XING and StepStone</li>
              <li><Check />Chrome extension with side panel</li>
              <li><Check />Export to CSV and PDF</li>
            </ul>
          </article>

          <article className={`${styles.card} ${styles.cardPro}`}>
            <span className={styles.ribbon}>Most popular</span>
            <h2 className={styles.planName}>Pro</h2>
            <p className={styles.planTagline}>For an active search, with no limits.</p>
            {selected ? (
              <>
                <p className={styles.price}>
                  <span className={styles.amount}>{formatMoney(selected, { trim: true })}</span>
                  <span className={styles.per}>{selected.months === 1 ? '/ month' : `/ ${selected.months} months`}</span>
                </p>
                <p className={styles.billing}>
                  {selected.months === 1 ? 'Billed monthly. Cancel anytime.' : `${perMonth} a month, billed every ${selected.months} months.`}
                </p>
              </>
            ) : (
              <p className={styles.price}><span className={styles.amount}>—</span></p>
            )}
            {isPro ? (
              <button type="button" className={styles.primaryBtn} onClick={onManage}>Your plan · Manage</button>
            ) : signedIn ? (
              <button type="button" className={styles.primaryBtn} onClick={() => onChoose(selected.id)} disabled={!selected || !plans?.enabled}>
                Upgrade to Pro
              </button>
            ) : (
              <button type="button" className={styles.primaryBtn} onClick={onSignUp}>Start free, upgrade anytime</button>
            )}
            <ul className={styles.features}>
              <li><Check /><span><strong>Unlimited</strong> active applications</span></li>
              <li><Check />Everything in Free</li>
              <li><Check />Cancel anytime and keep your board</li>
              <li><Check />Supports an independent tool, hosted in the EU</li>
            </ul>
          </article>
        </div>

        <p className={styles.trust}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Prices include VAT. Secure checkout by Paddle, our reseller. Cancel anytime.
        </p>

        <section className={styles.faq}>
          <h2 className={styles.faqTitle}>Questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className={styles.faqItem}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      </main>

      <footer className={styles.footer}>
        <LegalLinks />
      </footer>
    </div>
  )
}
