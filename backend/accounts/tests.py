import json
import re
from datetime import timedelta
from unittest import mock

from allauth.account.models import EmailAddress
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from . import tokens
from .models import ApiToken, User, utcnow

PASSWORD = 'correct-horse-battery-9'
JSON = 'application/json'
ALLAUTH = '/api/_allauth/browser/v1'
CODE_RE = re.compile(r'^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$', re.M)


def api(client, method, path, body=None, **extra):
    kwargs = {'content_type': JSON, **extra}
    if body is not None:
        kwargs['data'] = json.dumps(body)
    return getattr(client, method)(path, **kwargs)


def last_code():
    return CODE_RE.search(mail.outbox[-1].body).group(1)


class AuthTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User(username='adrian', email='a@example.com')
        self.user.set_password(PASSWORD)
        self.user.save()
        EmailAddress.objects.create(user=self.user, email=self.user.email, primary=True, verified=True)

    def bearer(self):
        raw, _ = tokens.issue(self.user, 'test-device')
        return raw

    def login(self, client, email='a@example.com', password=PASSWORD, **extra):
        return api(client, 'post', f'{ALLAUTH}/auth/login', {'email': email, 'password': password}, **extra)


class SignupTests(TestCase):
    """Sign-up is open to anyone, and an account is only usable once its email is verified."""

    def setUp(self):
        cache.clear()
        self.c = Client()

    def signup(self, **body):
        return api(self.c, 'post', f'{ALLAUTH}/auth/signup',
                   {'email': 'n@example.com', 'username': 'new', 'password': PASSWORD, **body})

    def test_anyone_can_sign_up_and_verify(self):
        User.objects.create_user('existing', 'e@example.com', PASSWORD)
        r = self.signup()
        self.assertEqual(r.status_code, 401)  # signed up, verification pending
        self.assertFalse(self.c.get('/api/auth/status').json()['authenticated'])

        r = api(self.c, 'post', f'{ALLAUTH}/auth/email/verify', {'key': last_code()})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get('/api/auth/status').json(), {'authenticated': True, 'username': 'new'})
        self.assertEqual(self.c.get('/api/jobs').json(), [])

    def test_wrong_code_is_rejected(self):
        self.signup()
        r = api(self.c, 'post', f'{ALLAUTH}/auth/email/verify', {'key': 'AAAA-AAAA'})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(self.c.get('/api/auth/status').json()['authenticated'])

    def test_short_password_is_rejected(self):
        self.assertEqual(self.signup(password='short1!').status_code, 400)
        self.assertFalse(User.objects.exists())

    def test_common_password_is_rejected(self):
        self.assertEqual(self.signup(password='password123').status_code, 400)

    def test_numeric_password_is_rejected(self):
        self.assertEqual(self.signup(password='1234567890123').status_code, 400)

    def test_duplicate_email_does_not_create_a_second_account(self):
        self.signup()
        Client().post(f'{ALLAUTH}/auth/signup', data=json.dumps(
            {'email': 'N@example.com', 'username': 'other', 'password': PASSWORD}), content_type=JSON)
        self.assertEqual(User.objects.count(), 1)


