"""Job Tracker MCP server: a standalone service that exposes tools and resources to MCP clients.

Independent of the Django backend: no shared code, database or settings. It reaches job data
only through the backend's public `/api/`, as the user whose ApiToken the MCP client sends
(`Authorization: Bearer <token>`), exactly like the Chrome extension. So the backend's
ownership checks still decide what anyone can see; this service never holds a key of its own.

Runs FastMCP's streamable HTTP transport with the MCP endpoint at /mcp, plus GET /health
for the Docker healthcheck.
"""

import os

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ResourceError
from fastmcp.server.dependencies import get_http_headers
from starlette.requests import Request
from starlette.responses import PlainTextResponse

# Local `runserver` by default; compose points it at the backend container.
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://localhost:5001').rstrip('/')
BACKEND_TIMEOUT = 10  # seconds

mcp = FastMCP('jobtracker')


@mcp.tool
def greet() -> str:
    """Say hello. A test tool to check that the Job Tracker MCP server is reachable."""
    return 'hello'


def _bearer_token() -> str:
    """The ApiToken the MCP client sent, to be passed on to the backend unchanged."""
    # FastMCP strips `authorization` from these by default so it isn't forwarded by accident;
    # forwarding it to the backend is the whole point here, so ask for it explicitly.
    header = get_http_headers(include={'authorization'}).get('authorization', '')
    token = header[7:].strip() if header.startswith('Bearer ') else ''
    if not token:
        raise ResourceError(
            'No Job Tracker API token. Configure your MCP client to send '
            '"Authorization: Bearer <token>" (see README "MCP server").'
        )
    return token


def _backend(token: str) -> httpx.AsyncClient:
    """An HTTP client for the backend that acts as the token's user. Tests replace this."""
    return httpx.AsyncClient(
        base_url=BACKEND_URL,
        headers={'Authorization': f'Bearer {token}'},
        timeout=BACKEND_TIMEOUT,
    )


async def _get_json(client: httpx.AsyncClient, path: str):
    try:
        response = await client.get(path)
    except httpx.HTTPError:
        raise ResourceError('The Job Tracker backend is unreachable. Try again later.') from None
    if response.status_code == 401:
        raise ResourceError('The Job Tracker API token was rejected (expired or revoked).')
    if response.status_code != 200:
        raise ResourceError(f'The Job Tracker backend answered HTTP {response.status_code}.')
    return response.json()


@mcp.resource(
    'jobtracker://users/{username}/jobs',
    name='user_jobs',
    mime_type='application/json',
    annotations={'readOnlyHint': True, 'idempotentHint': True},
)
async def user_jobs(username: str) -> list[dict]:
    """All job applications of a user, newest first, as the backend's job JSON.

    Only works for the user the API token belongs to. Any other username is reported as not
    found, whether or not that user exists, so the resource can't be used to probe usernames
    (the same rule as the backend's 404 for another user's job).
    """
    async with _backend(_bearer_token()) as client:
        status = await _get_json(client, '/api/auth/status')
        if not status.get('authenticated'):
            raise ResourceError('The Job Tracker API token was rejected (expired or revoked).')
        # Usernames are unique and case-sensitive in Django, so compare exactly.
        if status.get('username') != username:
            raise ResourceError(f'No jobs found for user {username!r}.')
        return await _get_json(client, '/api/jobs')


@mcp.custom_route('/health', methods=['GET'])
async def health(request: Request) -> PlainTextResponse:
    return PlainTextResponse('ok')


if __name__ == '__main__':
    mcp.run(
        transport='http',
        host='0.0.0.0',  # inside the container; compose publishes it on 127.0.0.1 only
        port=8000,
        path='/mcp',
        # FastMCP's default is no Host/Origin check. Strict mode only accepts Host headers of
        # localhost/127.0.0.1/::1, so a web page can't reach the server through DNS rebinding.
        # Serving it under a real hostname later means adding that name to allowed_hosts.
        host_origin_protection=True,
    )
