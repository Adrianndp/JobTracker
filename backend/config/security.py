"""Security headers for the HTML the backend serves itself.

nginx sets the same headers for the docker deployment (see frontend/nginx.conf).
Both are needed: in dev and in the `python manage.py runserver` path Django
serves index.html directly, and a header set in only one place is set in neither
for whichever path you actually use.
"""

# 'unsafe-inline' in style-src is required by React's inline style props
# (JobCard's --accent custom property, AddJobModal's icon). CSS Modules
# themselves are external files and need nothing.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
])


def security_headers(get_response):
    def middleware(request):
        response = get_response(request)
        if request.path.startswith('/api/'):
            return response
        if response.get('Content-Type', '').startswith('text/html'):
            response.setdefault('Content-Security-Policy', CSP)
        return response

    return middleware
