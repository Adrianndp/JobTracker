import hashlib
import hmac
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models

MIN_PASSWORD_LENGTH = 8


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
