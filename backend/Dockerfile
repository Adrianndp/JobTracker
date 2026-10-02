FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5001
# DJANGO_DEBUG is deliberately absent: settings fail closed, so a production
# image cannot serve tracebacks because someone forgot an env var.
ENV PYTHONUNBUFFERED=1
# createcachetable backs the login throttle and is idempotent.
# WEB_CONCURRENCY: gunicorn workers, about 2 x CPU cores. Each holds up to one
# Postgres connection (CONN_MAX_AGE), so keep it well under max_connections.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py createcachetable && exec gunicorn -b 0.0.0.0:5001 -w ${WEB_CONCURRENCY:-2} config.wsgi"]
