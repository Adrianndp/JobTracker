import json

from django.conf import settings
from django.http import Http404, JsonResponse
from django.views import View
from django.views.static import serve


def read_json(request):
    """The request body as a dict, or {} when it isn't a JSON object."""
    try:
        data = json.loads(request.body or b'null')
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


class HealthView(View):
    def get(self, request):
        return JsonResponse({'status': 'ok'})


class ApiNotFoundView(View):
    def dispatch(self, request, *args, **kwargs):
        return JsonResponse({'error': 'Not found'}, status=404)


class ReactAppView(View):
    def dispatch(self, request, path):
        if not settings.DIST_DIR.exists():
            return JsonResponse({'error': 'Frontend not built'}, status=404)
        if path:
            try:
                return serve(request, path, document_root=settings.DIST_DIR)
            except Http404:
                pass
        return serve(request, 'index.html', document_root=settings.DIST_DIR)
