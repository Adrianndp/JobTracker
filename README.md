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
- One-click "Add to Job Tracker" button on LinkedIn job postings



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
  config/
    cors.py         CORS allowlist for the extension origin
    security.py     CSP and friends for the HTML Django serves
frontend/src/
  App.jsx           auth gate, board state, API calls
  api.ts            fetch helper + hooks (shared with the extension)
  lib/              transport.ts (api base + auth scheme), safeUrl.ts
  components/       LoginPage, KanbanBoard, KanbanColumn, JobCard, AddJobModal, CompanyFilter
frontend/extension/
  public/           manifest.json, icons
  board.html        the full kanban, reusing App.jsx
  sidepanel.html    save-this-page panel
  src/background.js MV3 service worker: context menu and API calls
  src/linkedin.js   content script: "Add to Job Tracker" button on LinkedIn job pages
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
- **Saving a job:** right-click a posting → *Save job to tracker*. The side
  panel's form is prefilled from the tab's title and URL -- or from the text you
  had selected, so you can highlight the real job title first -- and you edit it
  before anything is saved. To fill in a job by hand, open the side panel; *Use
  current link* next to the Link field copies the tab's URL in.
- **LinkedIn:** job pages get an **+ Add to Job Tracker** button next to Apply /
  Save. One click saves the title, company and link to *To Be Applied*; move it
  to *Applied* on the board once you've applied. The link is stored as
  `https://www.linkedin.com/jobs/view/<id>/`, so a posting opened from search
  results and from its own page is recognised as the same job: the button shows
  *In tracker · <column>* instead of saving it twice, and clicking it opens the
  board.
- **What the extension reads:** only `linkedin.js`, on `www.linkedin.com`, reads
  page content -- the title and company of the posting on screen. Everywhere
  else a draft is built from tab metadata alone, and there is no `scripting`
  permission. LinkedIn changes its markup often; if the button stops appearing,
  the selectors at the top of `extension/src/linkedin.js` are what to update.
- **Changing the API host:** the side panel's footer. Pointing at an HTTPS host
  triggers an optional-permission prompt for that origin.
- **Revoking a device:** `DELETE /api/auth/tokens/<id>` (list them with
  `GET /api/auth/tokens`). A password change or reset revokes every token and
  session at once.

## Tests

```bash
cd backend && python manage.py test
```

This uses whatever `DATABASE_URL` points at (creating and dropping a `test_` database), so run it with the
Postgres URL set to test what production runs on.


<img width="1810" height="934" alt="Screenshot From 2026-09-07 19-59-47" src="https://github.com/user-attachments/assets/60af1fde-57b1-4df7-a529-ee4de0fc3354" />
