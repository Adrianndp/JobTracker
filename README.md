# Job Tracker

A kanban-style job application tracker built with Django + React, plus a Chrome
extension that saves a posting from a job page in one click.

## Features
- 5-column kanban: To Be Applied → Applied → In Interview → Got Rejected / Got an Offer
- Drag cards between columns
- Add jobs via modal (title required, URL and salary optional)
- Delete cards with confirmation
- SQLite database via the Django ORM
- Chrome extension: save the page you are on to your board, and view the full
  board in a tab



## Project structure

```
backend/
  manage.py         Django entry point (`runserver` defaults to port 5001)
  config/           settings (secret key, sessions, SQLite), URL routes, health check, serves the built frontend
  accounts/
    models.py       User account (password hashing, session versioning)
    middleware.py   API guard: JSON-only writes, login required
    views.py        /api/auth/* (status, signup, login, logout)
    management/commands/reset_password.py
    auth.py         resolves a request to a user (bearer token or session)
    tokens.py       issue/resolve/revoke API tokens for the extension
    ratelimit.py    cache-backed login throttle
    management/commands/reset_password.py
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
```

## Login

The tracker has a single account and requires signing in.

- **First run:** open the app and you'll see "Create your account". Choose a username and a password (at least 10 characters; it is also checked against Django's common-password and all-numeric validators). Sign-up closes once that account exists.
- **Forgot your password:** reset it from the backend (this also signs out every existing session):

  ```bash
  cd backend && source venv/bin/activate
  python manage.py reset_password
  # or with Docker:
  docker compose exec backend python manage.py reset_password
  ```

- **Sessions** last 30 days. They're signed with a key generated once into `backend/instance/secret_key`. Set `SECRET_KEY` to override it. Set `HTTPS=1` when you serve the app over HTTPS.
- **Sign-in throttling:** 5 failed attempts for the same username *from the same
  client* blocks that pair for 15 minutes, plus 20 failures from one address
  across all usernames. There is deliberately **no global per-username lock**:
  with a single account that would let anyone lock you out of your own tracker,
  which is exactly what the previous `REMOTE_ADDR`-keyed throttle did behind
  nginx. The account's protection is PBKDF2 plus the password floor.
  Set `TRUSTED_PROXY_COUNT` to the number of proxies you run (docker-compose sets
  `1` for nginx); `X-Forwarded-For` is ignored entirely when it is `0`, because
  trusting it unconditionally lets anyone look like a fresh client.
  The counters live in the DB cache, whose `incr` isn't atomic across gunicorn
  workers, so a couple of extra attempts can slip through per window.

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

## Run with Docker

```bash
docker compose up --build
```

- App: http://localhost:3000
- Backend API (direct): http://localhost:5001
- Database: persists on the host at `backend/instance/jobs.db` (bind-mounted, so it survives rebuilds/restarts and is reachable from DB Browser for SQLite or `import_jobs.py`)

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
python manage.py migrate --fake-initial   # creates the tables, or adopts a jobs.db from the old Flask backend
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

- The extension authenticates with a **bearer token**, not the session cookie: its
  pages are a different origin, so a `SameSite=Lax` cookie is never sent. The
  token is stored in `chrome.storage.local`.
- The backend must allow the extension's origin. Copy the ID Chrome shows and
  run the backend with `CORS_ALLOWED_ORIGINS=chrome-extension://<id>`.
- `manifest.json` carries a `key` so that ID stays the same when the folder
  moves. It is derived from `ext-key.pem`, which is **not** in git -- keep it if
  you want the ID to survive a fresh checkout.
- **Saving a job:** right-click a posting → *Save job to tracker*, or open the
  side panel and press *Use current tab*. The form is prefilled from the tab's
  title and URL -- or from the text you had selected, so you can highlight the
  real job title first -- and you edit it before anything is saved.
- **The extension never reads page content.** There is no content script and no
  `scripting` permission; a draft is built from tab metadata alone. That keeps
  it off every job board's terms of service and means the only host permission
  is the API itself.
- **Changing the API host:** the side panel's footer. Pointing at an HTTPS host
  triggers an optional-permission prompt for that origin.
- **Revoking a device:** `DELETE /api/auth/tokens/<id>` (list them with
  `GET /api/auth/tokens`). `manage.py reset_password` revokes every token and
  session at once.

## Tests

```bash
cd backend && python manage.py test
```


<img width="1810" height="934" alt="Screenshot From 2026-09-07 19-59-47" src="https://github.com/user-attachments/assets/60af1fde-57b1-4df7-a529-ee4de0fc3354" />
