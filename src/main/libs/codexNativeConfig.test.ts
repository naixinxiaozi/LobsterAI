import { describe, expect, test } from 'vitest';

import { buildCodexSkillInstructions, renderCodexMcpServers } from './codexNativeConfig';

describe('Codex native configuration projection', () => {
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
