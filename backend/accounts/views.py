import re
import time

from django.db import IntegrityError
from django.http import HttpResponse, JsonResponse
from django.views import View

from config.views import read_json

from .auth import current_user, start_session
from .models import MIN_PASSWORD_LENGTH, User

MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 300
failed_logins = {}

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

SIGNUP_CLOSED = 'Sign-up is closed. An account already exists.'


def read_str(data, key, strip=True):
    value = data.get(key)
    if not isinstance(value, str):
        return ''
    return value.strip() if strip else value


class StatusView(View):
    def get(self, request):
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
        if len(password) < MIN_PASSWORD_LENGTH:
            return JsonResponse({'error': f'Password must be at least {MIN_PASSWORD_LENGTH} characters.'}, status=400)

        user = User(username=username, email=email)
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
        addr = request.META.get('REMOTE_ADDR') or 'unknown'
        now = time.monotonic()
        count, locked_until = failed_logins.get(addr, (0, 0))
        if locked_until > now:
            retry = int(locked_until - now) + 1
            return JsonResponse({'error': f'Too many failed attempts. Try again in {retry} seconds.'}, status=429)

        data = read_json(request)
        username = read_str(data, 'username')
        password = read_str(data, 'password', strip=False)
        user = User.objects.filter(username=username).first() if username else None
        if user is None or not user.check_password(password):
            count += 1
            failed_logins[addr] = (0, now + LOCKOUT_SECONDS) if count >= MAX_FAILED_LOGINS else (count, 0)
            return JsonResponse({'error': 'Invalid username or password.'}, status=401)

        failed_logins.pop(addr, None)
        start_session(request, user)
        return JsonResponse({'username': user.username})


class LogoutView(View):
    def post(self, request):
        request.session.flush()
        return HttpResponse(status=204)
