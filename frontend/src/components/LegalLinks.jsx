import { webAppUrl } from '../api'
import styles from './LegalLinks.module.css'

// Static pages in public/legal, served by the web app (absolute, so they also
// work from the extension's pages).
const LINKS = [
  ['Impressum', '/legal/impressum.html'],
  ['Datenschutz', '/legal/datenschutz.html'],
  ['AGB', '/legal/agb.html'],
]

export default function LegalLinks({ className = '' }) {
  return (
    <nav className={`${styles.links} ${className}`} aria-label="Legal">
      {LINKS.map(([label, path]) => (
        <a key={path} href={webAppUrl(path)} target="_blank" rel="noopener noreferrer">{label}</a>
      ))}
    </nav>
  )
}
