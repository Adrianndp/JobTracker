import ipaddress
import json
import logging
import re

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from accounts import ratelimit
from accounts.auth import current_user
from accounts.models import utcnow
from config.views import read_json

from . import paddle
from .models import PaddleEvent
from .plans import (
    FREE_ACTIVE_LIMIT,
    PRICES,
    active_job_count,
    billing_account,
    is_paid,
    offered_prices,
    plan_for,
)
from .subscriptions import custom_data_for, handle_event

log = logging.getLogger(__name__)

# Each checkout creates a transaction at Paddle; nobody needs more than a few.
CHECKOUT_LIMIT, CHECKOUT_WINDOW = 10, 60 * 60
# Price previews and billing details are Paddle API calls too.
LOOKUP_LIMIT, LOOKUP_WINDOW = 60, 60 * 60
PREVIEW_CACHE_SECONDS = 60 * 60
# The id goes into a Paddle API path, so nothing but a transaction id may pass.
TRANSACTION_ID_RE = re.compile(r'txn_[a-z0-9]{10,64}')


def unavailable():
    return JsonResponse({'error': 'Billing is not available on this server.'}, status=404)


def paddle_failed(error):
    log.warning('Paddle call failed: %s', error)
    if error.status and 400 <= error.status < 500:
        # Paddle refused: our account setup (keys, prices, checkout settings), not an outage
        message = 'Checkout isn’t available right now. Please try again later or contact support.'
    else:
        message = 'The payment provider is not responding. Please try again shortly.'
    return JsonResponse({'error': message}, status=502)


class StatusView(View):
    def get(self, request):
        user = current_user(request)
        plan = plan_for(user)
        body = {
            'enabled': settings.BILLING_ENABLED,
            'plan': plan.name,
            'active_jobs': active_job_count(user),
            'active_limit': plan.active_limit,
        }
        if settings.BILLING_ENABLED:
            account = billing_account(user)
            body.update({
                'status': account.status if account else 'none',
                'complimentary': bool(account and account.complimentary),
                'cancel_at_period_end': bool(account and account.cancel_at_period_end),
                'current_period_end': (account.current_period_end.isoformat() + 'Z'
                                       if account and account.current_period_end else None),
                'can_manage': bool(account and account.paddle_customer_id),
                'prices': offered_prices(),
            })
        return JsonResponse(body)


class PlansView(View):
    """What's on sale, for the pricing page. Public: it's shown before sign-up."""

    def get(self, request):
        return JsonResponse({
            'enabled': settings.BILLING_ENABLED,
            'free_active_limit': FREE_ACTIVE_LIMIT,
            'prices': offered_prices() if settings.BILLING_ENABLED else [],
        })


def lookup_allowed(user):
    allowed, retry = ratelimit.hit('billinglookup', user.pk, LOOKUP_LIMIT, LOOKUP_WINDOW)
    if allowed:
        return None
    return JsonResponse({'error': f'Too many requests. Try again in {retry} seconds.'}, status=429)


def money(totals, key='grand_total', currency=None):
    """{'amount': cents, 'currency': 'EUR'} from a Paddle totals object, or None."""
    try:
        return {'amount': int((totals or {})[key]), 'currency': currency or totals['currency_code']}
    except (KeyError, TypeError, ValueError):
        return None


class PreviewView(View):
    """The price with tax for the buyer's country, for the review step.

    Paddle localises from the IP address. Unavailable (null) for private
    addresses -- development -- or when Paddle can't be reached; the page then
    shows the list price and lets the checkout show the final amount.
    """

    def get(self, request):
        if not settings.BILLING_ENABLED:
            return unavailable()
        key = request.GET.get('price', '')
        price_id = settings.PADDLE_PRICES.get(key)
        if not price_id:
            return JsonResponse({'error': 'Choose a plan.'}, status=400)

        ip = ratelimit.client_ip(request)
        try:
            public = ipaddress.ip_address(ip).is_global
        except ValueError:
            public = False
        if not public:
            return JsonResponse({'preview': None})

        cache_key = f'billing:preview:{price_id}:{ip}'
        preview = cache.get(cache_key)
        if preview is None:
            limited = lookup_allowed(current_user(request))
            if limited:
                return limited
            try:
                data = paddle.preview_price(price_id, ip)
            except paddle.PaddleError as error:
                log.info('Paddle price preview failed: %s', error)
                return JsonResponse({'preview': None})
            item = ((data.get('details') or {}).get('line_items') or [{}])[0]
            currency = data.get('currency_code')
            preview = {
                'total': money(item.get('totals'), 'total', currency),
                'tax': money(item.get('totals'), 'tax', currency),
                'tax_rate': item.get('tax_rate'),
                'country': (data.get('address') or {}).get('country_code'),
            }
            if preview['total'] is None:
                preview = {}
            cache.set(cache_key, preview, PREVIEW_CACHE_SECONDS)
        return JsonResponse({'preview': preview or None})


def payment_method(transactions):
    """How the latest payment was made: {'type', 'brand', 'last4'}, or None."""
    for txn in transactions:
        for payment in txn.get('payments') or []:
            details = payment.get('method_details') or {}
            card = details.get('card') or {}
            if details.get('type'):
                return {'type': details['type'], 'brand': card.get('type'), 'last4': card.get('last4')}
    return None


