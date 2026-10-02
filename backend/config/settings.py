import os
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = BASE_DIR / 'instance'
DIST_DIR = BASE_DIR / 'dist'


def env_flag(name):
    return os.environ.get(name) == '1'


def env_list(name):
    return [v.strip() for v in os.environ.get(name, '').split(',') if v.strip()]


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

# Fail closed: debug is off unless explicitly switched on. manage.py sets this
# for `runserver` only, so gunicorn (which never goes through manage.py) can't
# inherit it by accident.
DEBUG = env_flag('DJANGO_DEBUG')

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS')
if not ALLOWED_HOSTS:
    if DEBUG:
        ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']
    else:
        raise ImproperlyConfigured(
            'ALLOWED_HOSTS is empty and DEBUG is off. Set ALLOWED_HOSTS to a '
            'comma-separated list of the hostnames this site is served on.'
        )

# How many proxies sit in front of us. 0 means X-Forwarded-For is untrusted and
# must never be read -- doing so unconditionally is the standard spoof bypass.
TRUSTED_PROXY_COUNT = int(os.environ.get('TRUSTED_PROXY_COUNT', '0'))

# HTTPS=1 turns on every transport-security setting at once. SESSION_COOKIE_SECURE
# is still honoured on its own so an existing docker-compose.yml doesn't regress.
HTTPS = env_flag('HTTPS')
SECURE_SSL_REDIRECT = HTTPS
SECURE_HSTS_SECONDS = 31536000 if HTTPS else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = HTTPS
SECURE_HSTS_PRELOAD = HTTPS
if TRUSTED_PROXY_COUNT > 0:
    # nginx.conf already sets X-Forwarded-Proto
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'allauth',
    'allauth.account',
    'allauth.headless',
    'accounts',
    'jobs',
    'billing',
]

AUTH_USER_MODEL = 'accounts.User'
AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'allauth.account.auth_backends.AuthenticationBackend',
]

MIDDLEWARE = [
    # Must be first: a preflight has to answer before SECURE_SSL_REDIRECT can
    # 301 it, and it must wrap api_guard, which would 401 a preflight because
    # preflights carry no Authorization header.
    'config.cors.cors_middleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'allauth.account.middleware.AccountMiddleware',
    'accounts.middleware.api_guard',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'config.security.security_headers',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
APPEND_SLASH = False

def database_from_url(url):
    """Django DATABASES entry for postgres://user:pass@host:port/name?sslmode=..."""
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql'):
        raise ImproperlyConfigured(f'DATABASE_URL must be a postgres:// URL, got {parsed.scheme!r}')
    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': unquote(parsed.path.lstrip('/')),
        'USER': unquote(parsed.username or ''),
        'PASSWORD': unquote(parsed.password or ''),
        'HOST': parsed.hostname or '',
        'PORT': parsed.port or '',
        'OPTIONS': dict(parse_qsl(parsed.query)),
        # Reuse connections across requests instead of reconnecting every time,
        # and check them first so a Postgres restart doesn't surface as a 500.
        'CONN_MAX_AGE': int(os.environ.get('DB_CONN_MAX_AGE', '60')),
        'CONN_HEALTH_CHECKS': True,
    }


if not os.environ.get('DATABASE_URL'):
    raise ImproperlyConfigured(
        'DATABASE_URL is not set. Point it at Postgres, e.g. load the repo .env with '
        '`set -a && . ../.env && set +a` before running manage.py.'
    )
DATABASES = {'default': database_from_url(os.environ['DATABASE_URL'])}
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'

# Redis when REDIS_URL is set (docker-compose, production): its incr is atomic,
# which the login throttle and allauth's rate limits rely on across workers.
# Without it, the DB cache works but can let a few extra attempts through.
if os.environ.get('REDIS_URL'):
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': os.environ['REDIS_URL'],
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
            'LOCATION': 'django_cache',
        }
    }

USE_TZ = False
TIME_ZONE = 'UTC'
USE_I18N = False

TEMPLATES = [
    {
        # allauth renders its emails (verification code, password reset) from templates
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'APP_DIRS': True,
        'OPTIONS': {'context_processors': ['django.template.context_processors.request']},
    },
]

