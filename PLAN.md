# Split backend into models/ and views/

## Context

All backend code (config, both models, auth routes, job routes, CLI command, React serving) lives in one 325-line `backend/app.py`. Goal: models in a `models/` package and views in a `views/` package, one module per domain (users, jobs). Behavior must not change.

Constraints that keep `app.py` at the top level with a module-level `app` object:
- `backend/Dockerfile` runs `gunicorn app:app`
- README documents `python app.py` and `flask --app app reset-password`
- `import_jobs.py` does `from app import app, db, Job, VALID_STATUSES`; `seed.py` does `from app import app, db, Job`
- `Flask(__name__)` in `backend/app.py` puts `instance_path` at `backend/instance/`, where `jobs.db` and `secret_key` live, so no data moves.

## Layout

```
backend/
  app.py          app + config + secret key, db.init_app, register blueprints,
                  create_all + column migrations, /api/health, React catch-all, __main__
  extensions.py   db = SQLAlchemy()   (shared by app and models; avoids circular imports)
  models/
    __init__.py   re-exports User, Job, VALID_STATUSES
    user.py       User (session_version uses current_app.secret_key)
    job.py        Job, VALID_STATUSES
  views/
    __init__.py   re-exports users_bp, jobs_bp
    users.py      Blueprint url_prefix=/api/auth: status/signup/login/logout,
                  login guard (before_app_request), current_user/start_session,
                  login lockout state, reset-password CLI (cli_group=None keeps `flask --app app reset-password`)
    jobs.py       Blueprint url_prefix=/api/jobs: list/create/update/delete
```

`app.py` re-exports `db`, `Job`, `User`, `VALID_STATUSES` so the scripts' imports keep working.

`.gitignore`: `backend/__pycache__/` → `__pycache__/` so the new packages' bytecode caches stay untracked.

README: add a short "Project structure" section.

## Ordering

The dev server (`python app.py`, debug reloader) watches already-imported modules. Create the new files first (not watched yet), then rewrite `app.py` in one write, so it reloads exactly once with everything present.

## Verification

- Route map + CLI command list identical to the snapshot taken before the refactor.
- Test client on a fresh DB: health, 401 guard, 415 guard, signup/second signup 403, login lockout 429, logout, jobs CRUD, reset-password invalidates old session.
- `from app import app, db, Job, VALID_STATUSES` works (import_jobs/seed).
- Running dev backend on :5001 still up after reload.
