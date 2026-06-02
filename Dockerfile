# Stage 1 — build the React frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build
# output lands in /app/backend/dist (vite outDir: '../backend/dist')

# Stage 2 — run Flask + serve the built frontend
FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /app/backend/dist ./dist
EXPOSE 8080
ENV PORT=8080
ENV FLASK_ENV=production
CMD ["python", "app.py"]
