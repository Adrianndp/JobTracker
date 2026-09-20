import json
from datetime import timedelta

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from . import tokens
from .models import ApiToken, User, utcnow

PASSWORD = 'correct-horse-battery-9'
JSON = 'application/json'


def api(client, method, path, body=None, **extra):
    kwargs = {'content_type': JSON, **extra}
    if body is not None:
        kwargs['data'] = json.dumps(body)
    return getattr(client, method)(path, **kwargs)


class AuthTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User(username='adrian', email='a@example.com')
        self.user.set_password(PASSWORD)
        self.user.save()

    def bearer(self):
        raw, _ = tokens.issue(self.user, 'test-device')
        return raw


class LogoutTests(AuthTestCase):
    def test_logout_requires_authentication(self):
        """It used to be public, which let any site sign the user out."""
        self.assertEqual(api(Client(), 'post', '/api/auth/logout').status_code, 401)

    def test_session_logout_ends_the_session(self):
        c = Client()
        api(c, 'post', '/api/auth/login', {'username': 'adrian', 'password': PASSWORD})
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
    def test_issue_and_use(self):
        r = api(Client(), 'post', '/api/auth/token',
                {'username': 'adrian', 'password': PASSWORD, 'device_name': 'chrome'})
        self.assertEqual(r.status_code, 201)
        raw = r.json()['token']
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 200)

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
        self.user.save(update_fields=['password_hash'])
        self.assertEqual(Client().get('/api/jobs', HTTP_AUTHORIZATION=f'Bearer {raw}').status_code, 401)

    def test_bad_bearer_does_not_fall_back_to_cookie(self):
        c = Client()
        api(c, 'post', '/api/auth/login', {'username': 'adrian', 'password': PASSWORD})
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
class ThrottleTests(AuthTestCase):
    def fail_login(self, ip):
        return api(Client(), 'post', '/api/auth/login',
                   {'username': 'adrian', 'password': 'wrong'}, HTTP_X_FORWARDED_FOR=ip)

    def test_repeated_failures_from_one_client_are_locked_out(self):
        codes = [self.fail_login('203.0.113.9').status_code for _ in range(6)]
        self.assertEqual(codes, [401, 401, 401, 401, 401, 429])

    def test_another_client_is_not_locked_out(self):
        """The old throttle keyed on the proxy address, so one attacker locked
        out the only account for everybody. That is the bug this proves gone."""
        for _ in range(5):
            self.fail_login('203.0.113.9')
        self.assertEqual(self.fail_login('198.51.100.4').status_code, 401)

    def test_lockout_also_blocks_the_token_endpoint(self):
        for _ in range(5):
            self.fail_login('203.0.113.9')
        r = api(Client(), 'post', '/api/auth/token',
                {'username': 'adrian', 'password': PASSWORD}, HTTP_X_FORWARDED_FOR='203.0.113.9')
        self.assertEqual(r.status_code, 429)

    def test_success_clears_the_counter(self):
        for _ in range(4):
            self.fail_login('203.0.113.9')
        ok = api(Client(), 'post', '/api/auth/login',
                 {'username': 'adrian', 'password': PASSWORD}, HTTP_X_FORWARDED_FOR='203.0.113.9')
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.fail_login('203.0.113.9').status_code, 401)


class ForwardedForTrustTests(AuthTestCase):
    @override_settings(TRUSTED_PROXY_COUNT=0)
    def test_forwarded_for_is_ignored_when_untrusted(self):
        """Otherwise anyone spoofs a fresh client on every attempt."""
        codes = [
            api(Client(), 'post', '/api/auth/login',
                {'username': 'adrian', 'password': 'wrong'},
                HTTP_X_FORWARDED_FOR=f'10.0.0.{i}').status_code
            for i in range(6)
        ]
        self.assertEqual(codes[-1], 429)


class CsrfTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client(enforce_csrf_checks=True)

    def login(self):
        self.c.get('/api/auth/status')  # sets the csrftoken cookie
        token = self.c.cookies['csrftoken'].value
        api(self.c, 'post', '/api/auth/login',
            {'username': 'adrian', 'password': PASSWORD}, HTTP_X_CSRFTOKEN=token)
        return token

    def test_status_sets_the_csrf_cookie(self):
        self.c.get('/api/auth/status')
        self.assertIn('csrftoken', self.c.cookies)

    def test_session_delete_without_csrf_is_rejected(self):
        """DELETE was entirely unguarded before: the old JSON content-type check
        only covered POST/PATCH/PUT."""
        self.login()
        self.assertEqual(self.c.delete('/api/jobs/1').status_code, 403)

    def test_session_delete_with_csrf_reaches_the_view(self):
        token = self.login()
        r = self.c.delete('/api/jobs/1', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(r.status_code, 404)  # no such job, but CSRF passed

    def test_bearer_delete_needs_no_csrf(self):
        raw = self.bearer()
        r = self.c.delete('/api/jobs/1', HTTP_AUTHORIZATION=f'Bearer {raw}')
        self.assertEqual(r.status_code, 404)

    def test_login_is_csrf_protected(self):
        self.c.get('/api/auth/status')
        r = api(self.c, 'post', '/api/auth/login', {'username': 'adrian', 'password': PASSWORD})
        self.assertEqual(r.status_code, 403)

    def test_token_endpoint_is_exempt(self):
        r = api(self.c, 'post', '/api/auth/token', {'username': 'adrian', 'password': PASSWORD})
        self.assertEqual(r.status_code, 201)


class SignupTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, **body):
        return api(Client(), 'post', '/api/auth/signup',
                   {'username': 'new', 'email': 'n@example.com', 'password': PASSWORD, **body})

    def test_short_password_is_rejected(self):
        r = self.post(password='short1!')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(User.objects.exists())

    def test_common_password_is_rejected(self):
        self.assertEqual(self.post(password='password123').status_code, 400)

    def test_numeric_password_is_rejected(self):
        self.assertEqual(self.post(password='1234567890123').status_code, 400)

    def test_valid_signup_creates_the_account(self):
        self.assertEqual(self.post().status_code, 201)
        self.assertEqual(User.objects.count(), 1)

    def test_signup_closes_after_the_first_account(self):
        self.post()
        self.assertEqual(self.post(username='second', email='s@example.com').status_code, 403)


class ContentTypeGuardTests(AuthTestCase):
    def test_non_json_write_is_rejected(self):
        r = Client().post('/api/auth/login', data='x=1',
                          content_type='application/x-www-form-urlencoded')
        self.assertEqual(r.status_code, 415)
