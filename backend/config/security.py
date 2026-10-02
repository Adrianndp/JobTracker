"""Security headers for the HTML the backend serves itself.

nginx sets the same headers for the docker deployment (see frontend/nginx.conf).
Both are needed: in dev and in the `python manage.py runserver` path Django
serves index.html directly, and a header set in only one place is set in neither
for whichever path you actually use.
"""

# 'unsafe-inline' in style-src is required by React's inline style props
# (JobCard's --accent custom property, AddJobModal's icon). CSS Modules
# themselves are external files and need nothing.
#
# Paddle.js (the checkout) loads from cdn.paddle.com and opens its overlay in a
# frame on buy.paddle.com (sandbox-buy.paddle.com in test mode). It's only
# loaded when someone clicks Upgrade, but the policy has to allow it up front.
PADDLE = 'https://cdn.paddle.com'
PADDLE_FRAMES = 'https://*.paddle.com'

CSP = "; ".join([
    "default-src 'self'",
    f"script-src 'self' {PADDLE}",
    f"style-src 'self' 'unsafe-inline' {PADDLE}",
    f"img-src 'self' data: {PADDLE}",
    "font-src 'self'",
    f"connect-src 'self' {PADDLE_FRAMES}",
    f"frame-src {PADDLE_FRAMES}",
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
