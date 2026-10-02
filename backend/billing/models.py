from django.db import models

from accounts.models import utcnow


class BillingAccount(models.Model):
    """A user's subscription, as Paddle last reported it.

    Kept apart from accounts.User so billing can never disturb the auth tables.
    Rows are created by the first checkout (or `manage.py billing_comp`), so a
    user without one is on the free plan.
    """

    user = models.OneToOneField('accounts.User', on_delete=models.CASCADE, related_name='billing')
    paddle_customer_id = models.CharField(max_length=64, unique=True, null=True)
    subscription_id = models.CharField(max_length=64, unique=True, null=True)
    # Paddle's subscription status: active, trialing, past_due, paused, canceled
    status = models.CharField(max_length=20, default='none')
    price_id = models.CharField(max_length=64, null=True)
    current_period_end = models.DateTimeField(null=True)
    cancel_at_period_end = models.BooleanField(default=False)
    # Pro without paying: your own account, friends, testers.
    complimentary = models.BooleanField(default=False)
    updated_at = models.DateTimeField(default=utcnow)

    class Meta:
        db_table = 'billing_account'


class PaddleEvent(models.Model):
    """Webhook events already processed. Paddle retries, so each runs once."""

    event_id = models.CharField(max_length=64, unique=True)
    event_type = models.CharField(max_length=64)
    processed_at = models.DateTimeField(default=utcnow)

    class Meta:
        db_table = 'billing_paddle_event'