# Accounts: allauth's headless JSON API, mounted at /api/_allauth/. Email is the
# login; the username is only the board's display name. Verification and password
# reset use emailed codes, typed into the same screen, so the SPA needs no routes.
ACCOUNT_LOGIN_METHODS = {'email'}
ACCOUNT_SIGNUP_FIELDS = ['email*', 'username*', 'password1*']
ACCOUNT_EMAIL_VERIFICATION = 'mandatory'
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED = True
ACCOUNT_PASSWORD_RESET_BY_CODE_ENABLED = True
ACCOUNT_SESSION_REMEMBER = True
ACCOUNT_EMAIL_SUBJECT_PREFIX = '[Job Tracker] '
HEADLESS_ONLY = True
HEADLESS_CLIENTS = ('browser',)  # the extension uses accounts.ApiToken, not allauth's app tokens
# Links allauth puts in emails. With code-based flows these only appear in the
# "someone tried to sign up with your address" email; relative paths are made absolute.
HEADLESS_FRONTEND_URLS = {
    'account_signup': '/?mode=signup',
    'account_reset_password': '/?mode=forgot',
    'account_reset_password_from_key': '/?mode=forgot',
    'account_confirm_email': '/',
}
# Same rule as accounts.ratelimit.client_ip for allauth's own rate limits
ALLAUTH_TRUSTED_PROXY_COUNT = TRUSTED_PROXY_COUNT

# Mail: Resend's SMTP when RESEND_API_KEY is set, otherwise printed to the
# console (dev: the verification code shows up in the runserver output).
# `or`, not a get() default: docker-compose passes unset variables as empty strings
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL') or 'Job Tracker <noreply@localhost>'
if os.environ.get('RESEND_API_KEY'):
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = 'smtp.resend.com'
    EMAIL_PORT = 587
    EMAIL_USE_TLS = True
    EMAIL_HOST_USER = 'resend'
    EMAIL_HOST_PASSWORD = os.environ['RESEND_API_KEY']
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# Stored server-side (cache in front of Postgres) so a session can be revoked,
# which signed cookies can't.
SESSION_ENGINE = 'django.contrib.sessions.backends.cached_db'
SESSION_COOKIE_AGE = 30 * 24 * 60 * 60
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = HTTPS or env_flag('SESSION_COOKIE_SECURE')

CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_HTTPONLY = False  # the SPA reads it to set X-CSRFToken
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS')

# Origins allowed to make cross-origin API calls, e.g. chrome-extension://<id>.
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS')

# The API only ever takes small JSON documents, and a content script will be
# posting text scraped from arbitrary pages.
DATA_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024

# Billing: Paddle (merchant of record -- it sells the subscription and files EU
# VAT). Off until the API key, client-side token and at least one price are set;
# with billing off there are no plan limits (development, self-hosting).
PADDLE_ENVIRONMENT = os.environ.get('PADDLE_ENVIRONMENT') or 'sandbox'
if PADDLE_ENVIRONMENT not in ('sandbox', 'production'):
    raise ImproperlyConfigured("PADDLE_ENVIRONMENT must be 'sandbox' or 'production'")
PADDLE_API_KEY = os.environ.get('PADDLE_API_KEY') or ''
PADDLE_CLIENT_TOKEN = os.environ.get('PADDLE_CLIENT_TOKEN') or ''
PADDLE_WEBHOOK_SECRET = os.environ.get('PADDLE_WEBHOOK_SECRET') or ''
# Plan key -> Paddle price id (pri_...). Labels are in billing/plans.py.
PADDLE_PRICES = {
    key: value for key, value in (
        ('monthly', os.environ.get('PADDLE_PRICE_MONTHLY')),
        ('quarterly', os.environ.get('PADDLE_PRICE_QUARTERLY')),
    ) if value
}
BILLING_ENABLED = bool(PADDLE_API_KEY and PADDLE_CLIENT_TOKEN and PADDLE_PRICES)

# Errors to Sentry when SENTRY_DSN is set. No request bodies or user details:
# job data and emails stay out of a third party's logs.
if os.environ.get('SENTRY_DSN'):
    import sentry_sdk

    sentry_sdk.init(
        dsn=os.environ['SENTRY_DSN'],
        environment=os.environ.get('SENTRY_ENVIRONMENT') or 'production',
        send_default_pii=False,
        max_request_body_size='never',
        traces_sample_rate=0,
    )

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
]

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 10},
    },
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
]
