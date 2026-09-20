import { type ChildProcess, spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CodexAppServerClient, type CodexTransport } from './codexAppServerClient';
import {
  buildCodexHomeConfig,
  CODEX_DEEPSEEK_API_KEY_ENV,
  readDotEnvValue,
} from './codexAppServerConfig';
import { renderCodexMcpServers } from './codexNativeConfig';
import type { ResolvedMcpServer } from './openclawConfigSync';

interface SpawnOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: ['pipe', 'pipe', 'pipe'];
  shell?: boolean;
}

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CodexAppServerManagerOptions {
  codexHome: string;
  apiKey: string;
  envFilePath?: string;
  model?: string;
  command?: string;
  spawn?: SpawnFn;
  environment?: NodeJS.ProcessEnv;
}

export class CodexAppServerManager {
  private child: ChildProcess | null = null;
  private client: CodexAppServerClient | null = null;

  constructor(private readonly options: CodexAppServerManagerOptions) {}

  async start(): Promise<CodexAppServerClient> {
    if (this.client) {
      return this.client;
    }

    await fs.mkdir(this.options.codexHome, { recursive: true });
    await fs.writeFile(
      path.join(this.options.codexHome, 'config.toml'),
      buildCodexHomeConfig({ model: this.options.model }),
      'utf8',
    );

    const spawnProcess = this.options.spawn ?? spawn;
    const apiKey = this.resolveApiKey();
    const environment = {
      ...(this.options.environment ?? process.env),
      CODEX_HOME: this.options.codexHome,
      [CODEX_DEEPSEEK_API_KEY_ENV]: apiKey,
    };
    const child = spawnProcess(this.options.command ?? (process.platform === 'win32' ? 'codex.cmd' : 'codex'), ['app-server', '--stdio'], {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    if (!child.stdin || !child.stdout) {
      child.kill();
      throw new Error('Codex app-server did not expose stdio pipes');
    }

    this.child = child;
    const transport: CodexTransport = {
      input: child.stdin,
      output: child.stdout,
      close: () => child.kill(),
    };
    this.client = new CodexAppServerClient(transport);
    child.once('exit', () => {
      this.client = null;
      this.child = null;
    });
    return this.client;
  }

  startSync(): CodexAppServerClient {
    if (this.client) return this.client;
    fsSync.mkdirSync(this.options.codexHome, { recursive: true });
    fsSync.writeFileSync(
      path.join(this.options.codexHome, 'config.toml'),
      buildCodexHomeConfig({ model: this.options.model }),
      'utf8',
    );
    const spawnProcess = this.options.spawn ?? spawn;
    const child = spawnProcess(this.options.command ?? (process.platform === 'win32' ? 'codex.cmd' : 'codex'), ['app-server', '--stdio'], {
      env: {
        ...(this.options.environment ?? process.env),
        CODEX_HOME: this.options.codexHome,
        [CODEX_DEEPSEEK_API_KEY_ENV]: this.resolveApiKey(),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    if (!child.stdin || !child.stdout) {
      child.kill();
      throw new Error('Codex app-server did not expose stdio pipes');
    }
    this.child = child;
    this.client = new CodexAppServerClient({
      input: child.stdin,
      output: child.stdout,
      close: () => child.kill(),
    });
    child.once('exit', () => {
      this.client = null;
      this.child = null;
    });
    return this.client;
  }

  stop(): void {
    this.client?.close();
    this.client = null;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  async reloadMcpServers(servers: ResolvedMcpServer[]): Promise<void> {
    const configPath = path.join(this.options.codexHome, 'config.toml');
    const base = await fs.readFile(configPath, 'utf8');
    const marker = '\n# LobsterAI MCP projection\n';
    const withoutProjection = base.split(marker)[0].trimEnd();
    await fs.writeFile(configPath, `${withoutProjection}${marker}${renderCodexMcpServers(servers)}`, 'utf8');
    await this.client?.request('config/mcpServer/reload', {});
  }

  private resolveApiKey(): string {
    const fromProcess = this.options.environment?.Engine_AUTH_API_KEY ?? process.env.Engine_AUTH_API_KEY;
    if (fromProcess?.trim()) return fromProcess.trim();
    if (!this.options.envFilePath) return this.options.apiKey.trim();
    try {
      const contents = fsSync.readFileSync(this.options.envFilePath, 'utf8');
      return readDotEnvValue(contents, 'Engine_AUTH_API_KEY')?.trim() || this.options.apiKey.trim();
    } catch {
      return this.options.apiKey.trim();
    }
  }
}
