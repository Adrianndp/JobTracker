import hashlib
import hmac
import json
import time
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

from accounts import tokens
from accounts.models import User, utcnow
from jobs.models import Job

from . import paddle
from .models import BillingAccount, PaddleEvent
from .plans import FREE_ACTIVE_LIMIT, is_paid
from .subscriptions import custom_data_for, user_from_custom_data

JSON = 'application/json'
SECRET = 'pdl_ntfset_test_secret'
BILLING = {
    'PADDLE_API_KEY': 'test-key',
    'PADDLE_CLIENT_TOKEN': 'test_client_token',
    'PADDLE_WEBHOOK_SECRET': SECRET,
    'PADDLE_PRICES': {'monthly': 'pri_monthly', 'quarterly': 'pri_quarterly'},
    'BILLING_ENABLED': True,
}


def signed(body, secret=SECRET, ts=None):
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f'{ts}:'.encode() + body, hashlib.sha256).hexdigest()
    return f'ts={ts};h1={sig}'


def subscription(user, sub_id='sub_1', status='active', **extra):
    return {
        'id': sub_id,
        'status': status,
        'customer_id': 'ctm_1',
        'custom_data': custom_data_for(user),
        'items': [{'price': {'id': 'pri_monthly'}}],
        'current_billing_period': {'ends_at': '2030-01-01T00:00:00.000000Z'},
        'scheduled_change': None,
        **extra,
    }


@override_settings(**BILLING)
class BillingTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('alice', 'alice@example.com', 'correct-horse-battery-9')
        self.token, _ = tokens.issue(self.user)
        self.c = Client()

    def call(self, method, path, body=None):
        kwargs = {'content_type': JSON, 'HTTP_AUTHORIZATION': f'Bearer {self.token}'}
        if body is not None:
            kwargs['data'] = json.dumps(body)
        return getattr(self.c, method)(path, **kwargs)

    def add_jobs(self, count, status='to_be_applied'):
        Job.objects.bulk_create(Job(user=self.user, name=f'Job {i}', company='Co', status=status)
                                for i in range(count))

    def webhook(self, event, signature=None):
        body = json.dumps(event).encode()
        return self.c.post('/api/billing/webhook', data=body, content_type=JSON,
                           HTTP_PADDLE_SIGNATURE=signature or signed(body))


class FreePlanLimitTests(BillingTestCase):
    def test_free_plan_blocks_the_next_active_job(self):
        self.add_jobs(FREE_ACTIVE_LIMIT)
        r = self.call('post', '/api/jobs', {'name': 'One more', 'company': 'Co'})
        self.assertEqual(r.status_code, 402)
        self.assertEqual(r.json()['code'], 'plan_limit')

    def test_finished_jobs_do_not_count(self):
        self.add_jobs(FREE_ACTIVE_LIMIT - 1)
        self.add_jobs(20, status='rejected')
        r = self.call('post', '/api/jobs', {'name': 'One more', 'company': 'Co'})
        self.assertEqual(r.status_code, 201)

    def test_reviving_a_finished_job_counts_as_adding_one(self):
        self.add_jobs(FREE_ACTIVE_LIMIT)
        job = Job.objects.create(user=self.user, name='Old', company='Co', status='ghosted')
        self.assertEqual(self.call('patch', f'/api/jobs/{job.id}', {'status': 'applied'}).status_code, 402)
        # Moving between active columns, or editing, is always allowed
        active = Job.objects.filter(user=self.user, status='to_be_applied').first()
        self.assertEqual(self.call('patch', f'/api/jobs/{active.id}', {'status': 'applied'}).status_code, 200)
        self.assertEqual(self.call('patch', f'/api/jobs/{job.id}', {'name': 'Renamed'}).status_code, 200)

    def test_pro_has_no_limit(self):
        BillingAccount.objects.create(user=self.user, status='active', subscription_id='sub_1')
        self.add_jobs(FREE_ACTIVE_LIMIT)
        self.assertEqual(self.call('post', '/api/jobs', {'name': 'More', 'company': 'Co'}).status_code, 201)

    def test_complimentary_pro_from_the_command(self):
        self.add_jobs(FREE_ACTIVE_LIMIT)
        call_command('billing_comp', 'ALICE@example.com', stdout=mock.Mock())
        self.assertEqual(self.call('post', '/api/jobs', {'name': 'More', 'company': 'Co'}).status_code, 201)

    @override_settings(BILLING_ENABLED=False)
    def test_no_limit_without_billing(self):
        self.add_jobs(FREE_ACTIVE_LIMIT)
        self.assertEqual(self.call('post', '/api/jobs', {'name': 'More', 'company': 'Co'}).status_code, 201)
        self.assertEqual(self.call('get', '/api/billing/status').json()['plan'], 'unlimited')


