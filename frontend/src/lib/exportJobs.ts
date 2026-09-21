/**
 * Export helpers for the board. Both formats are produced in the browser: the
 * board is small, and the server has no export endpoint to call.
 *
 * The PDF side deliberately avoids a PDF library. Printing a purpose-built HTML
 * report through a hidden iframe gets "Save as PDF" from the browser itself,
 * which keeps the extension bundle free of a ~400kB dependency and works the
 * same in the web app and the extension's board page.
 */

type ExportJob = {
  name: string
  company?: string | null
  link?: string | null
  salary?: string | null
  status?: string | null
  had_interview?: boolean | null
  applied_date?: string | null
  created_at?: string | null
}

type ExportColumn = {
  id: string
  label: string
  color: string
}

const HEADERS = [
  'Name', 'Company', 'Status', 'Salary', 'Link',
  'Applied Date', 'Had Interview', 'Created At',
]

const isoDate = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const longDate = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const statusLabel = (columns: ExportColumn[], status: string | null | undefined): string =>
  columns.find(c => c.id === status)?.label ?? (status || '')

/** Sorted the way the board reads: column order first, newest job first within a column. */
const sortForExport = (jobs: ExportJob[], columns: ExportColumn[]): ExportJob[] => {
  const rank = new Map(columns.map((c, i) => [c.id, i]))
  const order = (job: ExportJob) => rank.get(job.status ?? '') ?? columns.length
  return [...jobs].sort((a, b) => {
    const diff = order(a) - order(b)
    if (diff !== 0) return diff
    return (b.created_at || '').localeCompare(a.created_at || '')
  })
}

const stamp = (): string => new Date().toISOString().slice(0, 10)

/* ── CSV ─────────────────────────────────────────── */

/**
 * A cell opening with =, +, -, @ or a control character is run as a formula by
 * Excel and Sheets when the file is opened. Job names and links come from pages
 * we don't control, so the leading character is neutralised with a quote.
 */
const csvCell = (value: unknown): string => {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function jobsToCsv(jobs: ExportJob[], columns: ExportColumn[]): string {
  const rows = sortForExport(jobs, columns).map(job => [
    job.name,
    job.company || '',
    statusLabel(columns, job.status),
    job.salary || '',
    job.link || '',
    isoDate(job.applied_date),
    job.had_interview ? 'Yes' : 'No',
    isoDate(job.created_at),
  ])
  // CRLF and a BOM so Excel opens the file as UTF-8 rather than guessing
  return [HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
}

export function exportJobsCsv(jobs: ExportJob[], columns: ExportColumn[]): void {
  const blob = new Blob(['﻿', jobsToCsv(jobs, columns)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `job-tracker-${stamp()}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked late: Chrome needs the URL alive until the download has started
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/* ── PDF (via the browser's print dialog) ────────── */

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))

/** The printable report, exported on its own so it can be rendered and checked without printing. */
export function jobsReportHtml(jobs: ExportJob[], columns: ExportColumn[], boardTitle: string): string {
  const groups = columns
    .map(col => ({ col, jobs: jobs.filter(j => j.status === col.id) }))
    .filter(group => group.jobs.length > 0)

  const unknown = jobs.filter(j => !columns.some(c => c.id === j.status))
  if (unknown.length > 0) {
    groups.push({ col: { id: '', label: 'Other', color: '#64748b' }, jobs: unknown })
  }

  const sections = groups.map(({ col, jobs: groupJobs }) => `
    <section class="group">
      <h2 style="border-color:${col.color}">
        <span class="dot" style="background:${col.color}"></span>
        ${escapeHtml(col.label)}
        <span class="count">${groupJobs.length}</span>
      </h2>
      <table>
        <thead>
          <tr><th>Role</th><th>Company</th><th>Salary</th><th>Applied</th><th>Link</th></tr>
        </thead>
        <tbody>
          ${groupJobs.map(job => `
            <tr>
              <td class="role">${escapeHtml(job.name)}</td>
              <td>${escapeHtml(job.company || '—')}</td>
              <td>${escapeHtml(job.salary || '—')}</td>
              <td>${escapeHtml(longDate(job.applied_date) || '—')}</td>
              <td class="link">${escapeHtml(job.link || '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`).join('')

  const title = `${boardTitle} — ${stamp()}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    font-size: 10.5pt;
  }
  header { border-bottom: 2px solid #6366f1; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 16pt; margin: 0 0 4px; letter-spacing: -0.3px; }
  .meta { color: #64748b; font-size: 9pt; }
  .group { margin-bottom: 18px; page-break-inside: avoid; }
  h2 {
    display: flex; align-items: center; gap: 7px;
    font-size: 11pt; margin: 0 0 7px; padding-bottom: 5px;
    border-bottom: 1.5px solid;
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .count {
    margin-left: auto; color: #64748b; font-size: 9pt; font-weight: 600;
  }
  /* Fixed widths so every section's columns line up down the page */
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th:nth-child(1), td:nth-child(1) { width: 30%; }
  th:nth-child(2), td:nth-child(2) { width: 18%; }
  th:nth-child(3), td:nth-child(3) { width: 14%; }
  th:nth-child(4), td:nth-child(4) { width: 12%; }
  th:nth-child(5), td:nth-child(5) { width: 26%; }
  th {
    text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px;
    color: #64748b; padding: 4px 8px 4px 0; border-bottom: 1px solid #e2e8f0;
  }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .role { font-weight: 600; word-break: break-word; }
  .link { color: #475569; font-size: 8pt; word-break: break-all; }
  footer { margin-top: 20px; color: #94a3b8; font-size: 8pt; text-align: center; }
  .empty { color: #64748b; font-style: italic; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(boardTitle)}</h1>
    <div class="meta">
      ${jobs.length} job${jobs.length === 1 ? '' : 's'} ·
      Exported ${escapeHtml(longDate(new Date().toISOString()))}
    </div>
  </header>
  ${sections || '<p class="empty">No jobs to export.</p>'}
  <footer>Generated by Job Tracker</footer>
</body>
</html>`
}

/**
 * Renders the report into an off-screen iframe and opens the print dialog, so
 * the user picks "Save as PDF" (or a printer). The iframe is torn down after
 * printing; the timeout covers browsers that never fire afterprint.
 */
export function exportJobsPdf(
  jobs: ExportJob[],
  columns: ExportColumn[],
  boardTitle = 'Job Board',
): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  frame.srcdoc = jobsReportHtml(sortForExport(jobs, columns), columns, boardTitle)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    frame.remove()
  }

  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return remove()
    win.addEventListener('afterprint', () => setTimeout(remove, 0))
    win.focus()
    win.print()
    setTimeout(remove, 60_000)
  }

  document.body.appendChild(frame)
}
