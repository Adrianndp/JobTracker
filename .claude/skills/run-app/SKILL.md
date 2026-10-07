---
name: run-app
description: Start this project's dev stack (Django API on 5001, Vite web app on 3000), sign in, get the emailed verification code, seed sample jobs, and load the Chrome extension, so a change can be seen working in the real app. Use when asked to run, start, try, demo or screenshot the app or extension.
---

# Run the app locally

## Backend and web app (the normal dev loop)

Run both in the background (they don't exit):

```bash
# API on http://localhost:5001
cd backend && set -a && . ../.env && set +a && .venv/bin/python manage.py runserver

# Web app on http://localhost:3000 (proxies /api to 5001)
cd frontend && npm run dev
```

- `manage.py` refuses to start without `DATABASE_URL`, which only comes from loading `.env`.
  The local `.env` points at a Postgres on this machine, not the Docker one.
- If `runserver` fails with missing tables: `.venv/bin/python manage.py migrate`, and
  `createcachetable` when `REDIS_URL` is unset (it is, locally).
- Health check: `curl -s localhost:5001/api/health`.
- Billing: on only when the Paddle key, client token and a price are all set (the local
  `.env` has sandbox Paddle values, so expect the 30-active-jobs free limit). With billing off
  there are no plan limits. The pricing page is at `/?pricing`.

## Signing in

- Email is the login. Sign-up sends a code by email; without `RESEND_API_KEY` the email is
  **printed in the runserver output** — read the code from there.
- For a throwaway test account, sign up through the UI with an `@example.com` address and take
  the code from the console. Don't use or change the owner's real account without asking.
- Sample data: `.venv/bin/python manage.py seed --username <username>`.
- Pro without paying: `.venv/bin/python manage.py billing_comp <email>` (`--off` undoes it).

## Chrome extension

```bash
cd frontend && npm run build:ext
```

Load (or reload) `frontend/dist-extension` at chrome://extensions with Developer mode on. The
dev build talks to `http://localhost:5001`, and the backend must allow the extension's origin
via `CORS_ALLOWED_ORIGINS=chrome-extension://<id>` — the local `.env` already sets it, and the
id stays stable thanks to the manifest `key`. If the side panel gets CORS errors, the id in
chrome://extensions no longer matches `.env`. Sign in from the side panel with a verified
account.

## Whole stack in Docker (closer to production)

```bash
docker compose up --build        # app on :3000 (nginx), API on :5001, Postgres on :5433
```

Uses its own `pgdata` volume, not the local Postgres. Stop with `docker compose down`
(never `down -v` without asking: it deletes the database).

## Looking at it

Use the Claude in Chrome tools on http://localhost:3000; for the extension's board, the
side panel or a content-script button, use a real job posting in the same Chrome. Stop the
background servers when done.
