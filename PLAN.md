# Job Tracker → Chrome Extension (MV3), with security + data-model fixes first

## Context

`JobOffers` is a single-account Django 5.2 + React 18 kanban job tracker: React SPA → same-origin `/api/*` → nginx → gunicorn → SQLite (`backend/instance/jobs.db`, currently 1 user + 76 jobs).

The goal is a Chrome extension that saves the job posting you are looking at in one click and shows the kanban board. Three things block that today, and two of them are pre-existing defects worth fixing regardless:

1. **Jobs have no owner.** `Job` (`backend/jobs/models.py`) has no FK to `User`, and `JobListView.get` returns every row unfiltered. The app is only "correct" because signup hard-closes after the first account.
2. **Auth cannot cross origins.** Extension pages are `chrome-extension://<id>`, so the `SameSite=Lax` session cookie is never sent, and there are no CORS headers. Cookie sessions must be joined by a token scheme.
3. **Security gaps that the extension makes worse.** `DEBUG` defaults *on*; no CSRF middleware at all (so `DELETE /api/jobs/<id>` is fully unprotected — the existing `application/json` check in `accounts/middleware.py:9` only covers POST/PATCH/PUT); the login lockout keys on `REMOTE_ADDR`, which behind nginx is always the proxy, so anyone can lock the only account out; `JobCard.jsx:91` renders `href={job.link}` unvalidated, which becomes click-to-XSS the moment a link arrives from anywhere but the user's own typing.

Decisions taken: keep the Django backend and add **token auth** for the extension; extension scope is **one-click save from job pages** plus the board; **fixes land before the port**.

**Guiding constraint: no new Python dependencies.** CORS and tokens are hand-rolled (~40 and ~80 lines). The project has exactly one Python dep today and that is worth preserving.

---

## Phase 0 — Environment hygiene (blocking)

The dev venv is **Python 3.14.4** with stale Flask/Werkzeug/SQLAlchemy still installed; the Dockerfile is 3.12.

*(Corrected during implementation: Django 5.2.17 **does** support Python 3.14 — it declares the 3.14 classifier and `manage.py check` passes. An earlier draft of this plan claimed 5.2 was 3.10–3.13 only; that was true of Django 5.2.0, not of this patch release. No new interpreter is needed, and the 3.12 Dockerfile is also fine. Only the stale Flask packages needed clearing.)*

1. Delete `backend/venv/`; recreate at `backend/.venv` on the same Python 3.14 (already matched by `.gitignore`), so Flask/SQLAlchemy/Werkzeug are gone.
2. `.gitignore` — add `backend/venv/`, `frontend/dist-extension/`, `ext-key.pem`.
3. `backend/requirements.txt` — add `gunicorn==23.0.0` (today it exists only in the Dockerfile, so dev and prod disagree).
4. **Back up the DB before Phase 1:** `cp backend/instance/jobs.db backend/instance/jobs.db.pre-owner-fk`. SQLite rebuilds the whole `job` table for the `NOT NULL` alter.

---

## Phase 1 — Backend security + data model

### 1.1 `backend/config/settings.py`

