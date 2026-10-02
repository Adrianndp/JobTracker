/**
 * The job boards that get a "Save to Job Tracker" button. Each shows the same
 * posting under several URLs, so saves store one canonical link per posting and
 * lookups compare on the board's posting id.
 *
 * LinkedIn: /jobs/view/<id>, /jobs/view/<slug>-<id>, and
 *   /jobs/search/?currentJobId=<id> when the posting is open in the right-hand
 *   pane of a results list. Canonical link: /jobs/view/<id>/.
 * XING: /jobs/<slug>-<id>, often with tracking parameters. The slug can't be
 *   dropped -- /jobs/<id> is treated as a search -- so the canonical link is the
 *   path without query or hash.
 * StepStone: /stellenangebote--<slug>--<id>-inline.html, plus tracking
 *   parameters. Canonical link: the same path without query or hash.
 */

const LINKEDIN_VIEW_RE = /\/jobs\/view\/(?:[^/]*?-)?(\d+)(?:[/?#]|$)/
const XING_JOB_RE = /^\/jobs\/([^/]+-(\d+))\/?$/
const STEPSTONE_JOB_RE = /^\/stellenangebote--.+--(\d+)-inline\.html$/

function linkedIn(url) {
  if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return null
  const fromQuery = url.searchParams.get('currentJobId')
  const id = url.pathname.match(LINKEDIN_VIEW_RE)?.[1]
    || (/^\d+$/.test(fromQuery || '') ? fromQuery : null)
  return id && { board: 'linkedin', id, link: `https://www.linkedin.com/jobs/view/${id}/` }
}

function xing(url) {
  if (!/(^|\.)xing\.com$/.test(url.hostname)) return null
  const match = url.pathname.match(XING_JOB_RE)
  return match && { board: 'xing', id: match[2], link: `https://www.xing.com/jobs/${match[1]}` }
}

function stepStone(url) {
  if (!/(^|\.)stepstone\.de$/.test(url.hostname)) return null
  const match = url.pathname.match(STEPSTONE_JOB_RE)
  return match && { board: 'stepstone', id: match[1], link: `https://www.stepstone.de${url.pathname}` }
}

/** { board, id, link } for a posting on a supported job board, or null. */
export function postingFromUrl(href) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return linkedIn(url) || xing(url) || stepStone(url) || null
}

export function samePosting(a, b) {
  return a.board === b.board && a.id === b.id
}
