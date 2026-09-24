from . import tokens


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

    # AuthenticationMiddleware already checked the session against the
    # password (get_session_auth_hash), so a changed password lands here as anonymous.
    if request.user.is_authenticated:
        return request.user, 'session', None
    return None, None, None


def current_user(request):
    """The signed-in user, or None. Cached for the life of the request."""
    if not hasattr(request, '_auth_user'):
        request._auth_user, request.auth_scheme, request.auth_token = _resolve(request)
    return request._auth_user

