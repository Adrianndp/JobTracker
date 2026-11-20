/**
 * Fuzzy company matching: decides when two typed company names are probably the
 * same employer ("Siemens AG" / "siemens", "Müller GmbH" / "Mueller", "Robert
 * Bosch GmbH" / "Bosch", "Zalandoo" / "Zalando"), and groups a board's jobs by it.
 *
 * Purely client-side and deliberately forgiving: it only drives hints and a
 * filter, never blocks a save, so a false match costs a glance, a missed one a
 * second application to the same place.
 */
import type { Job } from '../api'

// Legal forms and filler that say nothing about *which* company it is.
const NOISE = new Set([
  'gmbh', 'mbh', 'ag', 'se', 'kg', 'kgaa', 'ohg', 'gbr', 'ug', 'haftungsbeschraenkt', 'ev', 'eg',
  'co', 'cokg', 'und', 'and', 'the', 'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'plc',
  'corp', 'corporation', 'company', 'sa', 'sas', 'sarl', 'bv', 'nv', 'ab', 'oy', 'spa', 'srl', 'as',
  'holding', 'holdings', 'group', 'gruppe', 'deutschland', 'germany', 'europe', 'dach', 'international',
])

// Words too common to identify a company on their own: "Deutsche" mustn't pull
// "Deutsche Bank" and "Deutsche Bahn" together.
const GENERIC = new Set([
  'deutsche', 'german', 'bank', 'digital', 'solutions', 'services', 'service', 'technologies',
  'technology', 'tech', 'software', 'systems', 'consulting', 'media', 'health', 'energy', 'capital',
  'partners', 'labs', 'studio', 'data', 'cloud', 'it', 'net', 'online', 'global', 'management',
  'engineering', 'industries', 'versicherung', 'stadtwerke', 'sparkasse', 'volksbank', 'agentur',
])

const MIN_CONTAINED = 4 // "Bosch" inside "Robert Bosch", but not "SAP" inside "SAP Fioneer"

/** Lower-case word list with umlauts spelled out, punctuation and legal forms dropped. */
function tokens(name: string): string[] {
  const plain = name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ') // "SAP (Germany)", "(formerly X)"
    .replace(/\be\.\s*v\./g, 'ev')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const all = plain ? plain.split(' ') : []
  const kept = all.filter(t => !NOISE.has(t))
  return kept.length ? kept : all
}

/** The normalised form two spellings of one company share, e.g. "robert bosch". */
export function companyKey(name: string | null | undefined): string {
  return name ? tokens(name).join(' ') : ''
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Whether `short`'s words appear, in order and contiguously, inside `long`'s. */
function containsRun(long: string[], short: string[]): boolean {
  for (let i = 0; i + short.length <= long.length; i++) {
    if (short.every((t, k) => long[i + k] === t)) return true
  }
  return false
}

/** Same employer, probably. Compares normalised keys (see companyKey). */
export function sameCompanyKey(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const ca = a.replace(/ /g, '')
  const cb = b.replace(/ /g, '')
  if (ca === cb) return true // "Delivery Hero" / "DeliveryHero"

  const ta = a.split(' ')
  const tb = b.split(' ')

  // A typo in one word: one slip in a short word, two in a long one. Per word,
  // and only in words of 5+ letters, so "Deutsche Bank" stays apart from "Deutsche Bahn".
  if (ta.length === tb.length) {
    const differing = ta.flatMap((t, i) => (t === tb[i] ? [] : [[t, tb[i]]]))
    if (differing.length === 1) {
      const [x, y] = differing[0]
      const shortest = Math.min(x.length, y.length)
      const max = shortest >= 9 ? 2 : 1
      if (shortest >= 5 && editDistance(x, y, max) <= max) return true
    }
  }

  // One name is a part of the other: "Bosch" / "Robert Bosch", "Zalando" / "Zalando SE Payments"
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (short.length === long.length) return false
  if (short.join('').length < MIN_CONTAINED) return false
  if (short.every(t => GENERIC.has(t))) return false
  return containsRun(long, short)
}

export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  return sameCompanyKey(companyKey(a), companyKey(b))
}

export interface CompanyGroup {
  id: number
  /** The spelling used most often in the group: what the filter shows */
  name: string
  /** Every spelling in the group, `name` first */
  variants: string[]
  jobs: Job[]
}

export interface CompanyIndex {
  groups: CompanyGroup[]
  /** Group of each spelling, as typed on a job */
  byName: Map<string, CompanyGroup>
}

/**
 * Groups jobs whose company names match (transitively: "Bosch" links "Robert
 * Bosch" and "Bosch Rexroth"). Quadratic in distinct spellings, which stays in
 * the hundreds even for a busy board.
 */
export function indexCompanies(jobs: Job[]): CompanyIndex {
  const names = [...new Set(jobs.map(j => j.company?.trim()).filter((c): c is string => Boolean(c)))]
  const keys = names.map(companyKey)
  const parent = names.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (find(i) !== find(j) && sameCompanyKey(keys[i], keys[j])) parent[find(j)] = find(i)
    }
  }

  const byRoot = new Map<number, CompanyGroup>()
  const byName = new Map<string, CompanyGroup>()
  names.forEach((name, i) => {
    const root = find(i)
    let group = byRoot.get(root)
    if (!group) {
      group = { id: root, name, variants: [], jobs: [] }
      byRoot.set(root, group)
    }
    group.variants.push(name)
    byName.set(name, group)
  })
  for (const job of jobs) {
    const name = job.company?.trim()
    if (name) byName.get(name)!.jobs.push(job)
  }
  for (const group of byRoot.values()) {
    group.variants.sort(bySpellingPreference(group.jobs))
    group.name = group.variants[0]
  }

  const groups = [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { groups, byName }
}

/** Jobs at the same company as `name` (as typed in a form), excluding `exceptId`. */
export function jobsAtCompany(name: string, jobs: Job[], exceptId?: number): Job[] {
  const key = companyKey(name)
  if (key.replace(/ /g, '').length < 2) return []
  return jobs.filter(j => j.id !== exceptId && sameCompanyKey(key, companyKey(j.company)))
}

/**
 * Orders spellings best first: the one used most, then on a tie the one that
 * looks like a proper name ("Siemens AG" over "siemens"), then the fuller one.
 */
function bySpellingPreference(jobs: Job[]) {
  const counts = new Map<string, number>()
  for (const j of jobs) {
    const c = j.company?.trim()
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const capitalised = (v: string) => (v !== v.toLowerCase() ? 1 : 0)
  return (a: string, b: string) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
    || capitalised(b) - capitalised(a)
    || b.length - a.length
    || a.localeCompare(b)
}

/** The spelling to keep among `jobs`' companies (see bySpellingPreference). */
export function usualSpelling(jobs: Job[]): string | null {
  const names = [...new Set(jobs.map(j => j.company?.trim()).filter((c): c is string => Boolean(c)))]
  return names.sort(bySpellingPreference(jobs))[0] ?? null
}
