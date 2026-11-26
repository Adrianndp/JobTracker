"""The jobtracker://users/{username}/jobs resource, with the backend faked by httpx.MockTransport.

The in-memory client has no HTTP request, so the bearer token the MCP client would send is
patched in; the fake backend checks that it arrives unchanged.
"""

import asyncio
import json

import httpx
import pytest
from fastmcp import Client
from mcp.shared.exceptions import MCPError  # what the client raises for a server-side ResourceError

import main

TOKEN = 'tok_alice'
JOBS = [
    {'id': 2, 'name': 'Backend Developer', 'company': 'Acme GmbH', 'status': 'applied'},
    {'id': 1, 'name': 'Data Engineer', 'company': 'Beta AG', 'status': 'saved'},
]


def fake_backend(request: httpx.Request) -> httpx.Response:
    if request.headers.get('Authorization') != f'Bearer {TOKEN}':
        if request.url.path == '/api/auth/status':
            return httpx.Response(200, json={'authenticated': False, 'username': None})
        return httpx.Response(401, json={'error': 'Authentication required'})
    if request.url.path == '/api/auth/status':
        return httpx.Response(200, json={'authenticated': True, 'username': 'alice'})
    if request.url.path == '/api/jobs':
        return httpx.Response(200, json=JOBS)
    return httpx.Response(404, json={'error': 'Not found'})


@pytest.fixture
def backend(monkeypatch):
    """Point the server at the fake backend and send `token` (set per test) as the bearer."""
    sent = {'token': TOKEN}
    monkeypatch.setattr(main, '_bearer_token', lambda: sent['token'])
    monkeypatch.setattr(main, '_backend', lambda token: httpx.AsyncClient(
        base_url='http://backend',
        headers={'Authorization': f'Bearer {token}'},
        transport=httpx.MockTransport(fake_backend),
    ))
    return sent


def read(uri):
    async def run():
        async with Client(main.mcp) as client:
            return await client.read_resource(uri)
    return asyncio.run(run())


def test_template_is_listed():
    async def run():
        async with Client(main.mcp) as client:
            return await client.list_resource_templates()
    templates = asyncio.run(run())
    assert 'jobtracker://users/{username}/jobs' in {t.uri_template for t in templates}


def test_own_jobs_are_returned_as_json(backend):
    contents = read('jobtracker://users/alice/jobs')
    assert contents[0].mime_type == 'application/json'
    assert json.loads(contents[0].text) == JOBS


def test_another_username_is_not_found(backend):
    with pytest.raises(MCPError, match="No jobs found for user 'bob'"):
        read('jobtracker://users/bob/jobs')


def test_username_match_is_case_sensitive(backend):
    with pytest.raises(MCPError, match='No jobs found'):
        read('jobtracker://users/Alice/jobs')


def test_rejected_token(backend):
    backend['token'] = 'tok_revoked'
    with pytest.raises(MCPError, match='token was rejected'):
        read('jobtracker://users/alice/jobs')


def test_missing_token_explains_how_to_send_one():
    # No HTTP request in the in-memory client, so no Authorization header at all.
    with pytest.raises(MCPError, match='No Job Tracker API token'):
        read('jobtracker://users/alice/jobs')


def test_backend_unreachable(monkeypatch):
    def down(request):
        raise httpx.ConnectError('connection refused')
    monkeypatch.setattr(main, '_bearer_token', lambda: TOKEN)
    monkeypatch.setattr(main, '_backend', lambda token: httpx.AsyncClient(
        base_url='http://backend', transport=httpx.MockTransport(down)))
    with pytest.raises(MCPError, match='unreachable'):
        read('jobtracker://users/alice/jobs')
