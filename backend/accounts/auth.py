from . import tokens
from .models import User


def _resolve(request):
    """(user, scheme, token) for this request. Bearer wins over the cookie."""
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        user, token = tokens.resolve(header[7:].strip())
        if user is not None:
            return user, 'bearer', token
        # An explicit bearer token that doesn't resolve is a failed request, not
        # an invitation to fall back to whatever cookie happens to be attached.
        return None, 'bearer', None

    user_id = request.session.get('user_id')
    if user_id is None:
        return None, None, None
    user = User.objects.filter(pk=user_id).first()
    if user is None or request.session.get('session_version') != user.session_version():
        return None, None, None
    return user, 'session', None


def current_user(request):
    """The signed-in user, or None. Cached for the life of the request."""
    if not hasattr(request, '_auth_user'):
        request._auth_user, request.auth_scheme, request.auth_token = _resolve(request)
    return request._auth_user


def start_session(request, user):
    request.session.flush()
    request.session['user_id'] = user.id
    request.session['session_version'] = user.session_version()
