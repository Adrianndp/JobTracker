# Job Tracker Chrome Extension + MCP Server

A kanban-style job application tracker built with Django + React, plus a Chrome
extension that saves a posting from a job page in one click.

## Features
- 5-column kanban: To Be Applied → Applied → In Interview → Got Rejected / Got an Offer
- Drag cards between columns
- Add jobs via modal (title required, URL and salary optional)
- Delete cards with confirmation
- Same-company check: typing a company in the add/edit dialog (or the extension's side panel)
  lists the jobs you already have there, and warns if you applied before. Spellings are matched
  loosely, so "Siemens AG", "siemens" and "Siemens GmbH" count as one company, as do
  "Müller"/"Mueller", "Robert Bosch GmbH"/"Bosch" and one-letter typos. Cards that share a
  company get a "+N here" badge ("Applied here before" on a To Be Applied card); clicking it
  filters the board to that company, and the company filter covers every spelling.
- PostgreSQL database via the Django ORM
- Chrome extension: save the page you are on to your board, and view the full
  board in a tab
- One-click "Save to Job Tracker" button on LinkedIn, XING and StepStone job postings
- Free plan (30 active applications) and Pro via Paddle; account deletion



## Project structure

```
backend/
  manage.py         Django entry point (`runserver` defaults to port 5001)
  requirements.in   direct dependencies (edit this one)
  requirements.txt  lockfile generated from it by uv: every package, pinned, with hashes
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
                    celebrate.ts (confetti when a job moves to "Got an Offer"),
                    companyMatch.ts (fuzzy "same company?" matching and grouping)
  styles/           tokens.css (colours, type, spacing, ...) and controls.module.css (shared
                    buttons, inputs, menus, modals), used by the web app and the extension pages
  components/       LoginPage (website sign-in flows), ExtensionLogin (the extension's token
                    sign-in), AuthCard (the frame both share), KanbanBoard, KanbanColumn,
                    JobCard, AddJobModal, CompanyMatches (the same-company hint), CompanyFilter, ExportMenu, PricingPage, UpgradeFlow (plan → review → pay → done),
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
mcp_server/           standalone MCP server (FastMCP, uv); see "MCP server" below
  main.py           the server: tools, GET /health, streamable HTTP on :8000/mcp
  tests/            pytest, via FastMCP's in-memory client
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
- MCP server: http://localhost:8001/mcp (see "MCP server" below)
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
uv venv                                   # creates .venv (install uv: https://docs.astral.sh/uv/)
uv pip sync requirements.txt              # installs exactly the locked set, removes anything else
source .venv/bin/activate
set -a && . ../.env && set +a            # loads DATABASE_URL (manage.py won't start without it)
python manage.py migrate                  # creates/updates the tables
python manage.py createcachetable         # backs the login throttle
python manage.py runserver
```

Run `python manage.py migrate` again after pulling changes that add migrations. Docker does this on startup.

Dependencies: add or bump a package in `requirements.in`, then regenerate the lockfile and
install it (`--universal --python-version 3.12` keeps it valid from Docker's Python 3.12 up to newer local
Pythons; without the floor, packages only older Pythons need get left out):

```bash
uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes -o requirements.txt
uv pip sync requirements.txt
```

`uv pip compile ... --upgrade` moves everything unpinned (the indirect dependencies) to the
latest versions. Docker installs the same `requirements.txt` with plain pip, which checks the hashes.

Frontend (Vite, port 3000, proxies `/api` → `localhost:5001`):

```bash
cd frontend
npm install
npm run dev
```

`python manage.py seed --username Adrian` adds sample jobs (needs `--username`
because every job belongs to an account).

## MCP server

`mcp_server/` is a separate microservice that gives MCP clients such as Claude Code access to
the job tracker. It's built on [FastMCP](https://gofastmcp.com) 4 and has its own
dependencies, Dockerfile and Python (3.13). It imports nothing from `backend/` and
doesn't touch the database: it reads job data through the backend's `/api/`, like the Chrome
extension does.

What it offers so far:

- tool `greet`: returns `"hello"`, to check the connection.
- resource template `jobtracker://users/{username}/jobs`: that user's jobs as JSON (the same
  objects `GET /api/jobs` returns), newest first.

**Auth.** The MCP client sends a Job Tracker API token as `Authorization: Bearer <token>`, and
the server passes it on to the backend unchanged, so it can only ever see that token's user.
The resource checks `{username}` against the token's user (`GET /api/auth/status`). Any other
username answers "No jobs found", whether or not it exists, so the resource can't be used to
find out which usernames exist. The match is case-sensitive.

| Env var | Default | |
|---|---|---|
| `BACKEND_URL` | `http://localhost:5001` | where the backend API is; compose sets `http://backend:5001` |

In compose, the backend's `ALLOWED_HOSTS` gets `backend` added so that this internal call
passes Django's host check. With `HTTPS=1`, Django redirects plain-HTTP calls to HTTPS, so
point `BACKEND_URL` at the public `https://` address instead.

