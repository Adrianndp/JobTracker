/**
 * Job links are free text: rows predating server-side validation hold notes like
 * "easy apply", and a scraper reads links off pages we don't control. Rendering
 * either straight into an href is how a `javascript:` URL becomes click-to-XSS.
 *
 * Parsed with no base URL on purpose. Resolving against the current page would
 * quietly turn "easy apply" into a same-origin link and, worse, promote a
 * protocol-relative "//evil.example" into a real external navigation. Only an
 * absolute http(s) URL is a link -- matching clean_link() on the server.
 */
export function safeHref(link: string | null | undefined): string | null {
  if (!link) return null
  try {
    const url = new URL(link)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