class PlanStatusTests(TestCase):
    def test_past_due_keeps_pro_during_the_grace_period(self):
        account = BillingAccount(status='past_due', current_period_end=utcnow() - timedelta(days=3))
        self.assertTrue(is_paid(account))
        account.current_period_end = utcnow() - timedelta(days=30)
        self.assertFalse(is_paid(account))

    def test_canceled_and_paused_are_free(self):
        self.assertFalse(is_paid(BillingAccount(status='canceled')))
        self.assertFalse(is_paid(BillingAccount(status='paused')))


class StatusAndCheckoutTests(BillingTestCase):
    def test_status_reports_usage(self):
        self.add_jobs(3)
        data = self.call('get', '/api/billing/status').json()
        self.assertEqual((data['plan'], data['active_jobs'], data['active_limit']), ('free', 3, FREE_ACTIVE_LIMIT))
        self.assertEqual([p['id'] for p in data['prices']], ['monthly', 'quarterly'])

    def test_checkout_creates_a_signed_transaction(self):
        with mock.patch.object(paddle, 'call', return_value={'id': 'txn_1'}) as call:
            r = self.call('post', '/api/billing/checkout', {'price': 'quarterly'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['transaction_id'], 'txn_1')
        method, path, body = call.call_args.args
        self.assertEqual((method, path), ('POST', '/transactions'))
        self.assertEqual(body['items'], [{'price_id': 'pri_quarterly', 'quantity': 1}])
        self.assertEqual(user_from_custom_data(body['custom_data']), self.user)

    def test_checkout_rejects_unknown_prices(self):
        self.assertEqual(self.call('post', '/api/billing/checkout', {'price': 'pri_free'}).status_code, 400)

    def test_checkout_refused_when_already_pro(self):
        BillingAccount.objects.create(user=self.user, status='active')
        self.assertEqual(self.call('post', '/api/billing/checkout', {'price': 'monthly'}).status_code, 409)

    def test_paddle_outage_is_a_502(self):
        with mock.patch.object(paddle, 'call', side_effect=paddle.PaddleError('down')):
            self.assertEqual(self.call('post', '/api/billing/checkout', {'price': 'monthly'}).status_code, 502)

    def test_billing_needs_sign_in(self):
        self.assertEqual(Client().get('/api/billing/status').status_code, 401)


class CustomDataTests(BillingTestCase):
    def test_forged_user_id_is_ignored(self):
        self.assertIsNone(user_from_custom_data({'user_id': str(self.user.pk), 'user_sig': 'x' * 32}))
        self.assertIsNone(user_from_custom_data({'user_id': str(self.user.pk)}))
        self.assertIsNone(user_from_custom_data('nope'))


class WebhookTests(BillingTestCase):
    def event(self, event_type='subscription.created', event_id='evt_1', data=None):
        return {'event_id': event_id, 'event_type': event_type, 'data': data or {'id': 'sub_1'}}

    def test_subscription_event_activates_pro(self):
        with mock.patch.object(paddle, 'get_subscription', return_value=subscription(self.user)) as get:
            r = self.webhook(self.event())
        self.assertEqual(r.status_code, 200)
        get.assert_called_once_with('sub_1')
        account = BillingAccount.objects.get(user=self.user)
        self.assertEqual((account.status, account.paddle_customer_id, account.price_id),
                         ('active', 'ctm_1', 'pri_monthly'))

    def test_duplicate_event_is_a_no_op(self):
        with mock.patch.object(paddle, 'get_subscription', return_value=subscription(self.user)) as get:
            self.webhook(self.event())
            self.assertEqual(self.webhook(self.event()).status_code, 200)
        self.assertEqual(get.call_count, 1)

    def test_out_of_order_events_use_the_current_state(self):
        """A late "created" after "canceled" re-reads Paddle, which says canceled."""
        canceled = subscription(self.user, status='canceled')
        with mock.patch.object(paddle, 'get_subscription', return_value=canceled):
            self.webhook(self.event('subscription.canceled', 'evt_2'))
            self.webhook(self.event('subscription.created', 'evt_1'))
        self.assertEqual(BillingAccount.objects.get(user=self.user).status, 'canceled')

    def test_old_subscription_does_not_override_a_new_one(self):
        BillingAccount.objects.create(user=self.user, status='active', subscription_id='sub_2')
        old = subscription(self.user, sub_id='sub_1', status='canceled')
        with mock.patch.object(paddle, 'get_subscription', return_value=old):
            self.webhook(self.event('subscription.canceled'))
        account = BillingAccount.objects.get(user=self.user)
        self.assertEqual((account.subscription_id, account.status), ('sub_2', 'active'))

    def test_scheduled_cancel_is_recorded(self):
        sub = subscription(self.user, scheduled_change={'action': 'cancel', 'effective_at': '2030-01-01T00:00:00Z'})
        with mock.patch.object(paddle, 'get_subscription', return_value=sub):
            self.webhook(self.event('subscription.updated'))
        account = BillingAccount.objects.get(user=self.user)
        self.assertTrue(account.cancel_at_period_end)
        self.assertTrue(is_paid(account))

    def test_bad_signature_is_rejected(self):
        body = json.dumps(self.event()).encode()
        self.assertEqual(self.webhook(self.event(), signature=signed(body, secret='wrong')).status_code, 400)
        self.assertEqual(self.webhook(self.event(), signature='ts=1;h1=abc').status_code, 400)
        self.assertFalse(PaddleEvent.objects.exists())

    def test_stale_signature_is_rejected(self):
        body = json.dumps(self.event()).encode()
        old = signed(body, ts=int(time.time()) - 3600)
        self.assertEqual(self.webhook(self.event(), signature=old).status_code, 400)

    def test_paddle_outage_rolls_back_so_the_retry_works(self):
        with mock.patch.object(paddle, 'get_subscription', side_effect=paddle.PaddleError('down')):
            self.assertEqual(self.webhook(self.event()).status_code, 503)
        self.assertFalse(PaddleEvent.objects.exists())
        with mock.patch.object(paddle, 'get_subscription', return_value=subscription(self.user)):
            self.assertEqual(self.webhook(self.event()).status_code, 200)
        self.assertEqual(BillingAccount.objects.get(user=self.user).status, 'active')

    def test_unrelated_events_are_acknowledged(self):
        with mock.patch.object(paddle, 'get_subscription') as get:
            self.assertEqual(self.webhook(self.event('customer.created')).status_code, 200)
        get.assert_not_called()

    def test_portal_link(self):
        BillingAccount.objects.create(user=self.user, status='active', subscription_id='sub_1',
                                      paddle_customer_id='ctm_1')
        data = {'urls': {'general': {'overview': 'https://customer-portal.paddle.com/x'}}}
        with mock.patch.object(paddle, 'call', return_value=data) as call:
            r = self.call('post', '/api/billing/portal')
        self.assertEqual(r.json()['url'], 'https://customer-portal.paddle.com/x')
        self.assertEqual(call.call_args.args[1], '/customers/ctm_1/portal-sessions')


class SignatureTests(TestCase):
    def test_any_of_several_signatures_counts(self):
        body = b'{}'
        ts = int(time.time())
        good = signed(body, ts=ts).split(';h1=')[1]
        self.assertTrue(paddle.verify_signature(body, f'ts={ts};h1=nope;h1={good}', SECRET))

    def test_missing_secret_never_verifies(self):
        self.assertFalse(paddle.verify_signature(b'{}', signed(b'{}'), ''))


class PricingPageTests(BillingTestCase):
    def test_plans_are_public(self):
        data = Client().get('/api/billing/plans').json()
        self.assertTrue(data['enabled'])
        self.assertEqual(data['free_active_limit'], FREE_ACTIVE_LIMIT)
        self.assertEqual([(p['id'], p['amount'], p['months']) for p in data['prices']],
                         [('monthly', 700, 1), ('quarterly', 1900, 3)])

    @override_settings(BILLING_ENABLED=False)
    def test_plans_without_billing(self):
        self.assertEqual(Client().get('/api/billing/plans').json()['prices'], [])

    def test_preview_skips_private_addresses(self):
        with mock.patch.object(paddle, 'call') as call:
            r = self.call('get', '/api/billing/preview?price=monthly')
        self.assertEqual(r.json(), {'preview': None})
        call.assert_not_called()

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_preview_localises_and_is_cached(self):
        data = {'currency_code': 'EUR', 'address': {'country_code': 'DE'},
                'details': {'line_items': [{'tax_rate': '0.19', 'totals': {'total': '700', 'tax': '112'}}]}}
        with mock.patch.object(paddle, 'call', return_value=data) as call:
            for _ in range(2):
                r = self.c.get('/api/billing/preview?price=monthly', HTTP_AUTHORIZATION=f'Bearer {self.token}',
                               HTTP_X_FORWARDED_FOR='81.2.69.142')
        self.assertEqual(r.json()['preview'], {
            'total': {'amount': 700, 'currency': 'EUR'}, 'tax': {'amount': 112, 'currency': 'EUR'},
            'tax_rate': '0.19', 'country': 'DE'})
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.args[2]['customer_ip_address'], '81.2.69.142')