class DetailsView(View):
    """The subscription as Paddle has it: cycle, next payment, card, invoices.

    Read live from Paddle when the account dialog opens, rather than mirrored
    from webhooks: it's only for display, and Paddle is the source of truth.
    """

    def get(self, request):
        if not settings.BILLING_ENABLED:
            return unavailable()
        user = current_user(request)
        account = billing_account(user)
        if account is None or not account.subscription_id:
            return JsonResponse({'subscription': None})
        limited = lookup_allowed(user)
        if limited:
            return limited
        try:
            sub = paddle.get_subscription(account.subscription_id, include='next_transaction')
            transactions = paddle.completed_transactions(account.subscription_id)
        except paddle.PaddleError as error:
            return paddle_failed(error)

        cycle = sub.get('billing_cycle') or {}
        items = sub.get('items') or [{}]
        unit_price = (items[0].get('price') or {}).get('unit_price') or {}
        next_txn = (sub.get('next_transaction') or {}).get('details') or {}
        plan_key = next((k for k, v in settings.PADDLE_PRICES.items() if v == account.price_id), None)

        return JsonResponse({'subscription': {
            'plan': plan_key,
            'label': PRICES.get(plan_key, {}).get('label'),
            'status': sub.get('status'),
            'interval': cycle.get('interval'),
            'frequency': cycle.get('frequency'),
            'started_at': sub.get('started_at'),
            'next_billed_at': sub.get('next_billed_at'),
            'next_payment': (money(next_txn.get('totals'))
                             or money({'grand_total': unit_price.get('amount'),
                                       'currency_code': unit_price.get('currency_code')})),
            'cancel_at': ((sub.get('scheduled_change') or {}).get('effective_at')
                          if (sub.get('scheduled_change') or {}).get('action') == 'cancel' else None),
            'payment_method': payment_method(transactions),
            'invoices': [{
                'id': txn['id'],
                'number': txn.get('invoice_number'),
                'billed_at': txn.get('billed_at'),
                'total': money((txn.get('details') or {}).get('totals')),
            } for txn in transactions if txn.get('id')],
        }})


class InvoiceView(View):
    """A download link for one of your own invoices."""

    def get(self, request, transaction_id):
        if not settings.BILLING_ENABLED:
            return unavailable()
        user = current_user(request)
        account = billing_account(user)
        not_found = JsonResponse({'error': 'Invoice not found'}, status=404)
        if account is None or not account.subscription_id or not TRANSACTION_ID_RE.fullmatch(transaction_id):
            return not_found
        limited = lookup_allowed(user)
        if limited:
            return limited
        try:
            txn = paddle.get_transaction(transaction_id)
            # Only invoices for this account's own subscription or customer
            if (txn.get('subscription_id') != account.subscription_id
                    and (not account.paddle_customer_id or txn.get('customer_id') != account.paddle_customer_id)):
                return not_found
            return JsonResponse({'url': paddle.invoice_url(transaction_id)})
        except paddle.PaddleError as error:
            if error.status == 404:
                return not_found
            return paddle_failed(error)


class CheckoutView(View):
    """A Paddle transaction for the browser to open with Paddle.js."""

    def post(self, request):
        if not settings.BILLING_ENABLED:
            return unavailable()
        user = current_user(request)
        price_id = settings.PADDLE_PRICES.get(read_json(request).get('price'))
        if not price_id:
            return JsonResponse({'error': 'Choose a plan.'}, status=400)

        account = billing_account(user)
        if is_paid(account):
            return JsonResponse({'error': 'You already have Pro. Use Manage billing to change it.'}, status=409)

        allowed, retry = ratelimit.hit('checkout', user.pk, CHECKOUT_LIMIT, CHECKOUT_WINDOW)
        if not allowed:
            return JsonResponse({'error': f'Too many attempts. Try again in {retry} seconds.'}, status=429)

        try:
            txn = paddle.create_transaction(
                price_id, custom_data_for(user), account.paddle_customer_id if account else None)
        except paddle.PaddleError as error:
            return paddle_failed(error)
        return JsonResponse({
            'transaction_id': txn['id'],
            'client_token': settings.PADDLE_CLIENT_TOKEN,
            'environment': settings.PADDLE_ENVIRONMENT,
            # Prefills the checkout; Paddle asks for it when there's no customer yet
            'email': None if account and account.paddle_customer_id else user.email,
        })


class PortalView(View):
    """A link to Paddle's customer portal: cancel, switch plan, card, invoices."""

    def post(self, request):
        if not settings.BILLING_ENABLED:
            return unavailable()
        account = billing_account(current_user(request))
        if account is None or not account.paddle_customer_id:
            return JsonResponse({'error': 'There is no subscription to manage yet.'}, status=404)
        try:
            url = paddle.portal_url(account.paddle_customer_id, account.subscription_id)
        except paddle.PaddleError as error:
            return paddle_failed(error)
        return JsonResponse({'url': url})


@method_decorator(csrf_exempt, name='dispatch')
class WebhookView(View):
    """Paddle's notifications. Public: the signature is the authentication.

    csrf_exempt because Paddle's servers post here without a cookie or token;
    a forged request fails the HMAC check on the raw body instead.
    """

    def post(self, request):
        signature = request.headers.get('Paddle-Signature', '')
        if not paddle.verify_signature(request.body, signature, settings.PADDLE_WEBHOOK_SECRET):
            return JsonResponse({'error': 'Bad signature'}, status=400)
        try:
            event = json.loads(request.body)
            event_id = str(event['event_id'])
        except (ValueError, KeyError, TypeError):
            return JsonResponse({'error': 'Bad payload'}, status=400)

        try:
            with transaction.atomic():
                _, created = PaddleEvent.objects.get_or_create(
                    event_id=event_id,
                    defaults={'event_type': str(event.get('event_type', ''))[:64], 'processed_at': utcnow()},
                )
                if created:
                    handle_event(event)
        except paddle.PaddleError as error:
            # Rolled back, event row included, so Paddle's retry processes it again
            log.warning('Paddle event %s not processed: %s', event_id, error)
            return JsonResponse({'error': 'Try again later'}, status=503)
        return HttpResponse(status=200)

