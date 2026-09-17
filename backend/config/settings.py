import os
import secrets
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = BASE_DIR / 'instance'
DIST_DIR = BASE_DIR / 'dist'


def load_secret_key():
    if os.environ.get('SECRET_KEY'):
        return os.environ['SECRET_KEY']
    INSTANCE_DIR.mkdir(exist_ok=True)
    path = INSTANCE_DIR / 'secret_key'
    try:
        # O_EXCL so concurrent gunicorn workers can't each write a different key
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    for _ in range(50):
        key = path.read_text().strip()
        if key:
            return key
        time.sleep(0.01)
    raise RuntimeError(f'Secret key file {path} is empty')


SECRET_KEY = load_secret_key()
DEBUG = os.environ.get('DJANGO_ENV') != 'production'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')

INSTALLED_APPS = [
    'accounts',
    'jobs',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'accounts.middleware.api_guard',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
APPEND_SLASH = False

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': INSTANCE_DIR / 'jobs.db',
    }
}
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'

# Timestamps are stored as naive UTC, like the Flask version did
USE_TZ = False
TIME_ZONE = 'UTC'
USE_I18N = False

SESSION_ENGINE = 'django.contrib.sessions.backends.signed_cookies'
SESSION_COOKIE_AGE = 30 * 24 * 60 * 60
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = os.environ.get('SESSION_COOKIE_SECURE') == '1'

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
]
