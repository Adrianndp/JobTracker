# Job Tracker

Kanban job-application tracker: Django 5.2 API + React 18 SPA (Vite) + a Chrome MV3
extension that saves postings from LinkedIn, XING and StepStone. Multi-user, Postgres,
allauth (headless) for accounts, Paddle for the Pro subscription. Aimed at German-speaking
job seekers.

- **README.md** is the user-facing manual: project map, every env var, how accounts,
  billing and the extension behave. Read the relevant section before changing a feature,
  and update it in the same change when behaviour, env vars or files change.
- **PLAN.md** is the roadmap (phases, decisions with dates, what is done / still open).
  Implementation plans go there too; mark items done with the date when you finish them.

## Commands

```bash
scripts/check.sh                    # all: migration check + backend tests + web & extension builds
scripts/check.sh backend [labels]   # e.g. scripts/check.sh backend jobs.tests.OwnershipTests
scripts/check.sh frontend           # npm run build:all
```

Manual equivalents (the backend venv is `backend/.venv`, managed with uv):

```bash
cd backend && set -a && . ../.env && set +a   # manage.py refuses to start without DATABASE_URL
.venv/bin/python manage.py test               # ~100 tests, ~25 s, needs the local Postgres
.venv/bin/python manage.py runserver          # port 5001 (manage.py sets the default + DEBUG)
cd frontend && npm run dev                    # port 3000, proxies /api -> 5001
cd frontend && npm run build:ext              # extension -> frontend/dist-extension (load unpacked)
```

Python dependencies: edit `backend/requirements.in` (direct deps only), never `requirements.txt`
by hand — it's the uv lockfile. Regenerate with
`uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes -o requirements.txt`, then
`uv pip sync requirements.txt` (README "Run manually").

There is no JS test runner or linter; for frontend changes the build passing plus a look
in the browser (see the `run-app` skill) is the check.

## Layout (details in README "Project structure")

- `backend/config/` settings (all env-driven), urls, CORS, CSP. `backend/accounts/` user,
  extension API tokens, `api_guard` middleware. `backend/jobs/` Job model + CRUD.
  `backend/billing/` Paddle, plans, webhooks.
- `frontend/src/` the web app; `frontend/extension/` the Chrome extension, which reuses
  `App.jsx` for its board page via the `@app` alias.
- `mcp_server/` standalone MCP server (FastMCP 4, Python 3.13, uv: `uv add`, commit `uv.lock`,
  `uv run pytest`). Independent: never import from `backend/` or share its database.
- `frontend/extension/src/jobBoards.js` URL parsing for every supported board;
  `trackerButton.js` the shared in-page button; one content script per board.

## Rules that are easy to get wrong

- **API routes have no trailing slash** (`APPEND_SLASH = False`): `/api/jobs`, `/api/jobs/<id>`.
- **Every `/api/` POST/PATCH/PUT must be `application/json`** or `api_guard` answers 415.
  Every `/api/` path needs a signed-in user unless listed in `PUBLIC_API_PATHS` /
  `PUBLIC_API_PREFIXES` in `backend/accounts/middleware.py`.
- **Two auth schemes:** the web app uses the session cookie + `X-CSRFToken`; the extension
  uses `Authorization: Bearer <ApiToken>` (CSRF is skipped for bearer). Resolve the user with
  `accounts.auth.current_user(request)`, never `request.user` alone.
- **Scope every Job query by user** (`Job.objects.filter(user=...)`). Another user's job is a
  404, not a 403 (no enumeration oracle). `jobs/tests.py` `OwnershipTests` guards this.
- **Plan limits are decided only in `billing/plans.py`** (`plan_for`, `active_limit_error`).
  Billing is off — and there are no limits — unless the Paddle env vars are set, so tests
  that need limits use `override_settings`.
- **Datetimes are naive UTC** (`USE_TZ = False`, `accounts.models.utcnow()`); `to_dict`
  appends `Z`.
- **Job statuses are listed in several places** — `jobs/models.py` `VALID_STATUSES`,
  `billing/plans.py` `ACTIVE_STATUSES`, `frontend/src/api.ts` `JobStatus`,
  `frontend/src/App.jsx` `ACTIVE_STATUSES`, `components/KanbanBoard.jsx` columns,
  `extension/src/trackerButton.js` `STATUS_LABELS`. Change them together.
- **Extension content scripts are classic IIFE scripts**, built one at a time by
  `vite.extension.content.config.js`. A new one must be added to `build:ext` in
  `frontend/package.json` and to `content_scripts` in the manifest (`add-job-board` skill).
- **Text limits** live in `backend/jobs/validators.py` and are mirrored (as a courtesy only)
  in `extension/src/background.js` `MAX`.
- **Security headers / CSP** are set twice: `backend/config/security.py` (HTML Django
  serves) and `frontend/nginx.conf` (Docker). Change both.
- Model changes need a migration and a DB backup first (`db-migration` skill).

## Secrets and personal data — do not read, print or commit

`.env`, `ext-key.pem`, `backend/instance/secret_key`, and `backups/` (real user data).
Loading `.env` into a shell to run commands is fine; echoing its values is not.

## Style

- Python: 4 spaces, single quotes, lines up to ~110 cols, class-based views returning
  `JsonResponse`. Comments explain *why* (security reasoning, external-site quirks), and
  modules open with a docstring saying what they own — keep that up.
- Frontend: function components, one `Component.jsx` + `Component.module.css` per component,
  no UI library (icons come from `lucide-react`); `.ts` only for `api.ts` and `src/lib/`.
- UI: no raw colours/sizes in component CSS — use `src/styles/tokens.css` variables and
  `composes:` from `src/styles/controls.module.css`. Follow the `ui-ux-pro-max` skill for any
  screen or style change.
- Commits: conventional prefix, imperative — `feat: add …`, `fix: …`, `refactor: …`.
