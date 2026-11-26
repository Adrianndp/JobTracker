"""The greet tool, called through FastMCP's in-memory client (no network, no server process)."""

import asyncio

from fastmcp import Client

from main import mcp


def test_greet_is_listed_and_returns_hello():
    async def run():
        async with Client(mcp) as client:
            tools = await client.list_tools()
            assert 'greet' in {tool.name for tool in tools}

            result = await client.call_tool('greet')
            assert result.data == 'hello'

    asyncio.run(run())
