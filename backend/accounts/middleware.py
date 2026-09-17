from django.http import JsonResponse

from .auth import current_user

PUBLIC_API_PATHS = {'/api/health', '/api/auth/status', '/api/auth/signup', '/api/auth/login', '/api/auth/logout'}


def api_guard(get_response):
    def middleware(request):
        if request.path.startswith('/api/'):
            # Only JSON bodies are accepted, so cross-site HTML forms can't hit the API
            if request.method in ('POST', 'PATCH', 'PUT') and request.content_type != 'application/json':
                return JsonResponse({'error': 'Content-Type must be application/json'}, status=415)
            if request.path not in PUBLIC_API_PATHS and current_user(request) is None:
                return JsonResponse({'error': 'Authentication required'}, status=401)
        return get_response(request)

    return middleware
