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
> **Still open:** account deletion endpoint, per-user job cap / write rate (2.3), a Resend
> key + verified sending domain for real mail.

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

## Phase 4 — Stripe subscriptions

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

- Privacy policy + terms (required by Stripe and Google sign-in).
- Error tracking (Sentry) and uptime check on `/api/health`.
- Daily `pg_dump` off the server, plus one test restore.
- `HTTPS=1`, real `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`; publish the extension so its ID is fixed.
- Gunicorn workers sized to CPU; Postgres connection count stays under `max_connections`
  (`CONN_MAX_AGE` is already 60 s).

## Order and size

| Phase | What | Rough size | Blocks |
|---|---|---|---|
| 0 | allauth dep, backup, Redis | small | — |
| 1 | built-in accounts | medium, careful | everything else |
| 2 | open sign-up | medium–large (mostly frontend) | Phase 1, email provider |
| 3 | MFA / Google | medium | Phase 2 |
| 4 | Stripe | medium | Phase 1 (not 2 or 3) |
| 5 | launch | small | all |
