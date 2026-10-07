import { useState, useMemo } from 'react'
import KanbanBoard, { COLUMNS } from './components/KanbanBoard'
import AddJobModal from './components/AddJobModal'
import CompanyFilter from './components/CompanyFilter'
import ExportMenu from './components/ExportMenu'
import LoginPage from './components/LoginPage'
import ExtensionLogin from './components/ExtensionLogin'
import AccountModal from './components/AccountModal'
import LegalLinks from './components/LegalLinks'
import PricingPage from './components/PricingPage'
import UpgradeFlow from './components/UpgradeFlow'
import {
  ApiError, useAuthStatus, useBilling, useLogout, usePlans, useUnauthorized,
  useJobs, useCreateJob, useUpdateJob, useDeleteJob, webAppUrl,
} from './api'
import styles from './App.module.css'

const ACTIVE_STATUSES = ['to_be_applied', 'applied', 'in_interview']
const PRICE_IDS = ['monthly', 'quarterly']

/**
 * Links into the pricing flow (there's no router):
 *   ?pricing             the pricing page, also before signing in
 *   ?upgrade=1           the pricing page once signed in (the extension sends people here)
 *   ?upgrade=<price id>  straight to that plan's review step
 */
function routeFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const upgrade = params.get('upgrade')
  return {
    pricing: params.has('pricing') || upgrade !== null,
    publicPricing: params.has('pricing'),
    price: PRICE_IDS.includes(upgrade) ? upgrade : null,
  }
}

function clearUrl() {
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
}

/**
 * authMode is 'session' for the web app (LoginPage) and 'token' for the
 * extension (ExtensionLogin). onSignIn/onSignOut let the extension persist and
 * clear the bearer token; the web app needs neither.
 */
