import hmac
from datetime import datetime, timezone

from django.contrib.auth.models import AbstractUser
from django.db import models


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(AbstractUser):
    """Django's standard user, on the table the hand-rolled model always used.

    Keeping db_table and the model's name means Job.user and ApiToken.user never
    had to move: migration 0003 only renamed two columns and added AbstractUser's.
    Email is unique (allauth logs in with it); username is the display name.
    """

    email = models.EmailField(unique=True)

    class Meta:
        db_table = 'user'


class ApiToken(models.Model):
    """A bearer token for a non-browser client (the Chrome extension).

    Only the sha256 of the token is stored, so a database leak doesn't hand out
    working credentials. `session_version` is snapshotted at issue time from
    User.get_session_auth_hash() -- the value Django checks to end sessions after
    a password change -- so a new password invalidates every outstanding token
    exactly as it invalidates every session. One rule for both.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='api_tokens')
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    prefix = models.CharField(max_length=8)  # for display in the device list only
    device_name = models.CharField(max_length=80, null=True)
    session_version = models.CharField(max_length=128)
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
            and hmac.compare_digest(self.session_version, self.user.get_session_auth_hash())
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
