# Job Tracker

A kanban-style job application tracker built with Flask + React.

## Features
- 5-column kanban: To Be Applied → Applied → In Interview → Got Rejected / Got an Offer
- Drag cards between columns
- Add jobs via modal (title required, URL and salary optional)
- Delete cards with confirmation
- SQLite database via SQLAlchemy (auto-created on first run)



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
