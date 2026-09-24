from django.http import JsonResponse

from .auth import current_user

# Reachable without being signed in. Note that logout is NOT here any more: as a
# public endpoint it let any site sign the user out.
PUBLIC_API_PATHS = {
    '/api/health',
    '/api/auth/status',
    '/api/auth/token',
}
# allauth's headless API: sign-up, login, email verification, password reset.
# It does its own authentication checks per endpoint.
PUBLIC_API_PREFIXES = ('/api/_allauth/',)


def api_guard(get_response):
    def middleware(request):
        if request.path.startswith('/api/'):
            # Defence in depth against HTML form posts, which cannot set this
            # content type. This was never the CSRF defence -- CsrfViewMiddleware
            # is, and unlike this check it also covers DELETE.
            if request.method in ('POST', 'PATCH', 'PUT') and request.content_type != 'application/json':
                return JsonResponse({'error': 'Content-Type must be application/json'}, status=415)

            user = current_user(request)

            # A bearer token is sent deliberately by a client that had to read it
            # from storage first, so it carries no ambient authority and CSRF
            # cannot apply. Set before CsrfViewMiddleware.process_view runs,
            # which is after every middleware request phase.
            if request.auth_scheme == 'bearer':
                request._dont_enforce_csrf_checks = True

            if user is None and not (
                request.path in PUBLIC_API_PATHS or request.path.startswith(PUBLIC_API_PREFIXES)
            ):
                return JsonResponse({'error': 'Authentication required'}, status=401)
        return get_response(request)

    return middleware
