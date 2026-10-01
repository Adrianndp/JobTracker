/**
 * LinkedIn shows the same posting under several URLs -- /jobs/view/<id>,
 * /jobs/view/<slug>-<id>, and /jobs/search/?currentJobId=<id> when it is open in
 * the right-hand pane of a results list. The numeric id is what identifies the
 * posting, so saves use one canonical link and lookups compare on the id.
 */

const VIEW_RE = /\/jobs\/view\/(?:[^/]*?-)?(\d+)(?:[/?#]|$)/

/** The posting id in a LinkedIn URL, or null. */
export function linkedInJobId(href) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return null
  const fromPath = url.pathname.match(VIEW_RE)
  if (fromPath) return fromPath[1]
  const fromQuery = url.searchParams.get('currentJobId')
  return /^\d+$/.test(fromQuery || '') ? fromQuery : null
}

export function canonicalLinkedInLink(id) {
  return `https://www.linkedin.com/jobs/view/${id}/`
}
