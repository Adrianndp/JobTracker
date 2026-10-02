"""What each plan allows. Views ask plan_for(user); nothing else decides.

Free: up to FREE_ACTIVE_LIMIT *active* applications -- jobs still in To Be
Applied, Applied or In Interview. Moving a job to Rejected, Offer or Ghosted
frees its place, so the board's history never counts against you. Jobs over the
limit are never deleted or hidden; only adding (or reviving) one is blocked.

Pro: no limit. Without Paddle configured (development, self-hosting) there is no
billing and so no limit either.
"""

from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings

from accounts.models import utcnow
from jobs.models import Job

ACTIVE_STATUSES = ('to_be_applied', 'applied', 'in_interview')
FREE_ACTIVE_LIMIT = 30
# Paddle retries a failed renewal for a while before it cancels; keep Pro
# meanwhile, but not forever if the webhooks stop arriving.
PAST_DUE_GRACE = timedelta(days=14)
# Paddle statuses that mean the subscription is paid up.
PAID_STATUSES = ('active', 'trialing')
# What the pricing page shows. Keep in step with the prices set up in Paddle,
# which should be tax-inclusive (German consumers must be shown gross prices);
# the checkout always shows the real amount for the buyer's country.
# amount is in cents.
PRICES = {
    'monthly': {'amount': 700, 'currency': 'EUR', 'months': 1, 'label': '€7 / month'},
    'quarterly': {'amount': 1900, 'currency': 'EUR', 'months': 3, 'label': '€19 / 3 months'},
}


@dataclass(frozen=True)
class Plan:
    name: str  # 'free' | 'pro' | 'unlimited' (billing off)
    active_limit: int | None


FREE = Plan('free', FREE_ACTIVE_LIMIT)
PRO = Plan('pro', None)
UNLIMITED = Plan('unlimited', None)


def is_paid(account, now=None):
    if account is None:
        return False
    if account.complimentary or account.status in PAID_STATUSES:
        return True
    if account.status == 'past_due' and account.current_period_end:
        return (now or utcnow()) < account.current_period_end + PAST_DUE_GRACE
    return False


def offered_prices():
    """The plans on sale: those with a Paddle price configured."""
    return [{'id': key, **PRICES[key]} for key in settings.PADDLE_PRICES if key in PRICES]


def billing_account(user):
    from .models import BillingAccount
    return BillingAccount.objects.filter(user=user).first()


def plan_for(user):
    if not settings.BILLING_ENABLED:
        return UNLIMITED
    return PRO if is_paid(billing_account(user)) else FREE


def active_job_count(user):
    return Job.objects.filter(user=user, status__in=ACTIVE_STATUSES).count()


def active_limit_error(user):
    """None if the user may add one more active job, else the 402 body."""
    limit = plan_for(user).active_limit
    if limit is None or active_job_count(user) < limit:
        return None
    return {
        'error': (f'The free plan tracks up to {limit} active applications. Move finished ones '
                  'to Rejected, Offer or Ghosted, or upgrade to Pro for unlimited.'),
        'code': 'plan_limit',
        'limit': limit,
    }
