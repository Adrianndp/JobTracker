# Rewrite the backend from Flask to Django

## Context

The backend is Flask + Flask-SQLAlchemy (`app.py`, `models/`, `views/`, `import_jobs.py`, `seed.py`). Goal: the same HTTP API on Django, so the React frontend, nginx config and Vite proxy don't change, and the existing `backend/instance/jobs.db` (74 jobs, 1 user) keeps working.

## Layout

```
backend/
  manage.py                  runserver defaults to port 5001
  config/                    settings.py, urls.py, wsgi.py
  accounts/                  User model, /api/auth/* views, API guard middleware,
                             management command reset_password
  jobs/                      Job model, /api/jobs views,
                             management commands import_jobs, seed
  config/views.py            health check, serves backend/dist in production
```

## Compatibility decisions

- **Same tables**: models use `db_table = 'job'` / `'user'`, `AutoField` ids. The initial migrations match the existing schema, so an existing DB is adopted with `python manage.py migrate --fake-initial` (Docker runs it on startup).
- **Same data location**: `backend/instance/jobs.db` and `backend/instance/secret_key` (same O_EXCL generation, `SECRET_KEY` env still overrides).
- **Passwords**: new hashes use Django's hasher. Existing Werkzeug hashes (`scrypt:` / `pbkdf2:`) are still verified and upgraded to a Django hash on the next successful login, so the current account keeps working.
- **Sessions**: signed-cookie sessions (no session table), 30 days, HttpOnly, SameSite=Lax, `SESSION_COOKIE_SECURE=1` env. Session version = HMAC(secret, password_hash), so resetting the password signs everyone out. Existing Flask cookies are not read, so everyone signs in once after the switch.
- **API guard middleware**: same rules — POST/PATCH/PUT to `/api/*` must be JSON (415), non-public `/api/*` needs a valid session (401). No CSRF token middleware (same as before: JSON-only + SameSite).
- **Login lockout**: same in-memory per-process 5 attempts / 5 minutes.
- **Response shapes** unchanged (`to_dict`, status codes, error messages). Unknown job id → JSON 404.
- **CLI**: `flask --app app reset-password` → `python manage.py reset_password`; `python import_jobs.py` → `python manage.py import_jobs`; `python seed.py` → `python manage.py seed`.
- **Env**: `FLASK_ENV=production` → `DJANGO_ENV=production` (DEBUG off). `ALLOWED_HOSTS` from env, default `*` (as Flask accepted any host).

## Other files

- `requirements.txt`: django 5.2 LTS (+ gunicorn in Dockerfile).
- `Dockerfile`: migrate --fake-initial, then `gunicorn config.wsgi`.
- `docker-compose.yml`: env rename.
- README: run/CLI instructions and project structure.
- Delete `app.py`, `extensions.py`, `models/`, `views/`, `import_jobs.py`, `seed.py`.

## Verification

- `manage.py check`, `makemigrations --check` (no pending changes).
- Copy of the real DB: `migrate --fake-initial` succeeds, jobs list returns the 74 jobs with the same JSON as Flask did, existing account logs in with its old password and the hash gets upgraded.
- Fresh DB: health, 401 guard, 415 guard, signup / second signup 403, login lockout 429, logout, jobs CRUD, reset_password invalidates the old session.