export default function App({ authMode = 'session', onSignIn, onSignOut }) {
  const authStatus = useAuthStatus()
  // Set once the user logs in or out in this tab; until then the server's status decides
  const [session, setSession] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [companyFilters, setCompanyFilters] = useState([])
  const [route] = useState(routeFromUrl)
  const [showAccount, setShowAccount] = useState(false)
  // 'board' | 'pricing' once signed in; publicPricing is the signed-out version
  const [view, setView] = useState(route.pricing ? 'pricing' : 'board')
  const [publicPricing, setPublicPricing] = useState(route.publicPricing)
  // { price } while the upgrade stepper is open
  const [upgrade, setUpgrade] = useState(route.price ? { price: route.price } : null)
  const [notice, setNotice] = useState('')
  // Columns start open: a board that opens looking empty reads as lost data
  const [collapsedCols, setCollapsedCols] = useState(
    () => Object.fromEntries(COLUMNS.map(c => [c.id, false]))
  )

  // status: 'checking' | 'login' | 'authenticated'
  const auth = session ?? (
    authStatus.loading ? { status: 'checking', username: null }
      : authStatus.data?.authenticated ? { status: 'authenticated', username: authStatus.data.username }
      : { status: 'login', username: null }
  )

  const { jobs, setJobs, loading } = useJobs(auth.status === 'authenticated')
  const { billing, reload: reloadBilling } = useBilling(auth.status === 'authenticated')
  const plans = usePlans()
  const { logout } = useLogout()
  const { createJob } = useCreateJob()
  const { updateJob } = useUpdateJob()
  const { deleteJob } = useDeleteJob()

  const companies = useMemo(
    () => [...new Set(jobs.map(j => j.company).filter(Boolean))].sort(),
    [jobs]
  )

  // Counted here rather than re-fetched, so the plan chip follows every move at once.
  // Same rule as backend/billing/plans.py.
  const plan = billing && {
    ...billing,
    active_jobs: jobs.filter(j => ACTIVE_STATUSES.includes(j.status)).length,
  }

  const visibleJobs = companyFilters.length === 0
    ? jobs
    : jobs.filter(j => companyFilters.includes(j.company))

  const signOut = () => {
    setShowModal(false)
    setEditingJob(null)
    setShowAccount(false)
    setUpgrade(null)
    setView('board')
    setNotice('')
    setCompanyFilters([])
    setSession({ status: 'login', username: null })
    onSignOut?.()
  }

  useUnauthorized(signOut)

  const showPlans = () => {
    setShowModal(false)
    setShowAccount(false)
    setNotice('')
    setView('pricing')
  }

  const backToBoard = () => {
    setView('board')
    clearUrl()
  }

  // Extension pages can't load Paddle.js, so the checkout runs on the website
  const choosePlan = (price) => {
    if (authMode === 'token') {
      window.open(webAppUrl(`/?upgrade=${price}`), '_blank', 'noopener')
    } else {
      setUpgrade({ price })
    }
  }

  const handleLogout = async () => {
    await logout().catch(() => {})
    signOut()
  }

  const addJob = async (formData) => {
    const job = await createJob(formData)
    setJobs(prev => [job, ...prev])
    setCollapsedCols(prev => ({ ...prev, to_be_applied: false }))
    setShowModal(false)
  }

  const moveJob = async (jobId, newStatus) => {
    try {
      const updated = await updateJob(jobId, { status: newStatus })
      setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
    } catch (err) {
      // expired sessions are handled by useUnauthorized
      if (err instanceof ApiError && err.code === 'plan_limit') setNotice(err.message)
    }
  }

  const saveJob = async (jobId, formData) => {
    const updated = await updateJob(jobId, formData)
    setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
    setEditingJob(null)
  }

  const nonEmptyCols = COLUMNS.filter(col => visibleJobs.some(j => j.status === col.id))
  const allExpanded = nonEmptyCols.every(col => collapsedCols[col.id] === false)
  const toggleAllColumns = () => {
    setCollapsedCols(Object.fromEntries(COLUMNS.map(c => [c.id, allExpanded])))
  }

  const removeJob = async (jobId) => {
    try {
      await deleteJob(jobId)
      setJobs(prev => prev.filter(j => j.id !== jobId))
    } catch {
      // expired sessions are handled by useUnauthorized
    }
  }

  if (auth.status === 'checking') {
    return (
      <div className={styles.app}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </div>
    )
  }

  if (auth.status !== 'authenticated') {
    if (publicPricing) {
      return (
        <PricingPage
          plans={plans}
          billing={null}
          backLabel="Log in"
          onBack={() => { setPublicPricing(false); clearUrl() }}
          onSignUp={() => {
            // LoginPage opens on sign-up when the URL says so
            window.history.replaceState(null, '', `${window.location.pathname}?mode=signup`)
            setPublicPricing(false)
          }}
        />
      )
    }
    const signedIn = (username, grant) => {
      // Drop ?mode=signup|forgot from an email link, so logging out shows the
      // login form. An upgrade link keeps working: the route was read on load.
      clearUrl()
      onSignIn?.(username, grant)
      setSession({ status: 'authenticated', username })
      if (publicPricing || route.pricing) setView('pricing')
    }
    if (authMode === 'token') return <ExtensionLogin onAuthenticated={signedIn} />
    return (
      <LoginPage
        onShowPlans={plans?.enabled ? () => setPublicPricing(true) : undefined}
        onAuthenticated={signedIn}
      />
    )
  }

  const modals = (
    <>
      {showAccount && (
        <AccountModal
          username={auth.username}
          billing={plan}
          onShowPlans={showPlans}
          onClose={() => setShowAccount(false)}
          onDeleted={signOut}
        />
      )}
      {upgrade && (
        <UpgradeFlow
          prices={plans?.prices?.length ? plans.prices : billing?.prices || []}
          initialPrice={upgrade.price}
          billing={plan}
          reloadBilling={reloadBilling}
          onClose={() => { setUpgrade(null); clearUrl() }}
          onDone={() => { setUpgrade(null); backToBoard() }}
        />
      )}
    </>
  )

  if (view === 'pricing') {
    return (
      <>
        <PricingPage
          plans={plans}
          billing={plan}
          backLabel="Back to board"
          onBack={backToBoard}
          onChoose={choosePlan}
          onManage={() => setShowAccount(true)}
        />
        {modals}
      </>
    )
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <span className={styles.brandIcon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              </svg>
            </span>
            <span className={styles.brandName}>Job Tracker</span>
            <span className={styles.crumbSep} aria-hidden="true">/</span>
            <h1 className={styles.boardTitle}>{auth.username}&rsquo;s board</h1>
          </div>
          <div className={styles.headerActions}>
            {plan?.enabled && (
              plan.plan === 'pro' ? (
                <button className={styles.planChipPro} onClick={() => setShowAccount(true)} title="Pro plan">
                  Pro
                </button>
              ) : (
                <button
                  className={styles.planChip}
                  onClick={showPlans}
                  title="Active applications on the free plan. See plans"
                >
                  <span className={styles.planMeter} aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (plan.active_jobs / plan.active_limit) * 100)}%` }} />
                  </span>
                  {plan.active_jobs}/{plan.active_limit} active
                </button>
              )
            )}
            <button className={styles.headerBtn} onClick={() => setShowAccount(true)} title="Account" aria-label="Account">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              <span className={styles.headerBtnLabel}>Account</span>
            </button>
            <button className={styles.headerBtn} onClick={handleLogout} title="Log out" aria-label="Log out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className={styles.headerBtnLabel}>Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {notice && (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <div className={styles.noticeActions}>
              {billing?.enabled && (
                <button className={styles.noticeBtn} onClick={showPlans}>
                  See plans
                </button>
              )}
              <button className={styles.noticeClose} onClick={() => setNotice('')} aria-label="Dismiss">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading jobs…</span>
          </div>
        ) : (
          <>
            <div className={styles.filterRow}>
              <CompanyFilter
                companies={companies}
                filters={companyFilters}
                onFiltersChange={setCompanyFilters}
              />
              <div className={styles.filterActions}>
                {nonEmptyCols.length > 0 && companyFilters.length === 0 && (
                  <button className={styles.toolbarBtn} onClick={toggleAllColumns}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {allExpanded
                        ? <><polyline points="7 20 12 15 17 20" /><polyline points="7 4 12 9 17 4" /></>
                        : <><polyline points="7 15 12 20 17 15" /><polyline points="7 9 12 4 17 9" /></>}
                    </svg>
                    {allExpanded ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
                <ExportMenu jobs={visibleJobs} boardTitle={`${auth.username}'s Job Board`} />
                <button className={styles.addBtn} onClick={() => setShowModal(true)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add job
                </button>
              </div>
            </div>
            <KanbanBoard
              jobs={visibleJobs}
              onMove={moveJob}
              onDelete={removeJob}
              onEdit={setEditingJob}
              forceExpanded={companyFilters.length > 0}
              collapsedCols={collapsedCols}
              setCollapsedCols={setCollapsedCols}
            />
          </>
        )}
      </main>

      <footer className={styles.footer}>
        <LegalLinks />
      </footer>

      {showModal && (
        <AddJobModal
          onClose={() => setShowModal(false)}
          onAdd={addJob}
          onUpgrade={billing?.enabled ? showPlans : undefined}
        />
      )}
      {modals}
      {editingJob && (
        <AddJobModal
          job={editingJob}
          onClose={() => setEditingJob(null)}
          onSave={saveJob}
        />
      )}
    </div>
  )
}
