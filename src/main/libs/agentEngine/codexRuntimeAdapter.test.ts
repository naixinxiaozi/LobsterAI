import { describe, expect, test, vi } from 'vitest';

import { CodexRuntimeAdapter } from './codexRuntimeAdapter';

describe('CodexRuntimeAdapter', () => {
  test('initializes, starts a thread, and starts a turn for a new Cowork session', async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ thread: { id: 'thread-1' } })
        .mockResolvedValueOnce({ turn: { id: 'turn-1' } }),
      on: vi.fn(),
      respond: vi.fn(),
    };
    const adapter = new CodexRuntimeAdapter({ client: client as never });

    await adapter.startSession('session-1', 'Hello Codex', { workspaceRoot: 'C:/work' });

    expect(client.request).toHaveBeenNthCalledWith(1, 'initialize', expect.any(Object));
    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/start', expect.objectContaining({ cwd: 'C:/work' }));
    expect(client.request).toHaveBeenNthCalledWith(3, 'turn/start', expect.objectContaining({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Hello Codex' }],
    }));
  });

  test('resumes a persisted thread instead of creating a new context', async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ thread: { id: 'thread-1' } })
        .mockResolvedValueOnce({ turn: { id: 'turn-1' } }),
      on: vi.fn(),
      respond: vi.fn(),
    };
    const adapter = new CodexRuntimeAdapter({
      client: client as never,
      getPersistedThreadId: () => 'thread-old',
      saveThreadId: vi.fn(),
    });

    await adapter.startSession('session-1', 'Continue', {});

    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/resume', { threadId: 'thread-old' });
    expect(client.request).toHaveBeenNthCalledWith(3, 'turn/start', expect.objectContaining({ threadId: 'thread-old' }));
  });
});
