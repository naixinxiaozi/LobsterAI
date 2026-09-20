import type { ResolvedMcpServer } from './openclawConfigSync';

type SkillProjection = {
  id: string;
  name: string;
  description: string;
  skillPath: string;
};

const tomlString = (value: string): string => JSON.stringify(value);
const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';

export const buildCodexSkillInstructions = (skills: SkillProjection[]): string => skills
  .map(skill => `- ${skill.name}: ${skill.description} (read ${skill.skillPath})`)
  .join('\n');

export const renderCodexMcpServers = (servers: ResolvedMcpServer[]): string => servers.map(server => {
  const name = safeName(server.name);
  if (server.transportType === 'stdio') {
    const args = (server.args ?? []).map(tomlString).join(', ');
    return `[mcp_servers.${name}]\ncommand = ${tomlString(server.command ?? '')}\nargs = [${args}]\n`;
  }
  return `[mcp_servers.${name}]\nurl = ${tomlString(server.url ?? '')}\n`;
}).join('\n');
