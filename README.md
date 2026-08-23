# Job Tracker

A kanban-style job application tracker built with Flask + React.

## Setup

### Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```
Runs on **http://localhost:5000**

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on **http://localhost:3000**

Open http://localhost:3000 — the frontend proxies `/api` calls to the Flask backend automatically.

## Features
- 5-column kanban: To Be Applied → Applied → In Interview → Got Rejected / Got an Offer
- Drag cards between columns
- Add jobs via modal (title required, URL and salary optional)
- Delete cards with confirmation
- SQLite database via SQLAlchemy (auto-created on first run)



## Import from CSV
command in backend withh venv activated
"python import_jobs"
and have your jobs.csv ready you can do it if you have DB Browser for SQL Lite