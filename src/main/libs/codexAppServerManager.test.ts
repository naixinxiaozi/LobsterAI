import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'vitest';

import { CodexAppServerManager } from './codexAppServerManager';

describe('CodexAppServerManager', () => {
  test('starts codex app-server with an isolated CODEX_HOME and DeepSeek key env', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lobster-codex-'));
    const child = new EventEmitter() as EventEmitter & { stdin: null; stdout: null; stderr: null; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = null;
    child.kill = () => undefined;
    let spawnArgs: { command: string; args: string[]; env: NodeJS.ProcessEnv; shell?: boolean } | undefined;
    const manager = new CodexAppServerManager({
      codexHome,
      apiKey: 'secret-key',
      spawn: (command, args, options) => {
        spawnArgs = { command, args, env: options.env ?? {}, shell: options.shell };
        return child;
      },
    });

    await manager.start();

    expect(spawnArgs).toMatchObject({
      args: ['app-server', '--stdio'],
      env: {
        CODEX_HOME: codexHome,
        LOBSTERAI_DEEPSEEK_API_KEY: 'secret-key',
      },
      shell: true,
    });
    manager.stop();
    await fs.rm(codexHome, { recursive: true, force: true });
  });

  test('uses Engine_AUTH_API_KEY from the configured dotenv file', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lobster-codex-'));
    const envFilePath = path.join(codexHome, '.env');
    await fs.writeFile(envFilePath, 'Engine_AUTH_API_KEY="dotenv-key"\n', 'utf8');
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: null; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = null;
    child.kill = () => undefined;
    let apiKey = '';
    const manager = new CodexAppServerManager({
      codexHome,
      apiKey: 'fallback-key',
      envFilePath,
      spawn: (_command, _args, options) => {
        apiKey = options.env?.LOBSTERAI_DEEPSEEK_API_KEY ?? '';
        return child;
      },
    });

    await manager.start();

    expect(apiKey).toBe('dotenv-key');
    manager.stop();
    await fs.rm(codexHome, { recursive: true, force: true });
  });
});
