/**
 * The confetti burst when a job lands in "Got an Offer". canvas-confetti is
 * loaded on first use, so it costs nothing until someone actually gets an
 * offer; it draws on one temporary full-screen canvas that removes itself when
 * the last piece has fallen.
 */
let fire: ((options: object) => unknown) | null = null

export async function celebrate(statusColor: string): Promise<void> {
  // index.css's reduced-motion rule can't reach a canvas; checking here also skips the download.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (!fire) {
    const { default: confetti } = await import('canvas-confetti')
    // The library's default instance animates in a Worker started from a blob:
    // URL, which neither CSP allows (worker-src falls back to script-src 'self').
    // The main thread copes fine with 140 pieces.
    fire = confetti.create(null, { resize: true, useWorker: false })
  }
  // The column's own colour plus the brand indigo, read from tokens.css.
  const root = getComputedStyle(document.documentElement)
  const colors = [statusColor, ...['--brand-400', '--brand-600', '--warning-border']
    .map((name) => root.getPropertyValue(name).trim()).filter(Boolean)]
  const shared = { colors, zIndex: 2000, ticks: 250 }
  // Two angled bursts from the lower corners read as a celebration rather
  // than a single puff in the middle of the board.
  fire({ ...shared, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } })
  fire({ ...shared, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } })
}
