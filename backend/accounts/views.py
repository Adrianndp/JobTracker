import re

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import HttpResponse, JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie

from config.views import read_json

from . import ratelimit, tokens
from .auth import current_user, start_session
from .models import ApiToken, User

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

SIGNUP_CLOSED = 'Sign-up is closed. An account already exists.'
BAD_CREDENTIALS = 'Invalid username or password.'

# Per username+IP. Rotating IPs cannot lock the real account out, which is the
# whole point: with a single account, a username-only counter IS the outage.
LOGIN_LIMIT, LOGIN_WINDOW = 5, 15 * 60
# Per IP across all usernames, to stop spraying from one host.
LOGIN_IP_LIMIT, LOGIN_IP_WINDOW = 20, 15 * 60
SIGNUP_LIMIT, SIGNUP_WINDOW = 5, 60 * 60


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
    """(user, error_response). Shared by LoginView and TokenView so the throttle
    cannot be sidestepped by aiming at whichever endpoint is less guarded."""
    username = read_str(data, 'username')
    password = read_str(data, 'password', strip=False)
    ip = ratelimit.client_ip(request)
    user_key = f'{username.lower()}:{ip}'

    allowed, retry = ratelimit.check('login', user_key, LOGIN_LIMIT)
    if not allowed:
        return None, too_many(retry)
    allowed, retry = ratelimit.check('loginip', ip, LOGIN_IP_LIMIT)
    if not allowed:
        return None, too_many(retry)

    user = User.objects.filter(username=username).first() if username else None
    if user is None or not user.check_password(password):
        ratelimit.record_failure('login', user_key, LOGIN_WINDOW)
        ratelimit.record_failure('loginip', ip, LOGIN_IP_WINDOW)
        return None, JsonResponse({'error': BAD_CREDENTIALS}, status=401)

    ratelimit.clear('login', user_key)
    return user, None


def validate_password(password, user):
    """None if acceptable, else a 400 JsonResponse."""
    try:
        password_validation.validate_password(password, user)
    except ValidationError as exc:
        return JsonResponse({'error': ' '.join(exc.messages)}, status=400)
    return None


@method_decorator(ensure_csrf_cookie, name='get')
class StatusView(View):
    def get(self, request):
        # The SPA calls this on boot, so it doubles as how the csrftoken cookie
        # gets set before the login form is ever submitted.
        user = current_user(request)
        return JsonResponse({
            'authenticated': user is not None,
            'username': user.username if user else None,
            'setup_required': not User.objects.exists(),
        })


class SignupView(View):
    def post(self, request):
        if User.objects.exists():
            return JsonResponse({'error': SIGNUP_CLOSED}, status=403)

        ip = ratelimit.client_ip(request)
        allowed, retry = ratelimit.check('signup', ip, SIGNUP_LIMIT)
        if not allowed:
            return too_many(retry)
        ratelimit.record_failure('signup', ip, SIGNUP_WINDOW)

        data = read_json(request)
        username = read_str(data, 'username')
        password = read_str(data, 'password', strip=False)
        email = read_str(data, 'email')
        if not username:
            return JsonResponse({'error': 'Username is required.'}, status=400)
        if len(username) > 80:
            return JsonResponse({'error': 'Username must be at most 80 characters.'}, status=400)
        if not email:
            return JsonResponse({'error': 'Email is required.'}, status=400)
        if len(email) > 255 or not EMAIL_RE.match(email):
            return JsonResponse({'error': 'Enter a valid email address.'}, status=400)

        user = User(username=username, email=email)
        error = validate_password(password, user)
        if error:
            return error

        user.set_password(password)
        try:
            user.save()
        except IntegrityError:
            return JsonResponse({'error': SIGNUP_CLOSED}, status=403)
        # Another request may have created an account at the same moment; only the first one counts
        if User.objects.order_by('id').first().id != user.id:
            user.delete()
            return JsonResponse({'error': SIGNUP_CLOSED}, status=403)

        start_session(request, user)
        return JsonResponse({'username': user.username}, status=201)


class LoginView(View):
    def post(self, request):
        user, error = authenticate(request, read_json(request))
        if error:
            return error
        start_session(request, user)
        return JsonResponse({'username': user.username})


@method_decorator(csrf_exempt, name='dispatch')
class TokenView(View):
    """Exchange credentials for a bearer token (the extension's sign-in).

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
        # Authenticated now (removed from PUBLIC_API_PATHS), so this can't be
        # used to sign the user out from another site.
        if request.auth_scheme == 'bearer':
            tokens.revoke(request.auth_token)
        else:
            request.session.flush()
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
