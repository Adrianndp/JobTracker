# Job Tracker

A kanban-style job application tracker built with Django + React, plus a Chrome
extension that saves a posting from a job page in one click.

## Features
- 5-column kanban: To Be Applied → Applied → In Interview → Got Rejected / Got an Offer
- Drag cards between columns
- Add jobs via modal (title required, URL and salary optional)
- Delete cards with confirmation
- PostgreSQL database via the Django ORM
- Chrome extension: save the page you are on to your board, and view the full
  board in a tab
- One-click "Save to Job Tracker" button on LinkedIn, XING and StepStone job postings
- Free plan (30 active applications) and Pro via Paddle; account deletion



## Project structure

```
backend/
  manage.py         Django entry point (`runserver` defaults to port 5001)
  config/           settings (secret key, sessions, database), URL routes, health check, serves the built frontend
  accounts/
    models.py       User (Django's AbstractUser) + ApiToken for the extension
    middleware.py   API guard: JSON-only writes, login required (allauth's /api/_allauth/ is public)
    views.py        /api/auth/* (status, logout, extension tokens); sign-up/login live in allauth
    auth.py         resolves a request to a user (bearer token or session)
    tokens.py       issue/resolve/revoke API tokens for the extension
    ratelimit.py    cache-backed throttle for the extension's token endpoint
  jobs/
    models.py       Job (owned by a User) + valid statuses
    validators.py   link scheme + length validation
    views.py        /api/jobs CRUD, scoped to the signed-in user
    management/commands/seed.py
  billing/
    plans.py        plan_for(user): what Free and Pro allow (the only place that decides)
    paddle.py       the Paddle API calls and webhook signature check, over the stdlib
    subscriptions.py  keeps BillingAccount in step with Paddle
    views.py        /api/billing/{plans,status,preview,details,invoices/<id>,checkout,portal,webhook}
    management/commands/billing_comp.py
  config/
    cors.py         CORS allowlist for the extension origin
    security.py     CSP and friends for the HTML Django serves
frontend/src/
  App.jsx           auth gate, board state, API calls
  api.ts            fetch helper + hooks (shared with the extension)
  lib/              transport.ts (api base + auth scheme), safeUrl.ts, paddle.ts (checkout),
                    celebrate.ts (confetti when a job moves to "Got an Offer")
  styles/           tokens.css (colours, type, spacing, ...) and controls.module.css (shared
                    buttons, inputs, menus, modals), used by the web app and the extension pages
  components/       LoginPage (website sign-in flows), ExtensionLogin (the extension's token
                    sign-in), AuthCard (the frame both share), KanbanBoard, KanbanColumn,
                    JobCard, AddJobModal, CompanyFilter, ExportMenu, PricingPage, UpgradeFlow (plan → review → pay → done),
                    AccountModal (plan & billing, invoices, delete account), LegalLinks,
                    Logo (the app mark; icons elsewhere are lucide-react)
frontend/public/legal/  Impressum, Datenschutz, AGB (drafts with placeholders)
frontend/extension/
  public/           manifest.json, icons
  board.html        the full kanban, reusing App.jsx
  sidepanel.html    save-this-page panel
  src/background.js MV3 service worker: context menu and API calls
  src/linkedin.js   content script: "Save to Job Tracker" button on LinkedIn job pages
  src/xing.js       content script: the same button on XING job pages
  src/stepstone.js  content script: the same button on StepStone job pages
  src/trackerButton.js  the button and page watcher the content scripts share
scripts/backup-db.sh  nightly pg_dump for the docker-compose deployment
scripts/check.sh      migration check, backend tests and all builds, in one command
```

## Accounts

