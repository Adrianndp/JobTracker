FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn==23.0.0
COPY . .
EXPOSE 5001
ENV DJANGO_ENV=production PYTHONUNBUFFERED=1
# --fake-initial adopts a jobs.db created by the old Flask backend
CMD ["sh", "-c", "python manage.py migrate --fake-initial --noinput && exec gunicorn -b 0.0.0.0:5001 -w 2 config.wsgi"]
