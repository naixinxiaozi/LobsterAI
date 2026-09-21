import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'vitest';

import {
  CodexAppServerClient,
  type CodexTransport,
} from './codexAppServerClient';

function createTransport(): {
  transport: CodexTransport;
  input: PassThrough;
  output: PassThrough;
  sent: () => unknown[];
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: unknown[] = [];
  const transport: CodexTransport = {
    input,
    output,
    close: () => {
      input.end();
      output.end();
    },
  };
  const originalWrite = input.write.bind(input);
  input.write = ((chunk: string | Uint8Array) => {
    messages.push(JSON.parse(String(chunk)));
    return originalWrite(chunk);
  }) as typeof input.write;
  return { transport, input, output, sent: () => messages };
}

describe('CodexAppServerClient', () => {
  test('correlates out-of-order responses and preserves JSONL framing', async () => {
    const { transport, output, sent } = createTransport();
    const client = new CodexAppServerClient(transport);

    const first = client.request<{ value: string }>('first', { one: true });
    const second = client.request<{ value: string }>('second', { two: true });
    const requests = sent() as Array<{ id: number; method: string }>;

    output.write(`{"id":${requests[1].id},"result":{"value":"two"}}\n{"id":`);
    output.write(`${requests[0].id},"result":{"value":"one"}}\n`);

    await expect(first).resolves.toEqual({ value: 'one' });
    await expect(second).resolves.toEqual({ value: 'two' });
  });

  test('emits notifications and server requests and accepts their response', async () => {
    const { transport, output, sent } = createTransport();
    const client = new CodexAppServerClient(transport);
    const notifications: unknown[] = [];
    const serverRequests: unknown[] = [];
    client.on('notification', value => notifications.push(value));
    client.on('serverRequest', value => serverRequests.push(value));

    output.write('{"method":"turn/started","params":{"turnId":"turn-1"}}\n');
    output.write('{"id":77,"method":"item/commandExecution/requestApproval","params":{"itemId":"item-1"}}\n');

    expect(notifications).toEqual([
      { method: 'turn/started', params: { turnId: 'turn-1' } },
    ]);
    expect(serverRequests).toEqual([
      { id: 77, method: 'item/commandExecution/requestApproval', params: { itemId: 'item-1' } },
    ]);

    client.respond(77, { decision: 'accept' });
    expect(sent()).toContainEqual({ id: 77, result: { decision: 'accept' } });
  });

  test('rejects pending requests when the transport closes', async () => {
    const { transport, input } = createTransport();
    const client = new CodexAppServerClient(transport);
    const pending = client.request('thread/start', {});

    input.emit('close');

    await expect(pending).rejects.toThrow('Codex app-server transport closed');
  });

  test('rejects pending requests with a protocol error when output contains malformed JSONL', async () => {
    const { transport, output } = createTransport();
    const client = new CodexAppServerClient(transport);
    const pending = client.request('thread/start', {});

    output.write('{not-json}\n');

    await expect(pending).rejects.toThrow('Invalid Codex app-server JSONL');
  });

  test('sends initialized only after initialize succeeds', async () => {
    const { transport, output, sent } = createTransport();
    const client = new CodexAppServerClient(transport);

    const initialized = client.initialize({
      clientInfo: { name: 'lobsterai', version: 'test' },
      capabilities: { experimentalApi: true },
    });
    const [initializeRequest] = sent() as Array<{ id: number }>;
    output.write(`{"id":${initializeRequest.id},"result":{}}\n`);

    await initialized;

    expect(sent()).toContainEqual({ method: 'initialized' });
  });
});