Anyone can sign up. Accounts are Django's built-in users, and
[django-allauth](https://docs.allauth.org/) (headless mode, mounted at `/api/_allauth/`)
handles sign-up, login, email verification and password reset for the web app.

- **Sign up:** email, username (shown on the board), and a password of at least 10 characters,
  checked against Django's common-password, all-numeric and similarity validators.
  The board opens once the email is confirmed with the code we send.
- **Log in:** email + password.
- **Forgot password:** "Forgot password?" on the login screen emails a code; enter it with a
  new password. This ends every existing session and extension token.
- **Codes, not links:** verification and reset emails contain a short code typed into the
  same screen, so the SPA needs no extra routes.
- **Email delivery:** with `RESEND_API_KEY` set, mail goes through Resend's SMTP from
  `DEFAULT_FROM_EMAIL` (an address on a domain you've verified in Resend). Without it, mail
  is printed to the backend's console, which is how you get codes in development.
- **Sessions** last 30 days and are stored server-side (`cached_db`), so they can be revoked.
  The signing key is generated once into `backend/instance/secret_key`; set `SECRET_KEY` to
  override it. Set `HTTPS=1` when you serve the app over HTTPS.
- **Rate limits:** allauth's for the web (5 failed logins per email per 5 minutes, 10 per
  minute per IP; limits on sign-up, codes and reset requests). The extension's token endpoint
  has its own: 5 failures per email *from the same client* per 15 minutes, 20 per address.
  Set `TRUSTED_PROXY_COUNT` to the number of proxies you run (docker-compose sets `1` for
  nginx); `X-Forwarded-For` is ignored entirely when it is `0`. Both use the cache, so run
  Redis (`REDIS_URL`) in production for atomic counters.
- **Admin tasks:** `python manage.py createsuperuser` and `changepassword <username>` are
  Django's own.
- **Deleting an account:** *Account* → *Delete account*, with the password re-checked
  (`DELETE /api/auth/account`). Jobs, devices and email addresses go with it; a live
  subscription is cancelled at Paddle first, and if that fails the account is kept.

## Plans and billing

[Paddle](https://www.paddle.com/) sells Pro as merchant of record: it runs the checkout,
charges VAT for the buyer's country, files it, and sends invoices. We store only which Paddle
customer and subscription belong to which user, and the subscription's status.

- **Free:** up to 30 *active* applications (To Be Applied, Applied, In Interview). Rejected,
  Offer and Ghosted don't count. Over the limit, adding a job (or moving one back into an
  active column) answers `402` with `code: "plan_limit"`; nothing is ever deleted.
  **Pro:** no limit. Every account also has a hard cap of 5,000 jobs and 60 new jobs a minute.
- **Billing is off** until `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` and a price are set, and
  with it off there are no plan limits (development, self-hosting).
- **Your own account:** `python manage.py billing_comp you@example.com` gives Pro without
  paying (`--off` takes it back).
- **Setting up Paddle (sandbox first, at sandbox-vendors.paddle.com):**
  1. Create a product with two recurring prices: €7 every month, €19 every 3 months. Put their
     `pri_…` ids in `PADDLE_PRICE_MONTHLY` / `PADDLE_PRICE_QUARTERLY` (labels on the buttons
     are in `backend/billing/plans.py`).
  2. *Developer tools → Authentication:* an API key (`PADDLE_API_KEY`) and a client-side token
     (`PADDLE_CLIENT_TOKEN`, `test_…` in sandbox).
  3. *Checkout settings:* set the default payment link to your site's URL and approve the
     domain (Paddle requires it before a checkout opens).
  4. *Notifications:* a destination `https://<your host>/api/billing/webhook` for the
     `subscription.*` and `transaction.completed` events; its secret key goes in
     `PADDLE_WEBHOOK_SECRET`. Locally, expose port 5001 with a tunnel (e.g. `ngrok http 5001`)
     and point a sandbox destination at it.
  5. When it all works, switch to `PADDLE_ENVIRONMENT=production` with live keys and prices.
- **Where it shows up:** the plan chip in the header ("28/30") and every limit message lead to
  the **pricing page** (Free vs Pro, monthly / 3-month switch, FAQ), also reachable signed out
  from the login screen or `/?pricing`. *Upgrade to Pro* opens a four-step dialog: choose the
  period, review (price with VAT for the buyer's country from Paddle's pricing preview,
  renewal date, how cancelling works), pay in Paddle's overlay, done. Pro users find
  *Account → Plan & billing*: status, next payment, card, invoice downloads, *Manage billing*.
  Links: `/?upgrade=1` opens the pricing page after sign-in, `/?upgrade=monthly` the review step.
- **How a purchase flows:** the stepper asks the backend for a Paddle transaction (signed with
  the user's id), Paddle.js opens the checkout over the page, and the webhook updates the
  account; the stepper polls until Pro shows up. Webhooks are verified on the raw body, run once
  per `event_id`, and re-fetch the subscription from Paddle so late or out-of-order events
  can't roll it back. Billing details and invoices are read live from Paddle when the account
  dialog opens. *Manage billing* opens Paddle's customer portal (cancel, card, invoices).
- **From the extension:** its pages can't load Paddle.js, so *Upgrade* there (and the job
  buttons' *Free limit reached · Upgrade*) opens the website at `/?upgrade=1`.
- **Legal pages:** `frontend/public/legal/` holds drafts of the Impressum, Datenschutzerklärung
  and AGB with highlighted placeholders. Fill them in and have them reviewed before launch.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DJANGO_DEBUG` | off | `1` enables debug. Fails closed: `manage.py runserver`/`test` set it for you, gunicorn never does. |
| `ALLOWED_HOSTS` | localhost (debug only) | Comma-separated hostnames. Required when debug is off. |
| `HTTPS` | `0` | `1` turns on SSL redirect, HSTS, and secure cookies. |
| `TRUSTED_PROXY_COUNT` | `0` | How many proxies are in front. Controls whether `X-Forwarded-For` is read. |
| `CORS_ALLOWED_ORIGINS` | empty | Comma-separated, e.g. `chrome-extension://<id>`. Needed for the extension. |
| `CSRF_TRUSTED_ORIGINS` | empty | Passed to Django as-is. |
| `SECRET_KEY` | generated | Written once to `backend/instance/secret_key`. |
| `DATABASE_URL` | required | `postgres://user:pass@host:port/db`, optionally `?sslmode=require`. docker-compose sets it for you; outside Docker, load it from `.env`. |
| `POSTGRES_PASSWORD` | required | docker-compose only: password for the bundled Postgres. Put it in `.env`; use something URL-safe like `openssl rand -hex 24`. |
| `RESEND_API_KEY` | unset (console) | Sends account email through Resend's SMTP. Unset prints emails to the backend console. |
| `DEFAULT_FROM_EMAIL` | `Job Tracker <noreply@localhost>` | Sender for account email, e.g. `Job Tracker <noreply@yourdomain.com>` (domain verified in Resend). |
| `DB_CONN_MAX_AGE` | `60` | Seconds to keep a Postgres connection open between requests. |
| `PADDLE_ENVIRONMENT` | `sandbox` | `sandbox` or `production`. |
| `PADDLE_API_KEY` | unset (billing off) | Server-side Paddle API key. |
| `PADDLE_CLIENT_TOKEN` | unset | Paddle.js client-side token (safe to expose; it's sent to the browser). |
| `PADDLE_WEBHOOK_SECRET` | unset | The notification destination's secret; webhooks without a valid signature get `400`. |
| `PADDLE_PRICE_MONTHLY`, `PADDLE_PRICE_QUARTERLY` | unset | Paddle price ids (`pri_…`); either one enables that plan. |
| `SENTRY_DSN` | unset | Sends server errors to Sentry, without request bodies or user details. `SENTRY_ENVIRONMENT` names the environment. |
| `WEB_CONCURRENCY` | `2` | Gunicorn workers in the Docker image, about 2 × CPU cores. |
| `REDIS_URL` | unset (DB cache) | `redis://host:6379/0`. Backs the login throttle and the session cache; docker-compose sets it. Without it the DB cache is used, whose counters aren't atomic across workers. |

## Run with Docker

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env   # first time only
docker compose up --build
```

- App: http://localhost:3000
- Backend API (direct): http://localhost:5001
- Database: PostgreSQL 17 in the `db` service, stored in the `pgdata` Docker volume (survives rebuilds; `docker compose down -v` deletes it). Reachable from the host at `localhost:5433` for psql or backups:

  ```bash
  docker compose exec db pg_dump -U jobtracker jobtracker > backup.sql
  ```

- **Nightly backups:** `scripts/backup-db.sh` dumps into `backups/` and keeps 14 days; set
  `BACKUP_COPY` to copy each dump off the server. The script's header has the cron line and
  the steps to test a restore.
- **Uptime:** point a monitor (UptimeRobot, Better Stack, …) at `https://<your host>/api/health`.

Stop with:

```bash
docker compose down
```

## Run manually (dev)

Backend (Django, port 5001):

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
set -a && . ../.env && set +a            # loads DATABASE_URL (manage.py won't start without it)
python manage.py migrate                  # creates/updates the tables
python manage.py createcachetable         # backs the login throttle
python manage.py runserver
```

Run `python manage.py migrate` again after pulling changes that add migrations. Docker does this on startup.

Frontend (Vite, port 3000, proxies `/api` → `localhost:5001`):

```bash
cd frontend
npm install
npm run dev
```

`python manage.py seed --username Adrian` adds sample jobs (needs `--username`
because every job belongs to an account).

## Chrome extension

```bash
cd frontend
npm install
npm run build:ext        # or build:all to build the web app too
```

For the **Chrome Web Store**, build with the production API host baked in:

```bash
VITE_API_BASE=https://jobs.example.com npm run build:ext:store
cd dist-extension && zip -r ../job-tracker-extension.zip . && cd ..
```

That build has `host_permissions` for that host only, no `optional_host_permissions`, no
API-host setting in the panel, and no `key` (the store assigns the ID; set
`CORS_ALLOWED_ORIGINS=chrome-extension://<store id>` once you have it).

Then in Chrome: **chrome://extensions** → enable Developer mode → **Load
unpacked** → pick `frontend/dist-extension`.

- **Signing in:** email + password of an account whose email is already verified.
  Sign-up and password reset happen on the website.
- The extension authenticates with a **bearer token**, not the session cookie: its
  pages are a different origin, so a `SameSite=Lax` cookie is never sent. The
  token is stored in `chrome.storage.local`.
- The backend must allow the extension's origin. Copy the ID Chrome shows and
  run the backend with `CORS_ALLOWED_ORIGINS=chrome-extension://<id>`.
- `manifest.json` carries a `key` so that ID stays the same when the folder
  moves. It is derived from `ext-key.pem`, which is **not** in git -- keep it if
  you want the ID to survive a fresh checkout.
- **Saving a job:** right-click a posting → *Save to Job Tracker*. The side
  panel's form is prefilled from the tab's title and URL -- or from the text you
  had selected, so you can highlight the real job title first -- and you edit it
  before anything is saved. To fill in a job by hand, open the side panel; *Use
  current link* next to the Link field copies the tab's URL in.
- **LinkedIn:** job pages get a **Save to Job Tracker** button next to Apply /
  Save. One click saves the title, company and link to *To Be Applied*; move it
  to *Applied* on the board once you've applied. The link is stored as
  `https://www.linkedin.com/jobs/view/<id>/`, so a posting opened from search
  results and from its own page is recognised as the same job: the button shows
  *Tracked · <column>* instead of saving it twice, and clicking it opens the
  board.
- **XING:** job pages (`/jobs/<slug>-<id>`) get the same button, after
  *Einfach bewerben* / *Job merken*. The link is stored as
  `https://www.xing.com/jobs/<slug>-<id>` with tracking parameters stripped (the
  slug stays: XING treats `/jobs/<id>` as a search), and a posting counts as
  already saved when its numeric id matches.
- **StepStone:** job pages (`/stellenangebote--<slug>--<id>-inline.html`) get the
  button after *Speichern*. The link is stored without tracking parameters, and
  a posting counts as already saved when its numeric id matches.
- **What the extension reads:** only `linkedin.js` on `www.linkedin.com`,
  `xing.js` on `www.xing.com` and `stepstone.js` on `www.stepstone.de` read page
  content -- the title and company of the posting on screen. Everywhere else a
  draft is built from tab metadata alone, and there is no `scripting`
  permission. These sites change their markup; if the button stops appearing,
  the selectors at the top of the board's script in `extension/src/` are what to
  update. URL handling for all of them lives in `extension/src/jobBoards.js`.
- **Changing the API host:** the side panel's footer (development builds only).
  Pointing at an HTTPS host triggers an optional-permission prompt for that origin.
- **Revoking a device:** `DELETE /api/auth/tokens/<id>` (list them with
  `GET /api/auth/tokens`). A password change or reset revokes every token and
  session at once.

## Tests

```bash
cd backend && python manage.py test
```

`scripts/check.sh` runs that (loading `.env` for you) plus `makemigrations --check` and
`npm run build:all`; `scripts/check.sh backend jobs` runs one app's tests.

This uses whatever `DATABASE_URL` points at (creating and dropping a `test_` database), so run it with the
Postgres URL set to test what production runs on.


<img width="1810" height="934" alt="Screenshot From 2026-09-07 19-59-47" src="https://github.com/user-attachments/assets/60af1fde-57b1-4df7-a529-ee4de0fc3354" />