class BillingDetailsTests(BillingTestCase):
    def setUp(self):
        super().setUp()
        BillingAccount.objects.create(user=self.user, status='active', subscription_id='sub_1',
                                      paddle_customer_id='ctm_1', price_id='pri_quarterly')

    def test_details_from_paddle(self):
        sub = {'status': 'active', 'billing_cycle': {'interval': 'month', 'frequency': 3},
               'next_billed_at': '2030-01-01T00:00:00Z', 'items': [{'price': {'unit_price': {'amount': '1900', 'currency_code': 'EUR'}}}],
               'next_transaction': {'details': {'totals': {'grand_total': '1900', 'currency_code': 'EUR'}}}}
        txns = [{'id': 'txn_01abcdefghij', 'invoice_number': '123-1', 'billed_at': '2029-10-01T00:00:00Z',
                 'details': {'totals': {'grand_total': '1900', 'currency_code': 'EUR'}},
                 'payments': [{'method_details': {'type': 'card', 'card': {'type': 'visa', 'last4': '4242'}}}]}]
        with mock.patch.object(paddle, 'get_subscription', return_value=sub), \
                mock.patch.object(paddle, 'completed_transactions', return_value=txns):
            data = self.call('get', '/api/billing/details').json()['subscription']
        self.assertEqual((data['plan'], data['frequency'], data['next_payment']),
                         ('quarterly', 3, {'amount': 1900, 'currency': 'EUR'}))
        self.assertEqual(data['payment_method'], {'type': 'card', 'brand': 'visa', 'last4': '4242'})
        self.assertEqual(data['invoices'][0]['number'], '123-1')

    def test_no_subscription(self):
        BillingAccount.objects.filter(user=self.user).update(subscription_id=None)
        self.assertEqual(self.call('get', '/api/billing/details').json(), {'subscription': None})

    def test_invoice_of_own_subscription(self):
        with mock.patch.object(paddle, 'get_transaction', return_value={'subscription_id': 'sub_1'}), \
                mock.patch.object(paddle, 'invoice_url', return_value='https://paddle/invoice.pdf'):
            r = self.call('get', '/api/billing/invoices/txn_01abcdefghij')
        self.assertEqual(r.json()['url'], 'https://paddle/invoice.pdf')

    def test_someone_elses_invoice_is_not_found(self):
        other = {'subscription_id': 'sub_other', 'customer_id': 'ctm_other'}
        with mock.patch.object(paddle, 'get_transaction', return_value=other), \
                mock.patch.object(paddle, 'invoice_url') as url:
            self.assertEqual(self.call('get', '/api/billing/invoices/txn_01abcdefghij').status_code, 404)
        url.assert_not_called()

    def test_invoice_id_cannot_reach_other_paddle_endpoints(self):
        with mock.patch.object(paddle, 'call') as call:
            for bad in ('..%2Fcustomers', 'ctm_1', 'txn_1%3Fx%3D1'):
                self.assertEqual(self.call('get', f'/api/billing/invoices/{bad}').status_code, 404)
        call.assert_not_called()
