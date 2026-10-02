from allauth.account.models import EmailAddress
from django.contrib.auth import logout
from django.http import HttpResponse, JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie

from billing.paddle import PaddleError
from billing.subscriptions import cancel_for_deletion
from config.views import read_json

from . import ratelimit, tokens
from .auth import current_user
from .models import ApiToken, User

BAD_CREDENTIALS = 'Invalid email or password.'
UNVERIFIED = 'Verify your email address first: sign in on the website to get a code.'

# Sign-up, web login, email verification and password reset belong to allauth
# (/api/_allauth/, rate-limited there). This throttle guards the one password
# endpoint allauth doesn't own: the extension's token exchange.
# Per email+IP, so rotating IPs can't lock a real account out.
LOGIN_LIMIT, LOGIN_WINDOW = 5, 15 * 60
# Per IP across all emails, to stop spraying from one host.
LOGIN_IP_LIMIT, LOGIN_IP_WINDOW = 20, 15 * 60
# Deleting the account re-checks the password; a borrowed session mustn't be
# able to guess it.
DELETE_LIMIT, DELETE_WINDOW = 5, 15 * 60


def read_str(data, key, strip=True):
    value = data.get(key)
    if not isinstance(value, str):
        return ''
    return value.strip() if strip else value


def too_many(retry_after):
    return JsonResponse(
        {'error': f'Too many attempts. Try again in {retry_after} seconds.'},
        status=429,
    )


def authenticate(request, data):
    """(user, error_response) for the extension's email + password sign-in."""
    email = read_str(data, 'email')
    password = read_str(data, 'password', strip=False)
    ip = ratelimit.client_ip(request)
    user_key = f'{email.lower()}:{ip}'

    allowed, retry = ratelimit.check('login', user_key, LOGIN_LIMIT)
    if not allowed:
        return None, too_many(retry)
    allowed, retry = ratelimit.check('loginip', ip, LOGIN_IP_LIMIT)
    if not allowed:
        return None, too_many(retry)

    user = User.objects.filter(email__iexact=email).first() if email else None
    if user is None or not user.is_active or not user.check_password(password):
        ratelimit.record_failure('login', user_key, LOGIN_WINDOW)
        ratelimit.record_failure('loginip', ip, LOGIN_IP_WINDOW)
        return None, JsonResponse({'error': BAD_CREDENTIALS}, status=401)

    ratelimit.clear('login', user_key)
    # Only after the password checks out, so this can't reveal which emails exist
    if not EmailAddress.objects.filter(user=user, email__iexact=user.email, verified=True).exists():
        return None, JsonResponse({'error': UNVERIFIED}, status=403)
    return user, None


@method_decorator(ensure_csrf_cookie, name='get')
class StatusView(View):
    def get(self, request):
        # The SPA calls this on boot, so it doubles as how the csrftoken cookie
        # gets set before the login form is ever submitted.
        user = current_user(request)
        return JsonResponse({
            'authenticated': user is not None,
            'username': user.username if user else None,
        })


@method_decorator(csrf_exempt, name='dispatch')
class TokenView(View):
    """Exchange email + password for a bearer token (the extension's sign-in).

    The only csrf_exempt view in the project, and safe to be: it takes the
    credentials in the body and exercises no ambient authority, so a forged
    cross-site call can only submit a password it already knew.
    """

    def post(self, request):
        data = read_json(request)
        user, error = authenticate(request, data)
        if error:
            return error
        raw, token = tokens.issue(user, read_str(data, 'device_name')[:80] or None)
        return JsonResponse({
            'token': raw,
            'expires_at': token.expires_at.isoformat() + 'Z',
            'username': user.username,
        }, status=201)


class LogoutView(View):
    def post(self, request):
        # Authenticated (not in PUBLIC_API_PATHS), so this can't be used to sign
        # the user out from another site. Handles both schemes, which is why the
        # SPA uses it rather than allauth's DELETE /auth/session.
        if request.auth_scheme == 'bearer':
            tokens.revoke(request.auth_token)
        else:
            logout(request)
        return HttpResponse(status=204)


class TokenListView(View):
    def get(self, request):
        active = [t for t in current_user(request).api_tokens.order_by('-created_at') if t.is_active()]
        return JsonResponse([t.to_dict() for t in active], safe=False)


class TokenDetailView(View):
    http_method_names = ['delete']

    def delete(self, request, token_id):
        token = ApiToken.objects.filter(pk=token_id, user=current_user(request)).first()
        if token is None:
            return JsonResponse({'error': 'Token not found'}, status=404)
        tokens.revoke(token)
        return HttpResponse(status=204)


class AccountView(View):
    """DELETE: close the account for good. Jobs, devices and email addresses go
    with it (cascade); a live subscription is cancelled at Paddle first.

    Paddle keeps its own record of past payments: as the seller it must keep
    invoices for tax purposes.
    """

    http_method_names = ['delete']

    def delete(self, request):
        user = current_user(request)
        allowed, retry = ratelimit.check('delete', user.pk, DELETE_LIMIT)
        if not allowed:
            return too_many(retry)
        # 403, not 401: a wrong password here isn't an expired session, and the
        # SPA signs you out on any 401.
        if not user.check_password(read_str(read_json(request), 'password', strip=False)):
            ratelimit.record_failure('delete', user.pk, DELETE_WINDOW)
            return JsonResponse({'error': 'That password is not correct.'}, status=403)

        try:
            cancel_for_deletion(user)
        except PaddleError:
            return JsonResponse({
                'error': 'Your subscription could not be cancelled, so the account was kept. '
                         'Try again, or cancel it under Manage billing first.',
            }, status=502)

        if request.auth_scheme == 'session':
            logout(request)
        ratelimit.clear('delete', user.pk)
        user.delete()
        return HttpResponse(status=204)
