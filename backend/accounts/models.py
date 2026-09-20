import hashlib
import hmac
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models

MIN_PASSWORD_LENGTH = 10


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def check_werkzeug_password(pwhash, password):
    """Verify a hash written by the Flask version (werkzeug's scrypt/pbkdf2 format)."""
    try:
        method, salt, expected = pwhash.split('$', 2)
        name, *args = method.split(':')
        if name == 'scrypt':
            n, r, p = (int(a) for a in args)
            actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=n, r=r, p=p,
                                    maxmem=132 * n * r * p, dklen=64).hex()
        elif name == 'pbkdf2':
            digest, iterations = args[0], int(args[1])
            actual = hashlib.pbkdf2_hmac(digest, password.encode(), salt.encode(), iterations).hex()
        else:
            return False
    except (ValueError, IndexError):
        return False
    return hmac.compare_digest(actual, expected)


class User(models.Model):
    username = models.CharField(max_length=80, unique=True)
    email = models.CharField(max_length=255, unique=True, null=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=utcnow, null=True)

    class Meta:
        db_table = 'user'

    def set_password(self, password):
        self.password_hash = make_password(password)

    def check_password(self, password):
        if self.password_hash.startswith(('scrypt:', 'pbkdf2:')):
            if not check_werkzeug_password(self.password_hash, password):
                return False
            self.set_password(password)
            self.save(update_fields=['password_hash'])
            return True
        return check_password(password, self.password_hash)

    def session_version(self):
        # Changes whenever the password changes, which invalidates existing sessions
        key = settings.SECRET_KEY.encode()
        return hmac.new(key, self.password_hash.encode(), hashlib.sha256).hexdigest()[:16]


class ApiToken(models.Model):
    """A bearer token for a non-browser client (the Chrome extension).

    Only the sha256 of the token is stored, so a database leak doesn't hand out
    working credentials. `session_version` is snapshotted at issue time from
    User.session_version(), which means `manage.py reset_password` invalidates
    every outstanding token exactly as it already invalidates every session --
    no extra plumbing, one rule for both.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='api_tokens')
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    prefix = models.CharField(max_length=8)  # for display in the device list only
    device_name = models.CharField(max_length=80, null=True)
    session_version = models.CharField(max_length=32)
    created_at = models.DateTimeField(default=utcnow)
    last_used_at = models.DateTimeField(null=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)

    class Meta:
        db_table = 'api_token'

    def is_active(self):
        return (
            self.revoked_at is None
            and self.expires_at > utcnow()
            and self.session_version == self.user.session_version()
        )

    def to_dict(self):
        return {
            'id': self.id,
            'prefix': self.prefix,
            'device_name': self.device_name,
            'created_at': self.created_at.isoformat() + 'Z',
            'last_used_at': self.last_used_at.isoformat() + 'Z' if self.last_used_at else None,
            'expires_at': self.expires_at.isoformat() + 'Z',
        }