class LoginTests(AuthTestCase):
    def test_login_with_email_case_insensitive(self):
        c = Client()
        self.assertEqual(self.login(c, email='A@Example.com').status_code, 200)
        self.assertEqual(c.get('/api/jobs').status_code, 200)

    def test_wrong_password_is_rejected(self):
        c = Client()
        self.assertEqual(self.login(c, password='wrong-password-1').status_code, 400)
        self.assertEqual(c.get('/api/jobs').status_code, 401)

    def test_unverified_email_cannot_reach_the_board(self):
        EmailAddress.objects.update(verified=False)
        c = Client()
        self.assertEqual(self.login(c).status_code, 401)  # verify_email flow pending
        self.assertEqual(c.get('/api/jobs').status_code, 401)

    def test_inactive_user_cannot_log_in(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        c = Client()
        self.login(c)
        self.assertEqual(c.get('/api/jobs').status_code, 401)

    def test_password_change_ends_existing_sessions(self):
        c = Client()
        self.login(c)
        self.user.set_password('a-totally-different-one-42')
        self.user.save(update_fields=['password'])
        self.assertEqual(c.get('/api/jobs').status_code, 401)

    def test_password_reset_by_code(self):
        c = Client()
        self.assertEqual(api(c, 'post', f'{ALLAUTH}/auth/password/request', {'email': 'a@example.com'}).status_code, 401)
        r = api(c, 'post', f'{ALLAUTH}/auth/password/reset',
                {'key': last_code(), 'password': 'a-brand-new-password-5'})
        self.assertIn(r.status_code, (200, 401))
        self.assertEqual(self.login(Client(), password='a-brand-new-password-5').status_code, 200)


class LogoutTests(AuthTestCase):
    def test_logout_requires_authentication(self):
        """It used to be public, which let any site sign the user out."""
        self.assertEqual(api(Client(), 'post', '/api/auth/logout').status_code, 401)

    def test_session_logout_ends_the_session(self):
        c = Client()
        self.login(c)
        self.assertEqual(api(c, 'post', '/api/auth/logout').status_code, 204)
        self.assertFalse(c.get('/api/auth/status').json()['authenticated'])

    def test_bearer_logout_revokes_only_that_token(self):
        keep = self.bearer()
        drop = self.bearer()
        c = Client()
        self.assertEqual(
            api(c, 'post', '/api/auth/logout', HTTP_AUTHORIZATION=f'Bearer {drop}').status_code, 204)
        self.assertEqual(c.get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {drop}').status_code, 401)
        self.assertEqual(c.get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {keep}').status_code, 200)


class TokenTests(AuthTestCase):
    def token_login(self, email='a@example.com', password=PASSWORD, **extra):
        return api(Client(), 'post', '/api/auth/token',
                   {'email': email, 'password': password, 'device_name': 'chrome'}, **extra)

    def test_issue_and_use(self):
        r = self.token_login()
        self.assertEqual(r.status_code, 201)
        raw = r.json()['token']
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 200)

    def test_unverified_email_gets_no_token(self):
        EmailAddress.objects.update(verified=False)
        self.assertEqual(self.token_login().status_code, 403)
        self.assertFalse(ApiToken.objects.exists())

    def test_wrong_password_does_not_reveal_verification_state(self):
        EmailAddress.objects.update(verified=False)
        self.assertEqual(self.token_login(password='wrong-password-1').status_code, 401)

    def test_raw_token_is_not_stored(self):
        raw = self.bearer()
        self.assertFalse(ApiToken.objects.filter(token_hash=raw).exists())
        self.assertTrue(ApiToken.objects.filter(token_hash=tokens.hash_token(raw)).exists())

    def test_unknown_token_is_rejected(self):
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION='Bearer nope').status_code, 401)

    def test_expired_token_is_rejected(self):
        raw = self.bearer()
        ApiToken.objects.update(expires_at=utcnow() - timedelta(seconds=1))
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 401)

    def test_password_change_invalidates_tokens(self):
        """Same rule as sessions: session_version is snapshotted at issue time."""
        raw = self.bearer()
        self.user.set_password('a-totally-different-one-42')
        self.user.save(update_fields=['password'])
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 401)

    def test_bad_bearer_does_not_fall_back_to_cookie(self):
        c = Client()
        self.login(c)
        self.assertEqual(c.get('/api/jobs', HTTP_AUTHORIZATION='Bearer nope').status_code, 401)

    def test_list_and_revoke_devices(self):
        raw = self.bearer()
        c = Client()
        listed = c.get('/api/auth/tokens', HTTP_AUTHORIZATION=f'Bearer {raw}').json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['device_name'], 'test-device')
        self.assertNotIn('token_hash', listed[0])

        r = c.delete(f'/api/auth/tokens/{listed[0]["id"]}', HTTP_AUTHORIZATION=f'Bearer {raw}')
        self.assertEqual(r.status_code, 204)
        self.assertEqual(c.get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 401)


@override_settings(TRUSTED_PROXY_COUNT=1)
class TokenThrottleTests(AuthTestCase):
    def fail(self, ip):
        return api(Client(), 'post', '/api/auth/token',
                   {'email': 'a@example.com', 'password': 'wrong'}, HTTP_X_FORWARDED_FOR=ip)

    def test_repeated_failures_from_one_client_are_locked_out(self):
        codes = [self.fail('203.0.113.9').status_code for _ in range(6)]
        self.assertEqual(codes, [401, 401, 401, 401, 401, 429])

    def test_another_client_is_not_locked_out(self):
        """Keying on the proxy address would let one attacker lock everybody out."""
        for _ in range(5):
            self.fail('203.0.113.9')
        self.assertEqual(self.fail('198.51.100.4').status_code, 401)

    def test_success_clears_the_counter(self):
        for _ in range(4):
            self.fail('203.0.113.9')
        ok = api(Client(), 'post', '/api/auth/token',
                 {'email': 'a@example.com', 'password': PASSWORD}, HTTP_X_FORWARDED_FOR='203.0.113.9')
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(self.fail('203.0.113.9').status_code, 401)

    @override_settings(TRUSTED_PROXY_COUNT=0)
    def test_forwarded_for_is_ignored_when_untrusted(self):
        """Otherwise anyone spoofs a fresh client on every attempt."""
        codes = [self.fail(f'10.0.0.{i}').status_code for i in range(6)]
        self.assertEqual(codes[-1], 429)


class LoginThrottleTests(AuthTestCase):
    def test_allauth_login_is_rate_limited(self):
        """5 failures per email per 5 minutes; allauth reports it as a 400 with its own code."""
        for _ in range(5):
            self.login(Client(), password='wrong-password-1')
        r = self.login(Client())  # even the right password is refused now
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['errors'][0]['code'], 'too_many_login_attempts')


class CsrfTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client(enforce_csrf_checks=True)

    def csrf(self):
        self.c.get('/api/auth/status')  # sets the csrftoken cookie
        return self.c.cookies['csrftoken'].value

    def csrf_login(self):
        self.login(self.c, HTTP_X_CSRFTOKEN=self.csrf())
        return self.c.cookies['csrftoken'].value  # api.ts re-reads the cookie per request

    def test_status_sets_the_csrf_cookie(self):
        self.c.get('/api/auth/status')
        self.assertIn('csrftoken', self.c.cookies)

    def test_session_delete_without_csrf_is_rejected(self):
        """DELETE was entirely unguarded before: the old JSON content-type check
        only covered POST/PATCH/PUT."""
        self.csrf_login()
        self.assertEqual(self.c.delete('/api/jobs/1').status_code, 403)

    def test_session_delete_with_csrf_reaches_the_view(self):
        token = self.csrf_login()
        r = self.c.delete('/api/jobs/1', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r.status_code, 404)  # no such job, but CSRF passed

    def test_bearer_delete_needs_no_csrf(self):
        raw = self.bearer()
        r = self.c.delete('/api/jobs/1', HTTP_AUTHORIZATION=f'Bearer {raw}')
        self.assertEqual(r.status_code, 404)

    def test_login_is_csrf_protected(self):
        self.c.get('/api/auth/status')
        self.assertEqual(self.login(self.c).status_code, 403)

    def test_signup_is_csrf_protected(self):
        self.c.get('/api/auth/status')
        r = api(self.c, 'post', f'{ALLAUTH}/auth/signup',
                {'email': 'n@example.com', 'username': 'n', 'password': PASSWORD})
        self.assertEqual(r.status_code, 403)

    def test_token_endpoint_is_exempt(self):
        r = api(self.c, 'post', '/api/auth/token', {'email': 'a@example.com', 'password': PASSWORD})
        self.assertEqual(r.status_code, 201)


class AccountDeletionTests(AuthTestCase):
    def delete(self, client, password=PASSWORD, **extra):
        return api(client, 'delete', '/api/auth/account', {'password': password}, **extra)

    def test_delete_removes_the_account_and_everything_in_it(self):
        from jobs.models import Job
        Job.objects.create(user=self.user, name='Role', company='Co')
        raw = self.bearer()
        c = Client()
        self.login(c)
        self.assertEqual(self.delete(c).status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())
        self.assertFalse(Job.objects.exists())
        self.assertFalse(ApiToken.objects.exists())
        self.assertFalse(EmailAddress.objects.exists())
        # The session is gone, and so is the extension's token
        self.assertFalse(c.get('/api/auth/status').json()['authenticated'])
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 401)

    def test_wrong_password_keeps_the_account(self):
        c = Client()
        self.login(c)
        r = self.delete(c, password='wrong-password-123')
        self.assertEqual(r.status_code, 403)  # not 401: that would sign the SPA out
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_password_guesses_are_throttled(self):
        c = Client()
        self.login(c)
        for _ in range(5):
            self.delete(c, password='wrong-password-123')
        self.assertEqual(self.delete(c).status_code, 429)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_needs_sign_in(self):
        self.assertEqual(self.delete(Client()).status_code, 401)

    def test_works_with_the_extension_token(self):
        r = self.delete(Client(), HTTP_AUTHORIZATION=f'Bearer {self.bearer()}')
        self.assertEqual(r.status_code, 204)

    def test_session_delete_needs_csrf(self):
        c = Client(enforce_csrf_checks=True)
        c.get('/api/auth/status')
        self.login(c, HTTP_X_CSRFTOKEN=c.cookies['csrftoken'].value)
        self.assertEqual(self.delete(c).status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_live_subscription_is_cancelled_first(self):
        from billing import paddle
        from billing.models import BillingAccount
        BillingAccount.objects.create(user=self.user, status='active', subscription_id='sub_1')
        c = Client()
        self.login(c)
        with override_settings(PADDLE_API_KEY='k'), \
                mock.patch.object(paddle, 'cancel_subscription_now') as cancel:
            self.assertEqual(self.delete(c).status_code, 204)
        cancel.assert_called_once_with('sub_1')

    def test_account_is_kept_if_the_subscription_cannot_be_cancelled(self):
        from billing import paddle
        from billing.models import BillingAccount
        BillingAccount.objects.create(user=self.user, status='active', subscription_id='sub_1')
        c = Client()
        self.login(c)
        with override_settings(PADDLE_API_KEY='k'), \
                mock.patch.object(paddle, 'cancel_subscription_now', side_effect=paddle.PaddleError('down')):
            self.assertEqual(self.delete(c).status_code, 502)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())


class ContentTypeGuardTests(AuthTestCase):
    def test_non_json_write_is_rejected(self):
        r = Client().post('/api/auth/token', data='x=1',
                          content_type='application/x-www-form-urlencoded')
        self.assertEqual(r.status_code, 415)
