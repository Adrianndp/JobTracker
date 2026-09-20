FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5001
# DJANGO_DEBUG is deliberately absent: settings fail closed, so a production
# image cannot serve tracebacks because someone forgot an env var.
ENV PYTHONUNBUFFERED=1
# --fake-initial adopts a jobs.db created by the old Flask backend; later
# migrations (job ownership, api tokens) still run for real.
# createcachetable backs the login throttle and is idempotent.
CMD ["sh", "-c", "python manage.py migrate --fake-initial --noinput && python manage.py createcachetable && exec gunicorn -b 0.0.0.0:5001 -w 2 config.wsgi"]
