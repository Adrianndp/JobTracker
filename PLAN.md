# Job Tracker → public multi-user app with subscriptions

## Context

The app is Django 5.2 + React 18 + Postgres, with a Chrome extension. It was built for **one person**:

- `accounts.User` is a hand-rolled model (`password_hash`, `created_at`, its own session keys) and
  `django.contrib.auth` is **not installed**, so nothing in the Django ecosystem (allauth, admin,
  `login()`, permissions) can plug into it.
- Sign-up closes after the first account (`SignupView`, `SIGNUP_CLOSED`); the login throttle and
  the UI copy ("This is the only account for this tracker") assume one user.
- No email verification, no self-service password reset (`manage.py reset_password` needs a shell),
  no MFA, no social login, no account deletion.
- Sessions are signed cookies, so a session can't be revoked server-side ("sign out everywhere").

Current data: **1 user (`Adrian`, id 1), 76 jobs, 2 extension tokens**. The password is already
Django `pbkdf2_sha256`, so the Werkzeug compatibility code is dead. **The account has no email**,
which matters once email becomes the login identifier (see Phase 1.4).

Jobs are already scoped per user (`Job.user` FK, every query filters on it). Multi-tenancy
is done; this plan is about **identity** and **billing**.

### Decisions

- **Django's built-in auth plus [django-allauth](https://docs.allauth.org/) in headless mode**, not a
  hosted provider (Clerk/Auth0). Users stay in our Postgres, no per-user fees, no second system to
  sync with Stripe. allauth's headless mode serves JSON endpoints built for SPAs, so the React app
  keeps its own UI.
- **Log in with email**; `username` stays as a display name ("Adrian's Job Board").
- **Keep the extension's `ApiToken`** (device list, revoke, 90-day expiry already work). Only how
  a token is *issued* changes.
- **Stripe Checkout + Customer Portal + webhooks with the `stripe` SDK**, hand-rolled (~200 lines)
  rather than dj-stripe: we need one customer id and one subscription status, not a mirror of
  Stripe's schema.

### Answers (2026-09-24)

1. Account 1's email: **adrianndp@hotmail.com** (Phase 1.4).
2. **Free = 5 jobs**; everything beyond that is paid (Phase 4).
3. Email provider: **Resend** (Phase 2).
4. Google sign-in: **later**, not at launch (Phase 3).

### Answers (2026-10-01) -- replace earlier ones where they differ

5. Payment provider: **Paddle** (merchant of record), not Stripe. Phase 4 was built on it.
6. Free tier: **30 active applications** (To Be Applied / Applied / In Interview); finished
   columns don't count. Replaces "Free = 5 jobs".
7. Price: €7/month and €19 per 3 months, both recurring Paddle prices.

---

## Phase 0 — Groundwork ✅ done 2026-09-24

1. `requirements.txt`: add `django-allauth[mfa]` (pinned). `[socialaccount]` is only added in Phase 3.
2. **Back up** before any migration:
   `pg_dump -h localhost -U postgres localdb > backup-pre-auth.sql`.
3. **Redis** as the cache (`django.core.cache.backends.redis.RedisCache`, `REDIS_URL` env, a `redis`
   service in docker-compose). allauth's rate limits and ours use the cache; the DB cache's `incr`
   isn't atomic across workers (the README says so), which matters once strangers can hit login.
   Dev can keep the DB cache if `REDIS_URL` is unset.

## Phase 1 — Switch to Django's built-in accounts (the risky part; do it first) ✅ done 2026-09-24

> Done as two migrations: `0003` (hand-written renames) and `0004` (generated). Tested on a restored
> copy first, then applied to `localdb`. Backup: `backups/localdb-pre-auth.sql`. Email set and verified
> via a one-off shell, not a migration, so no personal data is committed. Deviations: `email` stays
> nullable until Phase 2 makes it required at sign-up; the 2 old extension tokens were left to expire
> (sign in once again). Login accepts username *or* email until Phase 2.

The good news: `AUTH_USER_MODEL = 'accounts.User'` names the **same model that already exists**,
and `contrib.auth` has never been migrated in this database. So this isn't the notoriously painful
"swap the user model mid-project"; it's "add fields to the existing model and point Django at it."
`auth`'s first migration depends on `accounts`' first migration, which is already applied.

### 1.1 Model: `backend/accounts/models.py`

