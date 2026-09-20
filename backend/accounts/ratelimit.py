"""Login/signup throttling, backed by the cache rather than process memory.

The previous implementation kept a module-level dict keyed on REMOTE_ADDR. Behind
nginx every request carries the proxy's address, so five wrong guesses from
anyone locked the only account out for everybody -- the throttle was a denial of
service against its own user. It also reset on restart and, under `gunicorn -w 2`,
gave an attacker 5 attempts per worker.
"""

import time

from django.conf import settings
from django.core.cache import cache


def client_ip(request):
    """The client's address, trusting X-Forwarded-For only as far as configured.

    TRUSTED_PROXY_COUNT is how many proxies we control. Reading the header when
    that is 0 is the standard spoof bypass: anyone can send X-Forwarded-For and
    be treated as a fresh client on every request.
    """
    count = settings.TRUSTED_PROXY_COUNT
    if count > 0:
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        parts = [p.strip() for p in forwarded.split(',') if p.strip()]
        if len(parts) >= count:
            return parts[-count]
    return request.META.get('REMOTE_ADDR') or 'unknown'


def _key(bucket, key):
    # Cache keys must not contain spaces or control characters
    safe = ''.join(c if c.isalnum() or c in '.:-_@' else '_' for c in str(key))
    return f'ratelimit:{bucket}:{safe}'[:250]


def check(bucket, key, limit):
    """(allowed, retry_after) without recording a hit."""
    entry = cache.get(_key(bucket, key))
    if not entry:
        return True, 0
    count, first_seen, window = entry
    remaining = int(first_seen + window - time.time())
    if count >= limit and remaining > 0:
        return False, remaining + 1
    return True, 0


def record_failure(bucket, key, window):
    """Count one failure against the bucket."""
    name = _key(bucket, key)
    entry = cache.get(name)
    now = time.time()
    if entry and now - entry[1] < entry[2]:
        count, first_seen, _ = entry
        cache.set(name, (count + 1, first_seen, window), int(first_seen + window - now) + 1)
    else:
        cache.set(name, (1, now, window), window)


def clear(bucket, key):
    cache.delete(_key(bucket, key))
