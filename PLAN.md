    # Dockerize backend + frontend with Docker Compose

## Context

Today the app runs only from a manual dev workflow: `python app.py` in `backend/` (Flask, port 5001) and `npm run dev` in `frontend/` (Vite, port 3000, proxying `/api` → `localhost:5001`). The one existing container file, the root `Dockerfile`, bakes both halves into a *single* image where Flask serves the built React bundle out of `backend/dist`.

The goal is a proper two-container setup: an independently buildable backend image, an independently buildable frontend image, and a `docker-compose.yml` that brings both up with one command and keeps the existing SQLite data. Per decisions made: the root `Dockerfile` is replaced, the frontend is served by nginx from a production Vite build, and the database is bind-mounted from `./backend/instance` so existing jobs carry over and stay reachable from DB Browser / `import_jobs.py`.

**Key constraint discovered:** `frontend/src/App.jsx:7` uses a relative `const API = '/api/jobs'` and there is no `VITE_*` env plumbing anywhere in the codebase. So the two containers must be same-origin from the browser's point of view — nginx serves the static bundle *and* reverse-proxies `/api` to the backend service. No frontend source changes are needed.

## Files

### 1. `backend/Dockerfile` (new) — context `./backend`

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
EXPOSE 5001
ENV FLASK_ENV=production PYTHONUNBUFFERED=1
CMD ["gunicorn", "-b", "0.0.0.0:5001", "-w", "2", "app:app"]
```

- `gunicorn` is installed in the image only, leaving `backend/requirements.txt` as the app's own deps (nothing new to install in the local venv).
- Running under gunicorn is safe: the `db.create_all()` + additive `ALTER TABLE` block at `backend/app.py:44-57` executes at *import* time, so it still runs.
- `app.py` stays untouched. With `WORKDIR /app`, Flask's instance path is `/app/instance`, so the hardcoded `sqlite:///jobs.db` (`backend/app.py:11`) resolves to `/app/instance/jobs.db` — exactly the bind-mount target.
- The `serve_react` catch-all (`backend/app.py:121-129`) becomes dead weight in this topology (no `dist/` in the image → JSON 404 for non-`/api` paths). Leave it: nginx never forwards those routes, and it keeps `python app.py` + `npm run build` working outside Docker.

### 2. `backend/.dockerignore` (new)

Critical — without it `COPY . .` pulls in `venv/` (a host-linked Python **3.14** venv that is broken inside a 3.12 image), `__pycache__/`, and the live `instance/jobs.db`:

```
venv/
.venv/
__pycache__/
*.pyc
instance/
dist/
```

Note `.gitignore` lists `backend/.venv/` but the venv on disk is `backend/venv/` — both must be listed.

### 3. `frontend/Dockerfile` (new) — context `./frontend`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build --outDir dist --emptyOutDir

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- `--outDir dist` overrides `build.outDir: '../backend/dist'` from `frontend/vite.config.js:13` for the container build only, so output stays inside the build context. `vite.config.js` itself is **not** modified — local `npm run build` → `backend/dist` keeps working.
- `npm ci` (not `npm install`) since `package-lock.json` is committed.

### 4. `frontend/.dockerignore` (new)

```
node_modules/
dist/
```

### 5. `frontend/nginx.conf` (new)

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;   # SPA fallback
    }
}
```

`backend` resolves via the compose network DNS. `CORS(app)` at `backend/app.py:10` is now redundant but harmless — leave it.

### 6. `docker-compose.yml` (new, repo root)

```yaml
services:
  backend:
    build: ./backend
    container_name: jobtracker-backend
    environment:
      FLASK_ENV: production
    volumes:
      - ./backend/instance:/app/instance   # existing jobs.db lives here
    ports:
      - "5001:5001"                        # direct API access / debugging
    restart: unless-stopped

  frontend:
    build: ./frontend
    container_name: jobtracker-frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped
```

No `version:` key (obsolete in Compose v2). App at **http://localhost:3000**.

### 7. Delete root `Dockerfile`

Replaced by the two service Dockerfiles above.

### 8. Update `README.md`

Add a "Run with Docker" section (`docker compose up --build`, URL, where the DB lives, `docker compose down`) and, since the README currently has no run instructions at all, a short manual-dev section documenting the existing `python app.py` + `npm run dev` flow.

## Verification

```bash
cd /home/adrian/CodingProjects/JobOffers
docker compose up --build          # both images build, both containers start

curl -s localhost:3000 | head              # index.html from nginx
curl -s localhost:3000/api/jobs | head -c 300   # proxied JSON — existing jobs present
curl -s localhost:5001/api/jobs | head -c 300   # backend reachable directly
```

Then in a browser at http://localhost:3000:
1. Board renders with the pre-existing jobs from `backend/instance/jobs.db` (proves the bind mount picked up real data, not an empty DB).
2. Add a job via the modal → appears in "To Be Applied".
3. Drag it to another column → `PATCH /api/jobs/<id>` succeeds, position sticks after a page reload.
4. Deep-link reload (e.g. `localhost:3000/anything`) still serves the app — confirms the nginx SPA fallback.
5. `docker compose restart backend` → the job added in step 2 is still there (persistence).
6. `ls -l backend/instance/jobs.db` on the host shows a fresh mtime.

Also sanity-check the image didn't swallow the venv: `docker compose exec backend ls /app` should show `app.py`, `requirements.txt`, `instance/` — and **no** `venv/`.

CSV import still works inside the container: `docker compose exec backend python import_jobs.py` (reads `job.csv` from the image; bind-mount or `docker cp` a real CSV to use it).