- `DEBUG = os.environ.get('DJANGO_DEBUG') == '1'` — **fail closed**. Keep `runserver` ergonomic by setting `os.environ.setdefault('DJANGO_DEBUG', '1')` in `backend/manage.py` *only when `sys.argv[1] == 'runserver'`*; gunicorn never goes through `manage.py`, so prod can't inherit it.
- `ALLOWED_HOSTS` from env; empty + DEBUG → localhost set; empty + not DEBUG → raise `ImproperlyConfigured` (clearer than Django's generic 400 on every request).
- Always on: `SECURE_CONTENT_TYPE_NOSNIFF`, `SECURE_REFERRER_POLICY='same-origin'`, `X_FRAME_OPTIONS='DENY'`, `SECURE_CROSS_ORIGIN_OPENER_POLICY='same-origin'`.
- New `HTTPS=1` env gates `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS=31536000` (+subdomains, preload), `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`. Keep reading the old `SESSION_COOKIE_SECURE` var as a fallback so `docker-compose.yml` doesn't silently regress.
- `SECURE_PROXY_SSL_HEADER` **only when `TRUSTED_PROXY_COUNT > 0`** (see 1.4). `frontend/nginx.conf` already sets `X-Forwarded-Proto`.
- `AUTH_PASSWORD_VALIDATORS` (MinimumLength 10, CommonPassword, NumericPassword, UserAttributeSimilarity). These work **without** installing `django.contrib.auth` — `password_validation.validate_password(pw, user)` just `getattr`s `username`/`email`, which `accounts.models.User` has.
- `DATA_UPLOAD_MAX_MEMORY_SIZE = 100*1024` — the API only takes small JSON.
- `CACHES` → `DatabaseCache` at `django_cache` (needed by 1.4).

`MIDDLEWARE` (order is load-bearing, see 3.3):
```
config.cors.cors_middleware            ← must be first
django.middleware.security.SecurityMiddleware
django.contrib.sessions.middleware.SessionMiddleware
django.middleware.csrf.CsrfViewMiddleware
accounts.middleware.api_guard
django.middleware.clickjacking.XFrameOptionsMiddleware
config.security.security_headers
```

### 1.2 Job ownership FK

**Signup policy stays closed** (single account). Rationale: this box goes on the public internet for the extension to reach; open registration is abuse surface for no benefit. Adding the FK now makes multi-user a policy flip later instead of a migration later.

- `backend/jobs/models.py` — `user = ForeignKey('accounts.User', on_delete=CASCADE, related_name='jobs', db_column='user_id')`. Leave `to_dict()` alone (don't leak `user_id`).
- **New** `backend/jobs/migrations/0002_job_user.py`, deps `[('jobs','0001_initial'), ('accounts','0001_initial')]`: `AddField(null=True)` → `RunPython` backfill to `User.objects.order_by('id').first()` (raise `RuntimeError` if jobs exist but no user) → `AlterField(null=False)`.
- `backend/jobs/views.py` — filter every queryset by `current_user(request)` (import from `accounts.auth`; it becomes request-cached in 3.2, so repeat calls are free). `JobDetailView.dispatch` returns **404, not 403**, for another user's job — no enumeration oracle.
- `jobs/management/commands/seed.py` and `import_jobs.py` — add a required `--username`; both break on `NOT NULL` otherwise.

### 1.3 Throttle — replace the in-memory dict

**New** `backend/accounts/ratelimit.py`:
- `client_ip(request)`: read `X-Forwarded-For` **only** when `settings.TRUSTED_PROXY_COUNT > 0`, taking index `-TRUSTED_PROXY_COUNT`; otherwise `REMOTE_ADDR`. Reading XFF unconditionally is the standard spoof bypass. `docker-compose.yml` sets `TRUSTED_PROXY_COUNT: 1`.
- `hit(bucket, key, limit, window) -> (allowed, retry_after)` over `django.core.cache`.

**Key design.** With a single account, *any username-only counter is itself the DoS* — that is precisely today's bug. So:
- `login:{username}:{ip}` — 5 / 15 min. An attacker rotating IPs cannot lock the real user out.
- `loginip:{ip}` — 20 / 15 min across all usernames, stops single-host spraying.
- **Deliberately no global per-username lock.** PBKDF2 + the 10-char validator floor is the account's protection. Document this in the README so it isn't "fixed" back.
- No `time.sleep()` — under `gunicorn -w 2`, a sleeping worker *is* a DoS.

`backend/accounts/views.py` — delete `failed_logins`/`MAX_FAILED_LOGINS`/`LOCKOUT_SECONDS`; extract `authenticate(request, data) -> (user, error_response)` shared by `LoginView` and the new `TokenView` so the throttle can't be bypassed via the token endpoint; add a signup throttle (5/hr per IP).

Accepted limitation: `DatabaseCache.incr` isn't atomic across workers, so a couple of extra attempts may slip per window. The precise fix (a `LoginAttempt` model with `select_for_update`) is ~40 lines for no practical gain at this threshold — note it in the README.

### 1.4 CSRF — enable the real middleware, exempt bearer

**Rule: CSRF is enforced for every unsafe `/api/*` request that is not bearer-authenticated.** Bearer requests carry no ambient authority, so they're exempt by construction.

- Add `CsrfViewMiddleware` (no `django.contrib.sessions` app needed).
- In `accounts/middleware.py`, set `request._dont_enforce_csrf_checks = True` when `request.auth_scheme == 'bearer'`. All middleware request-phase code runs before any `process_view`, so list position doesn't matter.
- Exactly **one** `@csrf_exempt` view in the codebase: `POST /api/auth/token`. It takes credentials in the body and exercises no ambient authority, and the extension has no CSRF cookie to present.
- `/api/auth/login` and `/signup` stay protected — login CSRF is real (it logs a victim into an attacker's account).
- `StatusView.get` → wrap in `ensure_csrf_cookie` so the SPA has a `csrftoken` before the login form; it already calls `/api/auth/status` on boot via `useAuthStatus`.
- **This closes the `DELETE` hole.** Keep the `application/json` check as defence in depth against HTML-form posts, with a comment stating plainly that it was never the CSRF defence.
- `PUBLIC_API_PATHS`: **remove** `/api/auth/logout` (it's currently an unauthenticated forced-logout nuisance), **add** `/api/auth/token`. No frontend change needed — `useLogout` already passes `notifyUnauthorized: false` and `App.jsx:56` does `await logout().catch(() => {})`.

### 1.5 Link validation + length caps

**New** `backend/jobs/validators.py`:
- `clean_link(value)` — `urlsplit`, require `http`/`https` + non-empty netloc, reject control chars/whitespace, cap 500. Else `400`.
- `clean_text(value, max_len)` — trim, collapse whitespace, truncate. **SQLite doesn't enforce `VARCHAR(n)` and `objects.create()` doesn't validate `max_length`** — today a 100 KB title writes straight into `job.name`, and the extension can send one.

Apply in `JobListView.post` / `JobDetailView.patch` **only when the key is present**. Reuse the existing `optional_str` as the first step of `clean_text`.

**Legacy-link carve-out (required, not optional).** Jobs 33, 48 (`'easy apply'`) and 37 (`'easyApply'`) hold non-URL text in `link`. `AddJobModal.jsx:40` sends the *whole* form — including `link` — on every edit, so a plain reject-with-400 rule would make those three rows permanently uneditable. Therefore on **PATCH**: if the incoming `link` fails `clean_link` **but is byte-identical to the currently stored value**, pass it through unchanged; otherwise 400. On **POST** (new jobs, including every extension save) an invalid link is always a 400. This keeps the user's own notes, keeps the cards editable, and still blocks `javascript:` from ever entering the table. Cover it in `jobs/tests.py`: PATCH echoing `'easy apply'` → 200; PATCH sending `javascript:alert(1)` on that same row → 400.

### 1.6 Tests (new — the project has none, and this phase changes auth-critical behaviour)

`backend/accounts/tests.py`, `backend/jobs/tests.py`, Django's built-in runner, no new deps:
ownership isolation (B can't see/PATCH/DELETE A's jobs → 404) · `clean_link` rejects `javascript:`/`data:`/`vbscript:`/`//evil` · throttle: 5 fails one IP → 429, 6th from a different XFF → 401 not 429 · CSRF: cookie DELETE without token → 403, bearer DELETE → 204 · unauthenticated logout → 401 · revoked/expired/post-password-reset tokens → 401.

---

## Phase 2 — Frontend security (web SPA)

- **`javascript:` XSS.** New `frontend/src/lib/safeUrl.ts` → `safeHref(link)` returns the href only for `http:`/`https:`, else `null`. `JobCard.jsx` renders the `<a>` only when non-null, otherwise a plain `<span>`. Both this *and* server-side validation are required: the server protects new writes, this protects the 76 rows already in the DB (and makes the legacy `'easy apply'` rows stop rendering as dead links).
- **Bundle Inter.** Add `@fontsource-variable/inter`, `@import` it in `src/index.css`, and delete the three Google Fonts `<link>` tags from `frontend/index.html`. Required for MV3 CSP, and it removes an un-SRI'd third-party resource from the web app.
- **CSP in both places.** The SPA is served by Django's `ReactAppView` *and* by nginx — a header in only one is a header in neither for the path you actually use. New `backend/config/security.py` middleware for HTML responses, mirrored in `frontend/nginx.conf`. `'unsafe-inline'` must stay in `style-src` (React inline `style` props in `JobCard.jsx`/`AddJobModal.jsx`); everything else is `'self'`.
- **CSRF header** in `api.ts`'s single `request<T>()` helper: add explicit `credentials: 'same-origin'` (today omitted, working only by same-origin accident) and send `X-CSRFToken` on POST/PATCH/**DELETE** — the current code sets headers only for POST/PATCH, so DELETE would start 403'ing the instant CSRF is on.

---

## Phase 3 — Token auth + CORS

### 3.1 Tokens: opaque + DB, not JWT

Instantly revocable, no signing/expiry logic to get wrong, no new dep.

`backend/accounts/models.py` — `ApiToken`: `user` FK, `token_hash` (sha256 hex, unique+indexed), `prefix` (display only), `device_name`, `session_version`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`. New `accounts/migrations/0002_apitoken.py`.

**New** `backend/accounts/tokens.py`:
- `issue(user, device_name)` — `secrets.token_urlsafe(32)`, store only the hash, 90-day expiry, and snapshot `user.session_version()`. Reusing that existing method means `manage.py reset_password` already invalidates every token, mirroring session behaviour with zero extra plumbing.
- `resolve(raw)` — reject revoked / expired / stale-`session_version`. Bump `last_used_at` at most hourly, else every API call is a SQLite write.

`backend/accounts/views.py` / `urls.py`:
- `TokenView` `POST /api/auth/token` (`@csrf_exempt`) → `201 {token, expires_at, username}`, routed through the shared `authenticate()` so the throttle applies. Uses the existing `read_json` (`config/views.py`) and `read_str`.
- `LogoutView` becomes authenticated and dual-aware: bearer → revoke the presenting token; cookie → `session.flush()`. No separate delete endpoint needed.
- `TokenListView` `GET`/`DELETE /api/auth/tokens[/<id>]` — makes revocation real rather than theoretical.

### 3.2 Dual auth resolution

**The web SPA keeps cookie sessions; only the extension uses tokens.** An `HttpOnly` cookie can't be read by XSS while a token in JS can, the SPA is same-origin so cookies just work, and the frontend diff stays tiny.

`backend/accounts/auth.py` — keep the public surface (`current_user`, `start_session`) so no caller is rewritten, but make it dual and request-cached: try `Authorization: Bearer` via `tokens.resolve()`, else the existing session path; memoize on `request._auth_user` and expose `request.auth_scheme` / `request.auth_token`.

### 3.3 CORS — hand-rolled

New `backend/config/cors.py`, ~40 lines. Allowlist from `CORS_ALLOWED_ORIGINS` env (e.g. `chrome-extension://<id>`), empty by default; echo `Access-Control-Allow-Origin` + `Vary: Origin` only on a match; answer preflights with 204. **Never emit `Access-Control-Allow-Credentials`** — the extension is token-only, so even a mistakenly allowlisted origin can't ride the session cookie. Hand-rolling keeps that property visible and auditable instead of one config flag away from a disaster.

Order matters twice: it must precede `SecurityMiddleware` (with `SECURE_SSL_REDIRECT` on, a preflight would otherwise 301 and fail opaquely) and must wrap `api_guard` (a preflight carries no `Authorization`, and `/api/jobs` isn't public, so `api_guard` would 401 it — and it makes 401/415/403 bodies readable rather than opaque network errors).

### 3.4 Pin the extension ID

An unpacked extension's ID derives from its directory path unless `manifest.json` carries a `key`, so moving the folder silently breaks CORS. Generate once with `openssl genrsa 2048 > ext-key.pem` (keep out of git) + `openssl rsa -pubout -outform DER | openssl base64 -A`, put it in the manifest, load unpacked once, copy the ID Chrome shows into `CORS_ALLOWED_ORIGINS`. **Do this before ever loading unpacked.**

### 3.5 Deployment

`backend/Dockerfile` CMD → `migrate --fake-initial --noinput && createcachetable && exec gunicorn …`. `docker-compose.yml` — add `TRUSTED_PROXY_COUNT`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `HTTPS`, `CSRF_TRUSTED_ORIGINS`.

---

## Phase 4 — Shared transport (so the extension reuses the SPA verbatim)

**New** `frontend/src/lib/transport.ts` — `configureApi({baseUrl, credentials, getToken, onUnauthorized})` / `getTransport()`. Defaults are exactly today's web behaviour, so `frontend/src/main.jsx` needs **no change**.

`frontend/src/api.ts` — modify only `request<T>()`: prefix `baseUrl`, use `transport.credentials`, send `Authorization: Bearer` when a token resolves (and skip CSRF then), else the CSRF header. Cache the token in a module variable invalidated by `chrome.storage.onChanged` so it isn't an async storage read per call. Add `tokenLogin` + `useTokenLogin()` following the existing `useLogin`/`useRequest` shape.

`ApiError`, `unauthorizedListeners`, `useUnauthorized`, `useAuthStatus`, `useJobs`, `useCreateJob`, `useUpdateJob`, `useDeleteJob` are reused **untouched** — the existing 401 broadcast is already exactly the "token died, show login" signal the extension needs.

`LoginPage.jsx` — one optional prop `authMode: 'session' | 'token'` (default `'session'`); `onAuthenticated(username)` is unchanged. `App.jsx` passes it through.

---

## Phase 5 — Extension scaffold

**Surface: a full-tab board page + a side panel. No popup.** Six dnd columns are unusable at popup width; `board.html` in a real tab reuses `App.jsx` wholesale. The side panel is right-sized for "save this page / recent saves / settings" and, unlike a popup, stays open while you browse listings.

**Build: one `frontend/` workspace, extra Vite configs — not a separate top-level package.** React, dnd and every component are shared; a second `package.json` means drifting deps for no isolation.

```
frontend/
  vite.config.js               ← UNCHANGED (web SPA → ../backend/dist)
  vite.extension.config.js     ← pages → dist-extension/ (publicDir = extension/public)
  vite.extension.sw.config.js  ← service worker, lib mode, format 'es', single file
  extension/
    public/manifest.json, public/icons/{16,48,128}.png
    board.html, sidepanel.html
    src/{board.jsx,sidepanel.jsx,SavePanel.jsx,settings.js,tokenStore.js,background.js}
```

Two builds because Rollup's `format` is per-build and MV3 has conflicting needs: pages want code-split ESM, the service worker must be one file. Add `resolve.alias { '@app': frontend/src }` to all three so extension code imports `@app/api`, `@app/App`, `@app/lib/safeUrl`. Scripts: `build:ext` (two `vite build -c …`), `build:all`. No `@crxjs/vite-plugin` — a large beta dep in a project with five.

**API host:** build-time `VITE_API_BASE` (`.env.development` → `http://localhost:5001`, `.env.production` → your HTTPS host), overridable at runtime via `chrome.storage.local.apiBase` in the side panel's settings row; a custom host triggers `chrome.permissions.request({origins:[host+'/*']})`.

**`manifest.json` — least privilege:** `permissions: [activeTab, contextMenus, storage, sidePanel]`, `host_permissions: ["http://localhost:5001/*"]`, `optional_host_permissions: ["https://*/*"]` (for a user-set prod API host only), `background.service_worker` + `type: module`, `side_panel.default_path`, plus the `key` from 3.4.

**No content script and no broad host permissions.** Nothing is ever injected into a page, so reading a tab's title and URL needs *zero* standing host permissions. Don't declare `content_security_policy`; MV3's default is already what we want and constrains only script/object, not React's inline `style` attributes.

---

## Phase 6 — Save flow

**Hard constraint: all API calls live in the service worker or an extension page.** A page-context `fetch` would carry the job board's `Origin` and fail CORS, and "fixing" that would mean allowlisting job-board origins. Corollary: MV3 workers die after ~30s idle, so never cache the token or `apiBase` in a `background.js` module variable — always read `chrome.storage.local`.

**The extension reads no page content.** No content script, no `scripting` permission, no DOM parsing. A draft is built from tab metadata only:

- `tab.title` → job title, or `info.selectionText` when you highlighted the real title before right-clicking.
- `info.linkUrl` → the posting, so you can save from a results list without opening it; else `info.pageUrl` / `tab.url`.
- Company and salary are left blank for you to fill.

This drops six files and the entire selector-rot maintenance burden, and it keeps the extension clear of every job board's terms on automated extraction — which matters for a product that may be sold. Trimming to the model caps happens in `background.js`; the **server** caps from 1.5 remain the control.

**Flow** (`background.js`): on install, register the `contextMenus` entry and `sidePanel.setPanelBehavior({openPanelOnActionClick:true})` → on click, build the draft, park it in `chrome.storage.local` and open the side panel → you complete it and press save → `POST {apiBase}/api/jobs` with the bearer token (status is hardcoded `to_be_applied` server-side, no change needed) → badge feedback plus a `job-created` broadcast so an open board tab refreshes → on 401, clear the token and show login.

`SavePanel.jsx` always shows an **editable form before saving** — a tab title is rarely the job title on its own. Reuses `useCreateJob`/`useJobs`/`useAuthStatus`/`useUnauthorized` from `@app/api` and `safeHref`.

`board.jsx` — `configureApi({baseUrl, credentials:'omit', getToken})`, then render the existing `@app/App` with `authMode="token"`.

## Phase 7 — Docs

Replace `PLAN.md` with this plan. Update `README.md`: the "lock applies to everyone at once" paragraph (that behaviour is deliberately gone), the new env vars (`DJANGO_DEBUG`, `HTTPS`, `TRUSTED_PROXY_COUNT`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`), the `--username` flag on `seed`/`import_jobs`, and an Extension section (build, load unpacked, set API host, revoke a device).

---

## Verification

**Backend** (from `backend/`, venv active, **after the DB backup**):
```bash
python manage.py check
DJANGO_DEBUG= HTTPS=1 ALLOWED_HOSTS=jobs.example.com python manage.py check --deploy   # zero W0xx
python manage.py makemigrations --check --dry-run    # "No changes detected"
python manage.py migrate && python manage.py createcachetable && python manage.py test
```
Then confirm the backfill: `select count(*) from job where user_id is null` → 0, `where user_id=1` → 76.

**Token auth** — `POST /api/auth/token` → 201 + token; `GET /api/jobs` with bearer → 200/76 jobs, without → 401; `POST /api/auth/logout` with bearer → 204, then the same token → 401; `manage.py reset_password` then an old token → 401.

**CORS** — preflight `OPTIONS /api/jobs` with the extension `Origin` → 204 with `Access-Control-Allow-Origin` echoed, `Vary: Origin`, `authorization` in Allow-Headers, and **no `Access-Control-Allow-Credentials`**. Same preflight with `Origin: https://evil.example` → no ACAO header at all.

**CSRF / the DELETE hole** — with a cookie session, `DELETE /api/jobs/999` without `X-CSRFToken` → **403** (this is the fixed hole); with the header → 404; with a bearer token → 404, no CSRF needed.

**Link validation** — `POST /api/jobs` with `javascript:alert(1)`, `data:text/html,…`, `//evil.example`, `vbscript:x` → all 400. Manually: a legacy card whose `link` is `'easy apply'` renders as plain text, not an anchor.

**Throttle (proves the DoS is gone)** — with `TRUSTED_PROXY_COUNT=1`, six bad logins from `X-Forwarded-For: 203.0.113.9` → `401×5, 429`; then one bad login from `198.51.100.4` → **401, not 429**. A different client is not locked out of the only account.

**Ownership isolation** — create a second user with a job via `manage.py shell`; `GET /api/jobs` as the first user must not contain it.

**Frontend** — `npm run build`, then `grep -r fonts.googleapis dist/` returns nothing; `docker compose up --build`, `curl -sI localhost:3000/` shows the CSP header; open the app and check DevTools for zero CSP violations, then drag / edit / delete / log out / log back in.

**Extension** — `npm run build:ext`, load `frontend/dist-extension` unpacked, confirm the ID matches `CORS_ALLOWED_ORIGINS`. Log in via the side panel and verify the token is in `chrome.storage.local` and **not** localStorage. Open the full board → 76 jobs, drag a card, confirm the web SPA reflects it after reload. Then save a posting from the context menu and another from the side panel's *Use current tab*, confirming each lands in **To Be Applied** on both surfaces. Check the service worker console for zero CORS errors. Negative: backend stopped → error not hang; revoked token → bounce to login.

---

## Data safety

Verified against the live DB: **1 user (`id=1`, Adrian), 76 jobs, 74 with a link, 3 of those non-URLs.**

Nothing in this plan deletes a row. The ownership migration adds a column and backfills; `import_jobs` still upserts by id and `seed` still only appends; `backend/venv/` is a virtualenv, not data (the DB lives in `backend/instance/`); `emptyOutDir` only touches generated build folders. The single moment the rows move is the SQLite table rebuild in 1.2 — transactional and rolling back on failure, but the Phase-0 `cp` is the guaranteed undo and is not skippable.

Two behaviour changes that are **not** data loss but will be noticed: the 10-char password floor applies only when a password is *set*, so the existing login is unaffected (it bites only on the next `reset_password`); and enabling CSRF makes every already-open SPA tab 403 on its next write until reloaded.

## Risks

1. ~~**Python 3.14 is not a supported Django 5.2 runtime.**~~ **Resolved — this was wrong.** Django 5.2.17 declares 3.14 support and passes `manage.py check` on it. Phase 0 reduced to clearing the stale Flask packages out of the venv.
2. **The `job` table gets rebuilt** by the `NOT NULL` alter on SQLite. 76 rows is nothing, but take the backup.
3. **`--fake-initial` only fakes `0001`.** Both new `0002` migrations genuinely execute against the live volume-mounted DB on the next `docker compose up`.
4. **Enabling CSRF breaks live clients.** Every currently-open SPA tab 403s on its next write until reloaded, as does any script hitting the API with a session cookie.
5. **`activeTab` lapses on navigation**, so the side panel's *Use current tab* can come back with an empty URL once you have browsed on. The context menu re-grants it on every click and is the reliable path; the panel says so when the read comes back empty.
6. **Extension ID stability** — without the manifest `key`, moving `dist-extension/` changes the ID and CORS breaks with an opaque network error.
7. **`DatabaseCache.incr` isn't atomic** across workers; a few extra login attempts may slip per window. Documented trade-off.
8. **`chrome.sidePanel` needs Chrome 114+**, `openPanelOnActionClick` 116+.
9. **`'unsafe-inline'` stays in `style-src`** because of React inline `style` props. Tightening it means converting those to class-set custom properties — out of scope.
