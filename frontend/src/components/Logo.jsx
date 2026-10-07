import { useId } from 'react'

/**
 * The app mark: a white briefcase on an indigo tile. The same drawing, with
 * plain colour values, is public/favicon.svg (and the extension's PNG icons
 * rendered from it), and trackerButton.js draws the glyph on its badge — change
 * them together.
 */
export default function Logo({ size = 28, className }) {
  // Several logos can be on one page (header + a modal); gradient ids must differ.
  const id = useId()
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--brand-500)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-700)' }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="white" strokeOpacity="0.16" />
      <path d="M12.5 11V9.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V11" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <rect x="7" y="11" width="18" height="13.5" rx="3" fill="white" />
      <path d="M7 17.25h18" style={{ stroke: 'var(--brand-600)' }} strokeWidth="1.5" />
      <rect x="14" y="15.5" width="4" height="3.5" rx="1" style={{ fill: 'var(--brand-600)' }} />
    </svg>
  )
}
