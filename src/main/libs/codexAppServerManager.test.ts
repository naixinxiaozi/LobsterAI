import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'vitest';

import { CodexAppServerManager } from './codexAppServerManager';

describe('CodexAppServerManager', () => {
  test('starts codex app-server with an isolated CODEX_HOME and no provider credential env', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lobster-codex-'));
    const child = new EventEmitter() as EventEmitter & { stdin: null; stdout: null; stderr: null; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = null;
    child.kill = () => undefined;
    let spawnArgs: { command: string; args: string[]; env: NodeJS.ProcessEnv; shell?: boolean } | undefined;
    const manager = new CodexAppServerManager({
      codexHome,
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
      },
      shell: true,
    });
    expect(spawnArgs?.env?.LOBSTERAI_DEEPSEEK_API_KEY).toBeUndefined();
    expect(spawnArgs?.env?.Engine_AUTH_API_KEY).toBeUndefined();
    manager.stop();
    await fs.rm(codexHome, { recursive: true, force: true });
  });

  test('starts synchronously without projecting a LobsterAI model credential', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lobster-codex-'));
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: null; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = null;
    child.kill = () => undefined;
    let environment: NodeJS.ProcessEnv | undefined;
    const manager = new CodexAppServerManager({
      codexHome,
      spawn: (_command, _args, options) => {
        environment = options.env;
        return child;
      },
    });

    expect(manager.startSync()).toBeDefined();
    expect(environment).toMatchObject({ CODEX_HOME: codexHome });
    expect(environment?.LOBSTERAI_DEEPSEEK_API_KEY).toBeUndefined();
    manager.stop();
    await fs.rm(codexHome, { recursive: true, force: true });
  });
});
