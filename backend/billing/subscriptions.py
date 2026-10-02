"""Keeping BillingAccount in step with Paddle.

Webhooks only say *that* a subscription changed. Each one is answered by
fetching the subscription's current state from Paddle, so events that arrive
late or out of order can't roll an account back to an old status.
"""

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from django.conf import settings
from django.db import transaction

from accounts.models import User, utcnow

from . import paddle
from .models import BillingAccount
from .plans import PAID_STATUSES

log = logging.getLogger(__name__)

# Subscriptions that still bill or may bill again; canceled is final.
LIVE_STATUSES = (*PAID_STATUSES, 'past_due', 'paused')


def _user_sig(user_id):
    message = f'billing-user:{user_id}'.encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()[:32]


def custom_data_for(user):
    """custom_data for a checkout, carried by Paddle onto the subscription.

    Signed: Paddle.js lets a browser open a checkout with any custom_data, and an
    unsigned user_id would let anyone attach their subscription (and with it
    their Paddle customer and its portal) to someone else's account.
    """
    return {'user_id': str(user.pk), 'user_sig': _user_sig(user.pk)}


def user_from_custom_data(data):
    if not isinstance(data, dict):
        return None
    user_id, sig = str(data.get('user_id', '')), str(data.get('user_sig', ''))
    if not user_id.isdigit() or not hmac.compare_digest(sig, _user_sig(user_id)):
        return None
    return User.objects.filter(pk=int(user_id)).first()


def parse_time(value):
    """Paddle's RFC 3339 timestamp as the naive UTC datetime the models use."""
    if not value:
        return None
    return datetime.fromisoformat(value).astimezone(timezone.utc).replace(tzinfo=None)


def _account_for(sub):
    accounts = BillingAccount.objects.select_for_update()
    account = accounts.filter(subscription_id=sub['id']).first()
    if account:
        return account
    user = user_from_custom_data(sub.get('custom_data'))
    if user:
        return accounts.get_or_create(user=user)[0]
    if sub.get('customer_id'):
        return accounts.filter(paddle_customer_id=sub['customer_id']).first()
    return None


@transaction.atomic
def apply_subscription(sub):
    """Store a Paddle subscription on its owner's account. The account, or None."""
    account = _account_for(sub)
    if account is None:
        log.warning('Paddle subscription %s matches no user', sub.get('id'))
        return None

    status = sub.get('status') or 'none'
    # Resubscribing makes a new subscription; late news about the old, canceled
    # one must not overwrite the live one.
    if (account.subscription_id and account.subscription_id != sub['id']
            and account.status in LIVE_STATUSES and status not in LIVE_STATUSES):
        return account

    customer_id = sub.get('customer_id')
    if customer_id and customer_id != account.paddle_customer_id:
        taken = BillingAccount.objects.filter(paddle_customer_id=customer_id).exclude(pk=account.pk).exists()
        if taken:
            log.warning('Paddle customer %s already belongs to another account', customer_id)
        else:
            account.paddle_customer_id = customer_id

    items = sub.get('items') or []
    period = sub.get('current_billing_period') or {}
    scheduled = sub.get('scheduled_change') or {}
    account.subscription_id = sub['id']
    account.status = status
    account.price_id = (items[0].get('price') or {}).get('id') if items else None
    account.current_period_end = parse_time(period.get('ends_at'))
    account.cancel_at_period_end = scheduled.get('action') == 'cancel'
    account.updated_at = utcnow()
    account.save()
    return account


def handle_event(event):
    """Act on one verified webhook event."""
    event_type = event.get('event_type') or ''
    data = event.get('data') or {}
    if event_type.startswith('subscription.'):
        subscription_id = data.get('id')
    elif event_type == 'transaction.completed':
        subscription_id = data.get('subscription_id')
    else:
        return
    if subscription_id:
        apply_subscription(paddle.get_subscription(subscription_id))


def cancel_for_deletion(user):
    """End a live subscription right away, before its account is deleted.

    Raises PaddleError if Paddle can't be reached, so the account isn't deleted
    while it would go on being charged.
    """
    account = BillingAccount.objects.filter(user=user).first()
    if account is None or not account.subscription_id or account.status not in LIVE_STATUSES:
        return
    if not settings.PADDLE_API_KEY:
        raise paddle.PaddleError('Billing is not configured on this server.')
    try:
        paddle.cancel_subscription_now(account.subscription_id)
    except paddle.PaddleError as error:
        # Already canceled at Paddle's end (e.g. from the portal) counts as done
        if error.status not in (400, 409, 422):
            raise
        sub = paddle.get_subscription(account.subscription_id)
        if sub.get('status') in LIVE_STATUSES:
            raise