It uses the streamable HTTP transport with the MCP endpoint at `/mcp`, plus `GET /health`
for the Docker healthcheck. Only `localhost`, `127.0.0.1` and `::1` are accepted as `Host`
headers (FastMCP's `host_origin_protection=True`) so a web page can't reach it through DNS
rebinding. Any other host gets `421`. To serve it under a real hostname, add that name to
`allowed_hosts` in `main.py`.

Run it locally with [uv](https://docs.astral.sh/uv/) (port 8000):

```bash
cd mcp_server
uv sync                  # creates .venv from uv.lock, including the dev group (pytest)
uv run main.py           # http://localhost:8000/mcp
uv run pytest            # tests
```

Or run it with Docker (published at `127.0.0.1:8001`). It starts without `backend`, but the jobs
resource needs it running:

```bash
docker compose up -d --build mcp
curl http://localhost:8001/health          # -> ok
```

Get an API token. This is the same sign-in the extension uses. The token is valid for 90 days,
and changing your password or calling `DELETE /api/auth/tokens/<id>` revokes it.

```bash
curl -s -X POST http://localhost:5001/api/auth/token -H 'Content-Type: application/json' \
  -d '{"email": "you@example.com", "password": "...", "device_name": "Claude Code MCP"}'
# -> {"token": "...", "expires_at": "...", "username": "..."}
```

Connect Claude Code to it with that token (local scope keeps it out of the repo):

```bash
claude mcp add --transport http jobtracker http://localhost:8001/mcp \
  --header "Authorization: Bearer <token>"
```

(Use port `8000` for a server started with `uv run main.py`.) Then ask Claude to call `greet`,
or to read `jobtracker://users/<your username>/jobs`.

Dependencies: `uv add <package>` (or `uv add --dev <package>`) updates `pyproject.toml` and
`uv.lock`, and both get committed. The Docker build runs `uv sync --frozen --no-dev`, so it
installs exactly what the lockfile says.

## Run Docker + Chrome Extension + Pro Account

### 1. Configure `.env` (first time only)

In the repo root:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "CORS_ALLOWED_ORIGINS=chrome-extension://nlpoghnjoenjhflgmpglnaodoncokahe" >> .env
```

The second line lets the extension call the backend.

> You can skip this step if your `.env` already has both values.

### 2. Start the stack

```bash
docker compose up --build -d
docker compose ps        # wait until backend shows "healthy"
```

- Web app: <http://localhost:3000>
- API: <http://localhost:5001>

The extension talks to the API directly on port `5001`.

### 3. Create an account (new setups only)

1. Open <http://localhost:3000> and choose **Sign up**. Enter an email, a username, and a password of at least 10 characters (for example, `example@hotmail.com`).
2. Get the verification code from the backend log and enter it:

   ```bash
   docker compose logs backend | grep -i -A3 code
   ```

### 4. Make the account Pro

```bash
docker compose exec backend python manage.py billing_comp example@hotmail.com
```

It should print `example@hotmail.com now has complimentary Pro`. Reload <http://localhost:3000>, and the plan chip in the header should show **Pro**.

To undo it, add `--off`:

```bash
docker compose exec backend python manage.py billing_comp example@hotmail.com --off
```

> **Note:** Pro is stored in the Docker database, so it applies only to Docker. Your local `localdb` doesn't change.

### 5. Build the extension

```bash
cd frontend
npm install              # first time only
npm run build:ext        # output goes to frontend/dist-extension
```

Use `npm run build:all` instead to build the web app too.

### 6. Load it in Chrome

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick `frontend/dist-extension`. If an older copy is already loaded, click its reload icon instead.
3. Check that the ID shown is `nlpoghnjoenjhflgmpglnaodoncokahe`.

### 7. Sign in to the extension

1. Open the extension's side panel from the toolbar icon. Pin it first if it's hidden under the puzzle icon.
2. Sign in with the same email and password. The account must already be verified.

### 8. Try it

Open a job posting on LinkedIn, XING, or StepStone and click **Save to Job Tracker** next to Apply. The job appears in **To Be Applied** on <http://localhost:3000>.

## Tests

```bash
cd backend && python manage.py test
```

`scripts/check.sh` runs that (loading `.env` for you) plus `makemigrations --check` and
`npm run build:all`; `scripts/check.sh backend jobs` runs one app's tests.

The MCP server has its own tests, which `check.sh` doesn't run yet: `cd mcp_server && uv run pytest`.

This uses whatever `DATABASE_URL` points at (creating and dropping a `test_` database), so run it with the
Postgres URL set to test what production runs on.


<img width="1810" height="934" alt="Screenshot From 2026-09-07 19-59-47" src="https://github.com/user-attachments/assets/60af1fde-57b1-4df7-a529-ee4de0fc3354" />
