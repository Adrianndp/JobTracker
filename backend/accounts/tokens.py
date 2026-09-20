"""Issue and resolve opaque API tokens.

Opaque random strings in a table rather than JWTs: revocation is a single UPDATE
instead of a denylist, there is no signing or expiry logic of our own to get
wrong, and it needs no new dependency.
"""

import hashlib
import secrets
from datetime import timedelta

from .models import ApiToken, utcnow

TOKEN_LIFETIME = timedelta(days=90)
# Writing last_used_at on every request would mean a SQLite write per API call
LAST_USED_RESOLUTION = timedelta(hours=1)


def hash_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def issue(user, device_name=None):
    """Create a token for `user`. Returns (raw_token, ApiToken)."""
    raw = secrets.token_urlsafe(32)
    token = ApiToken.objects.create(
        user=user,
        token_hash=hash_token(raw),
        prefix=raw[:8],
        device_name=device_name or None,
        session_version=user.session_version(),
        expires_at=utcnow() + TOKEN_LIFETIME,
    )
    return raw, token


def resolve(raw):
    """The User behind a raw token, or None if it is unknown/revoked/expired."""
    if not raw:
        return None, None
    token = ApiToken.objects.filter(token_hash=hash_token(raw)).select_related('user').first()
    if token is None or not token.is_active():
        return None, None

    now = utcnow()
    if token.last_used_at is None or now - token.last_used_at > LAST_USED_RESOLUTION:
        token.last_used_at = now
        token.save(update_fields=['last_used_at'])
    return token.user, token


def revoke(token):
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        token.save(update_fields=['revoked_at'])
