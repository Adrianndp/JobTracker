import LegalLinks from './LegalLinks'
import Logo from './Logo'
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
          <Logo size={32} />
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
