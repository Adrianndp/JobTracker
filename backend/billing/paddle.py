"""The few Paddle Billing API calls we need, over the standard library.

Paddle is the merchant of record: it sells the subscription, collects and files
EU VAT, and handles invoices and refunds. All we keep is which Paddle customer
and subscription belong to which user, and the subscription's status.

The SDK would add a dependency for four HTTP calls and an HMAC, so it's done by
hand here. API reference: https://developer.paddle.com/api-reference/overview
"""

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode

from django.conf import settings

API_HOSTS = {
    'sandbox': 'https://sandbox-api.paddle.com',
    'production': 'https://api.paddle.com',
}
TIMEOUT = 10
# How old a webhook's signed timestamp may be. Replays inside this window are
# still no-ops: each event is processed once by its event_id.
SIGNATURE_TOLERANCE = 5 * 60


class PaddleError(Exception):
    def __init__(self, message, status=None, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


def call(method, path, body=None):
    """The `data` of a Paddle API response. Raises PaddleError."""
    url = API_HOSTS[settings.PADDLE_ENVIRONMENT] + path
    request = urllib.request.Request(
        url,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            'Authorization': f'Bearer {settings.PADDLE_API_KEY}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read() or b'{}').get('data')
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read()).get('error') or {}
        except ValueError:
            detail = {}
        raise PaddleError(detail.get('detail') or f'Paddle answered {error.code}',
                          status=error.code, code=detail.get('code')) from error
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise PaddleError(f'Paddle is unreachable: {error}') from error


def create_transaction(price_id, custom_data, customer_id=None):
    """A draft transaction for Paddle.js to open as a checkout."""
    body = {'items': [{'price_id': price_id, 'quantity': 1}], 'custom_data': custom_data}
    if customer_id:
        body['customer_id'] = customer_id
    return call('POST', '/transactions', body)


def get_subscription(subscription_id, include=None):
    query = f'?include={include}' if include else ''
    return call('GET', f'/subscriptions/{subscription_id}{query}')


def preview_price(price_id, ip_address):
    """Price and tax for one item, localised from the buyer's IP address."""
    return call('POST', '/pricing-preview', {
        'items': [{'price_id': price_id, 'quantity': 1}],
        'customer_ip_address': ip_address,
    })


def completed_transactions(subscription_id, limit=5):
    """A subscription's paid transactions, newest first."""
    query = urlencode({
        'subscription_id': subscription_id,
        'status': 'completed',
        'order_by': 'billed_at[DESC]',
        'per_page': limit,
    })
    return call('GET', f'/transactions?{query}') or []


def get_transaction(transaction_id):
    return call('GET', f'/transactions/{transaction_id}')


def invoice_url(transaction_id):
    """A short-lived link to the invoice PDF Paddle issued for a transaction."""
    return call('GET', f'/transactions/{transaction_id}/invoice')['url']


def cancel_subscription_now(subscription_id):
    return call('POST', f'/subscriptions/{subscription_id}/cancel', {'effective_from': 'immediately'})


def portal_url(customer_id, subscription_id=None):
    """A short-lived link to Paddle's customer portal: cancel, change card, invoices."""
    body = {'subscription_ids': [subscription_id]} if subscription_id else {}
    data = call('POST', f'/customers/{customer_id}/portal-sessions', body)
    return data['urls']['general']['overview']


def verify_signature(raw_body, header, secret, now=None):
    """Whether a webhook's Paddle-Signature header ("ts=…;h1=…") signs raw_body.

    Paddle signs "<ts>:<raw body>" with HMAC-SHA256 and the notification
    destination's secret. While a secret is being rotated, more than one h1 can
    be present; any match counts.
    """
    if not secret or not header:
        return False
    parts = {}
    signatures = []
    for item in header.split(';'):
        key, _, value = item.partition('=')
        if key == 'h1':
            signatures.append(value)
        else:
            parts[key] = value
    try:
        ts = int(parts.get('ts', ''))
    except ValueError:
        return False
    if abs((now or time.time()) - ts) > SIGNATURE_TOLERANCE:
        return False
    expected = hmac.new(secret.encode(), f'{ts}:'.encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)
