import { describe, expect, test } from 'vitest';

import { renderCodexWebSearchConfig } from './codexAppServerConfig';
import { buildCodexSkillInstructions, renderCodexMcpServers } from './codexNativeConfig';

describe('Codex native configuration projection', () => {
  test('renders cached search without remote execution or command network policy', () => {
    const config = renderCodexWebSearchConfig('cached');

    expect(config).toContain('web_search = "cached"');
    expect(config).not.toMatch(/--remote|code-mode-host|network_access|websocket|tunnel/i);
  });

  test('projects enabled LobsterAI skills as absolute SKILL.md instructions', () => {
    expect(buildCodexSkillInstructions([
      { id: 'writer', name: 'Writer', description: 'Write well', skillPath: 'C:/skills/writer/SKILL.md' },
    ])).toContain('C:/skills/writer/SKILL.md');
  });

  test('renders MCP servers using app-server config names without secrets in labels', () => {
    expect(renderCodexMcpServers([{
      name: 'docs server',
      transportType: 'stdio',
      command: 'npx',
      args: ['-y', 'docs-mcp'],
      env: { TOKEN: 'secret' },
    }])).toContain('[mcp_servers.docs_server]');
  });
});
