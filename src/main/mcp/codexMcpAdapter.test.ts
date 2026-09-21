import { expect, test } from 'vitest';

import { renderCodexMcpServers } from '../libs/codexNativeConfig';

test('registers Computer Use as a local Codex MCP server with its approval bridge environment', () => {
  const rendered = renderCodexMcpServers([{
    name: 'computer-use',
    transportType: 'stdio',
    command: 'C:/Program Files/nodejs/node.exe',
    args: ['C:/LobsterAI/computer-use-mcp.mjs'],
    env: {
      LOBSTER_ASK_USER_URL: 'http://127.0.0.1:3000/ask-user',
      LOBSTER_MCP_BRIDGE_SECRET: 'secret',
    },
  }]);

  expect(rendered).toContain('[mcp_servers.computer-use]');
  expect(rendered).toContain('[mcp_servers.computer-use.env]');
  expect(rendered).toContain('LOBSTER_MCP_BRIDGE_SECRET = "secret"');
});
