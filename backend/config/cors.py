"""Minimal CORS for the browser extension.

Hand-rolled rather than pulled from a package so the one property that actually
matters stays visible: we never emit Access-Control-Allow-Credentials. The
extension authenticates with a bearer token, so even an origin that ended up on
the allowlist by mistake cannot ride the session cookie.
"""

from django.conf import settings
from django.http import HttpResponse
from django.utils.cache import patch_vary_headers

ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS'
ALLOWED_HEADERS = 'Authorization, Content-Type, X-CSRFToken'
PREFLIGHT_MAX_AGE = '600'


def allowed_origin(request):
    """The request's Origin if it is on the allowlist, else None."""
    origin = request.headers.get('Origin')
    if origin and origin in settings.CORS_ALLOWED_ORIGINS:
        return origin
    return None


def cors_middleware(get_response):
    def middleware(request):
        if not request.path.startswith('/api/'):
            return get_response(request)

        origin = allowed_origin(request)

        # Answer preflights here. They carry no Authorization header, so letting
        # them reach api_guard would produce a 401 the browser reports as an
        # opaque network error.
        if request.method == 'OPTIONS' and 'Access-Control-Request-Method' in request.headers:
            response = HttpResponse(status=204)
            if origin:
                response['Access-Control-Allow-Methods'] = ALLOWED_METHODS
                response['Access-Control-Allow-Headers'] = ALLOWED_HEADERS
                response['Access-Control-Max-Age'] = PREFLIGHT_MAX_AGE
        else:
            response = get_response(request)

        if origin:
            response['Access-Control-Allow-Origin'] = origin
        # Set regardless of the outcome: the response varies by Origin even when
        # this one wasn't allowed, so caches must not share it across origins.
        patch_vary_headers(response, ('Origin',))

        return response

    return middleware