- `class User(AbstractUser)`, keeping `db_table = 'user'` (so `Job.user` / `ApiToken.user` FKs
  and their data are untouched).
- `password_hash` → Django's `password` field. `created_at` → `date_joined`.
- `email = models.EmailField(unique=True, null=True)` for now; made non-null in 1.4.
- Delete `check_werkzeug_password`, `set_password`/`check_password` overrides, `session_version()`.
- `utcnow()` stays (jobs use it).

### 1.2 Migration `accounts/0003_abstractuser.py` (written by hand, reviewed line by line)

- `RenameField` `password_hash`→`password`, `created_at`→`date_joined`.
- `AddField`: `first_name`, `last_name`, `is_staff`, `is_superuser`, `is_active` (default True),
  `last_login`, `groups`, `user_permissions` (depends on `('auth', '0012_…')`).
- Check with `makemigrations --check` afterwards: no leftover diff.
- **Test on a copy first:** `createdb localdb_copy && pg_dump localdb | psql localdb_copy`, run
  `migrate`, sign in as Adrian, count jobs = 76.

### 1.3 Settings, sessions, middleware

- `INSTALLED_APPS`: `django.contrib.contenttypes`, `django.contrib.auth`, `django.contrib.sessions`,
  `allauth`, `allauth.account`, `allauth.headless`, `allauth.mfa`, then `accounts`, `jobs`.
- `AUTH_USER_MODEL = 'accounts.User'`.
- `SESSION_ENGINE` → `cached_db` (server-side, so sessions can be revoked). **One-time effect:
  everyone signs in again**, including the web session; extension tokens keep working.
- Middleware: add `AuthenticationMiddleware` after sessions and `allauth.account.middleware.AccountMiddleware`.
- `accounts/auth.py`: `current_user()` → bearer token first (unchanged), else `request.user` if
  authenticated. `start_session()` → `django.contrib.auth.login()`. The custom
  `session['user_id']`/`session_version` pair is removed; Django already invalidates sessions on
  password change via `get_session_auth_hash()`.
