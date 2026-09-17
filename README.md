# Job Tracker

A kanban-style job application tracker built with Flask + React.

## Features
- 5-column kanban: To Be Applied → Applied → In Interview → Got Rejected / Got an Offer
- Drag cards between columns
- Add jobs via modal (title required, URL and salary optional)
- Delete cards with confirmation
- SQLite database via SQLAlchemy (auto-created on first run)



## Project structure

```
backend/
  app.py            Flask app: config, blueprint registration, table setup, health check, serves the built frontend
  extensions.py     shared SQLAlchemy instance (db)
  models/
    user.py         User account (password hashing, session versioning)
    job.py          Job + valid statuses
  views/
    users.py        /api/auth/* (status, signup, login, logout), login guard, `reset-password` CLI command
    jobs.py         /api/jobs CRUD
  import_jobs.py    CSV import
  seed.py           sample data
frontend/src/
  App.jsx           auth gate, board state, API calls
  components/       LoginPage, KanbanBoard, KanbanColumn, JobCard, AddJobModal, CompanyFilter
```

## Login

The tracker has a single account and requires signing in.

- **First run:** open the app and you'll see "Create your account". Choose a username and a password (at least 8 characters). Sign-up closes once that account exists.
- **Forgot your password:** reset it from the backend (this also signs out every existing session):

  ```bash
  cd backend && source venv/bin/activate
  flask --app app reset-password
  # or with Docker:
  docker compose exec backend flask --app app reset-password
  ```

- **Sessions** last 30 days. They're signed with a key generated once into `backend/instance/secret_key`. Set `SECRET_KEY` to override it. Set `SESSION_COOKIE_SECURE=1` if you serve the app over HTTPS.
- After 5 failed sign-in attempts, sign-in is blocked for 5 minutes. Behind Docker's nginx every request comes from the same proxy address, so this lock applies to everyone at once.

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

Backend (Flask, port 5001):

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Frontend (Vite, port 3000, proxies `/api` → `localhost:5001`):

```bash
cd frontend
npm install
npm run dev
```

## Import from CSV
command in backend withh venv activated
"python import_jobs"
and have your jobs.csv ready you can do it if you have DB Browser for SQL Lite


<img width="1810" height="934" alt="Screenshot From 2026-09-07 19-59-47" src="https://github.com/user-attachments/assets/60af1fde-57b1-4df7-a529-ee4de0fc3354" />
