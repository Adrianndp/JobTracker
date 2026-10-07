import LegalLinks from './LegalLinks'
import styles from './AuthCard.module.css'

/**
 * The frame both sign-in screens share: the website's LoginPage and the
 * extension's ExtensionLogin. Only the look lives here; each form keeps its
 * own state and auth flow. compact drops the full-height page around the card
 * (the extension's side panel).
 */
export default function AuthCard({ title, subtitle, children, compact = false }) {
  return (
    <div className={compact ? styles.pageCompact : styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </span>
          <span className={styles.brandName}>Job Tracker</span>
        </div>

        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}

        {children}
      </div>
      <LegalLinks className={styles.legal} />
    </div>
  )
}