- `ApiToken.session_version`: snapshot `user.get_session_auth_hash()` instead, so a password change
  still revokes every token. Existing 2 tokens: migrate them by recomputing in a data migration
  (or accept that the extension signs in once more; simpler, and it's 2 tokens you own).

### 1.4 Email for the existing account

- Data migration or `manage.py shell`: set account 1's email and create the allauth
  `EmailAddress(primary=True, verified=True)` row. Email: adrianndp@hotmail.com.
- Then `email` → `NOT NULL` (a later migration).

### 1.5 Tests

Existing `accounts/tests.py` is rewritten where it encodes single-account behaviour
(`test_signup_closes_after_the_first_account`, `setup_required`). Everything about tokens, CSRF,
bearer-vs-cookie and job scoping must still pass **unchanged in intent**. Add: user A can't
see/patch/delete user B's jobs through session *or* token (exists in `jobs/tests.py`; keep it green).

**Exit criteria:** you sign in with email + password, see 76 jobs; extension still works; all
tests pass on Postgres.

## Phase 2 — Open sign-up with allauth headless — core done 2026-09-24

> Done: allauth headless at `/api/_allauth/`, open sign-up, email login, verification and
> password reset **by emailed code** (no SPA routes or router needed — a change from 2.2),
> Resend SMTP via `RESEND_API_KEY`, old single-account code deleted (`SignupView`, `LoginView`,
> `setup_required`, `reset_password` command), `email` now required, extension signs in with
> email and must be verified. `allauth.mfa` was removed again until Phase 3 (its tables unapplied).
> Checked end to end in Chrome against Postgres.
> **Still open:** a Resend key + verified sending domain for real mail.
> Done 2026-10-01: account deletion (`DELETE /api/auth/account`, password re-check, cancels a
> live subscription first), 5,000-job cap and 60 creates/minute per user (2.3).

### 2.1 Backend

- Mount `allauth.headless.urls` at **`/api/_allauth/`**. It rides the existing `/api` proxy in
  nginx and Vite, and `api_guard` treats the prefix as public.
- Settings:
  - `ACCOUNT_LOGIN_METHODS = {'email'}`, `ACCOUNT_SIGNUP_FIELDS = ['email*', 'username*', 'password1*']`
  - `ACCOUNT_EMAIL_VERIFICATION = 'mandatory'` (no board until the email is confirmed)
  - `ACCOUNT_LOGIN_BY_CODE_ENABLED` optional (passwordless email codes)
  - `HEADLESS_ONLY = True`, `HEADLESS_FRONTEND_URLS` → our SPA routes for verify/reset links
  - `ACCOUNT_RATE_LIMITS` (allauth's defaults are sane; tune signup per IP)
  - Existing `AUTH_PASSWORD_VALIDATORS` keep applying.
- Email: `EMAIL_BACKEND` = console in dev, Resend's SMTP (`smtp.resend.com`, API key as password) in prod via env
  vars; `DEFAULT_FROM_EMAIL`.
- **Delete** `SignupView`, `LoginView`, `StatusView`'s `setup_required`, `SIGNUP_CLOSED`,
  `accounts/ratelimit.py`'s login buckets (allauth rate-limits login), `reset_password` command
  (self-service reset replaces it; `createsuperuser`/`changepassword` exist for emergencies).
- **Keep** `LogoutView` for bearer revocation, `TokenListView`, `TokenDetailView`.
- `TokenView` (extension sign-in): authenticate via `django.contrib.auth.authenticate(email=…)`,
  **refuse unverified emails**, keep its own throttle (`ratelimit.py` survives just for this).
  See Phase 3.2 for MFA.
- **Account deletion** endpoint (`DELETE /api/auth/account`, password re-check). Cascades to jobs and
  tokens. Required for GDPR and app-store-style expectations.

### 2.2 Frontend

- No router exists today. Add `react-router-dom` (small) for: `/login`, `/signup`,
  `/verify-email/:key`, `/password/reset`, `/password/reset/:key`, `/` (board).
- `api.ts`: auth calls move to allauth's headless browser endpoints
  (`/api/_allauth/browser/v1/auth/{login,signup,session,email/verify,password/request,password/reset}`).
  CSRF handling stays the same (allauth uses Django's `csrftoken` cookie).
- `LoginPage.jsx`: email instead of username; sign-up copy drops "only account"; "Forgot password?"
  link; "Check your inbox" state after sign-up.
- Extension `SavePanel`/`LoginPage` token mode: email instead of username.

### 2.3 Hardening for strangers

- Per-user limits so one account can't fill the DB: cap jobs per user (say 5,000) and request
  rate on `POST /api/jobs`.
- Bot protection on sign-up: allauth rate limits first; add Cloudflare Turnstile only if sign-up
  spam actually shows up.

**Exit criteria:** a new person signs up, gets an email, verifies, sees an empty board; can
reset a forgotten password; can delete their account. Your account is unaffected.

## Phase 3 — MFA and social login (optional for launch)

### 3.1 MFA

`allauth.mfa` gives TOTP + recovery codes via the same headless API. Frontend: settings page to
enroll (QR code), and a code step in the login flow.

### 3.2 Extension sign-in with MFA

Once MFA exists, `TokenView` (email + password → token) **bypasses the second factor**. Fix
before enabling MFA: replace it with a hand-off. The extension opens the web app at
`/connect-extension?nonce=…`, the signed-in user confirms, the backend issues the token, and the
extension collects it once by nonce. Nobody ever types a password into the extension, and MFA is
covered by the web login.

### 3.3 Google sign-in

`allauth.socialaccount.providers.google`; headless "provider redirect" flow. CSP currently has
`form-action 'none'`; it must allow `'self'` for the redirect form post (both in
`config/security.py` and `frontend/nginx.conf`).

## Phase 4 — Subscriptions ✅ code done 2026-10-01, with Paddle instead of Stripe

> Built against **Paddle Billing** (decision 5), hand-rolled over the stdlib like the Stripe
> plan below: `billing` app with `BillingAccount` (`paddle_customer_id`, `subscription_id`,
> `status`, …, plus `complimentary`) and `PaddleEvent` for idempotency; `/api/billing/status`,
> `checkout` (creates a transaction; Paddle.js overlay opens it), `portal` (customer portal
> session), `webhook` (HMAC on the raw body, re-fetches the subscription). `custom_data`
> carries a signed user id so a forged checkout can't attach to someone else's account.
> `plan_for` implements decision 6; `past_due` keeps Pro for 14 days. Frontend: Account dialog
> (plan, usage meter, upgrade, manage billing, delete account), plan chip in the header, 402
> banner. 37 new backend tests.
> Then (same day): public pricing page, a 4-step upgrade dialog (plan → review with Paddle's
> localised VAT preview → pay → done), and *Plan & billing* in Account (status, next payment,
> card, invoices) read live from Paddle. 9 more tests.
> **Still open (needs your Paddle account):** sandbox product/prices, keys, default payment
> link + domain approval, webhook destination; then one real sandbox purchase end to end.
> The CSP now allows `cdn.paddle.com` and `*.paddle.com` frames -- confirm nothing is blocked
> in that sandbox run. Sections 4.1–4.5 below are the original Stripe design, kept for reference.

### 4.1 Model: new `billing` app

```
BillingAccount
  user                  OneToOne → accounts.User
  stripe_customer_id    unique
  subscription_id       nullable
  status                'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | …
  price_id              which plan
  current_period_end    datetime
  cancel_at_period_end  bool
StripeEvent
  event_id              unique, for idempotency
  processed_at
```

Separate from `User` so billing can't disturb the auth tables.

### 4.2 Endpoints

- `POST /api/billing/checkout` → creates a Checkout Session (mode=subscription,
  `client_reference_id=user.id`, customer reused if one exists) and returns its URL.
- `POST /api/billing/portal` → Customer Portal session URL (cancel, change card, invoices).
- `GET  /api/billing/status` → plan + status for the UI.
- `POST /api/billing/webhook` → **public, csrf-exempt, signature-verified on the raw body**
  (`stripe.Webhook.construct_event` with `STRIPE_WEBHOOK_SECRET`). Handles
  `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
  `invoice.payment_failed`. Stores `event.id` first; duplicates are no-ops. On subscription events,
  re-fetch the subscription from Stripe rather than trusting event order.
- `api_guard`: webhook path is public; it's `application/json` already, so the JSON-only
  check passes.

### 4.3 Entitlements

One function, `billing.plan_for(user) -> Plan`, used by the views (e.g. the job cap on
`POST /api/jobs`, export). Free plan: 5 jobs total; paid: unlimited. Existing jobs over the cap are never deleted -- only new ones are blocked. Grace period: treat `past_due`
as active for N days.

### 4.4 Frontend

"Upgrade" button → checkout URL; "Manage billing" → portal URL; plan badge; a friendly 402 when
a free limit is hit.

### 4.5 Testing

Stripe test mode + `stripe listen --forward-to localhost:5001/api/billing/webhook`. Unit tests with
recorded event payloads: idempotency, out-of-order events, signature failure → 400.

Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID(S)`.

## Phase 5 — Launch checklist

> Done 2026-10-01: `npm run build:ext:store` (needs `VITE_API_BASE=https://…`; fixed host,
> no `key`, no optional hosts), optional Sentry (`SENTRY_DSN`), `WEB_CONCURRENCY` for gunicorn,
> `scripts/backup-db.sh` with restore steps. Still yours: hosting, domain, Sentry project,
> uptime monitor, cron for the backup, real env values.

- Privacy policy + terms (required by Stripe and Google sign-in). For a German audience that
  means **Impressum**, **Datenschutzerklärung** and **AGB**, plus data processing agreements (AVV)
  with the host, Resend and the payment provider. See Phase 6.2.
- **Production extension build:** the API host defaults to `localhost:5001` and `host_permissions`
  lists it; both must point at the real domain before publishing. Drop
  `optional_host_permissions: https://*/*` unless a self-hosted API host is a real use case -- it
  draws extra Chrome Web Store review.
- Error tracking (Sentry) and uptime check on `/api/health`.
- Daily `pg_dump` off the server, plus one test restore.
- `HTTPS=1`, real `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`; publish the extension so its ID is fixed.
- Gunicorn workers sized to CPU; Postgres connection count stays under `max_connections`
  (`CONN_MAX_AGE` is already 60 s).

## Phase 6 — Go to market (added 2026-10-01)

The tracker plus one-click save is a crowded category with strong free options (Teal, Huntr,
Simplify, Notion templates, spreadsheets). As it stands it would earn close to nothing per user.
What can sell is a tracker **built for German-speaking job seekers**: the boards they use, German UI,
EU hosting.

### 6.1 Decisions to revisit before Phase 4

- **Free tier.** "Free = 5 jobs" (Answers, 2026-09-24) is too tight to evaluate the product --
  people apply to 20–100 jobs, and competitors' free tiers are much larger. Proposal: free up to
  **~30 active applications** on LinkedIn and XING; Pro unlocks unlimited applications, all boards,
  reminders and stats. Only `billing.plan_for` (4.3) changes.
- **Price.** Proposal: **€7/month or €19 for 3 months**. Job seekers churn once hired (typically
  1–4 months), so sell passes or months, not years. Benchmarks to re-check before launch: Teal+
  ~$29/month, Huntr Pro ~$40/month -- both priced on AI résumé help, not tracking.
- **Payment provider.** Selling to EU consumers means EU VAT through the OSS scheme. A merchant of
  record (**Paddle** or **Lemon Squeezy**) collects and files VAT for you; plain Stripe leaves that to
  you (Stripe Tax helps but you remain the seller). Decide before writing Phase 4 -- the
  checkout / portal / webhook shape is similar, but the SDK and event names differ.

### 6.2 Legal (Germany / EU)

> Drafts in `frontend/public/legal/` (Impressum, Datenschutz, AGB), linked from the login page,
> sign-up and the board footer. Placeholders are highlighted; they need your details and a
> review. With Paddle as merchant of record, the withdrawal-right consent is Paddle's checkout's job.

- **Impressum** on the site, **Datenschutzerklärung**, **AGB**.
- **Withdrawal right (Widerrufsrecht):** EU consumers get 14 days to cancel. Checkout needs the
  explicit "start now, I lose my withdrawal right" consent, or refunds must be honoured.
- **AVV** (data processing agreements) with the host, Resend and the payment provider.
- **Account deletion** (Phase 2 open item) is a GDPR requirement, not a nice-to-have.
- **Job-board terms:** LinkedIn's User Agreement forbids tools that read its pages; Teal and Huntr
  do it openly, but the risk is ours. Keep the content scripts reading only what's on screen, only
  on a click, and never in bulk.

### 6.3 Chrome Web Store

- Developer account ($5), listing with screenshots of the LinkedIn / XING button and the board,
  privacy policy link, single-purpose statement and a justification per permission.
- The store assigns the published extension's ID and, as far as I know, rejects a manifest with a
  `key` field -- strip `key` from the store build (keep it for unpacked dev builds), then set
  production `CORS_ALLOWED_ORIGINS=chrome-extension://<store id>`.

### 6.4 Product: what makes it worth paying for (in order)

1. **German job boards** competitors cover poorly: StepStone, Indeed.de, Arbeitsagentur Jobbörse
   -- each one a content script plus a case in `jobBoards.js`, like XING.
   **StepStone done 2026-10-01** (`stepstone.js`, stepstone.de); Indeed.de and Jobbörse next.
2. **Follow-up reminders:** "no answer in 10 days -- follow up?", interview dates with a calendar
   (.ics) export.
3. **Per-application notes and timeline:** contacts, salary discussed, interview questions.
4. **Stats:** reply rate, which sources lead to interviews.
5. **Later:** AI-tailored Anschreiben per posting -- where the market's money is, but it carries a
   per-use cost and needs its own pricing.

### 6.5 Launch

- **UI polish ✅ done 2026-10-07:** design tokens (`frontend/src/styles/tokens.css`) and shared
  controls (`controls.module.css`, used through `composes`) for the web app and extension pages;
  light header, columns open by default, an "Expand/Collapse all" toolbar button instead of the
  hidden logo click, hover actions on cards, one modal/menu/button style everywhere. Rules for
  future UI work are in the `ui-ux-pro-max` skill. Open: content-script button
  (`trackerButton.js`) still has its own inline styles; no dark mode.
- Landing page with pricing, German and English.
- Support email address and a short FAQ.
- Positioning: "Made for the German job market, hosted in the EU, your data is never sold."

**Exit criteria:** a stranger finds the landing page, installs the extension from the Chrome Web
Store, saves jobs from LinkedIn / XING / StepStone, upgrades, pays VAT-correctly, and can cancel
or delete their account themselves.

## Order and size

| Phase | What | Rough size | Blocks |
|---|---|---|---|
| 0 | allauth dep, backup, Redis | small | — |
| 1 | built-in accounts | medium, careful | everything else |
| 2 | open sign-up | medium–large (mostly frontend) | Phase 1, email provider |
| 3 | MFA / Google | medium | Phase 2 |
| 4 | Stripe | medium | Phase 1 (not 2 or 3) |
| 5 | launch | small | all |
| 6 | go to market: legal, store listing, German boards, reminders | large (ongoing) | 6.1 before Phase 4; rest after Phase 5 |
