import { EventEmitter } from 'node:events';

import { describe, expect, test, vi } from 'vitest';

import { buildCodexTurnContext, CodexRuntimeAdapter } from './codexRuntimeAdapter';

class FakeCodexClient extends EventEmitter {
  request = vi.fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ thread: { id: 'thread-1' } })
    .mockResolvedValueOnce({ turn: { id: 'turn-1' } });

  respond = vi.fn();
  respondError = vi.fn();
}

const createMessageStore = () => {
  const messages = new Map<string, {
    id: string;
    type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
  }>();
  let nextId = 0;
  return {
    messages,
    addMessage: vi.fn((_sessionId: string, message: {
      type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
      content: string;
      metadata?: Record<string, unknown>;
    }) => {
      const stored = {
        ...message,
        id: `message-${++nextId}`,
        timestamp: nextId,
      };
      messages.set(stored.id, stored);
      return stored;
    }),
    updateMessage: vi.fn((_sessionId: string, messageId: string, updates: {
      content?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const current = messages.get(messageId);
      if (!current) return;
      messages.set(messageId, {
        ...current,
        ...(updates.content !== undefined ? { content: updates.content } : {}),
        ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
      });
    }),
  };
};

const startAdapter = async () => {
  const client = new FakeCodexClient();
  const store = createMessageStore();
  const adapter = new CodexRuntimeAdapter({ client, store });
  await adapter.startSession('session-1', 'Hello Codex');
  return { adapter, client, store };
};

describe('CodexRuntimeAdapter', () => {
  test('builds turn context from only the selected project memory and skills', async () => {
    const context = buildCodexTurnContext({
      project: { id: 'p1', name: 'Finance', rootPath: 'E:/finance' },
      memory: 'Use the approved workbook.',
      skillPaths: ['C:/skills/spreadsheets/SKILL.md'],
    });

    expect(context).toContain('Use the approved workbook.');
    expect(context).toContain('C:/skills/spreadsheets/SKILL.md');
    expect(context).not.toContain('other-project-memory');
  });

  test('passes isolated project context to the Codex turn', async () => {
    const store = createMessageStore();
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ thread: { id: 'thread-1' } })
        .mockResolvedValueOnce({ turn: { id: 'turn-1' } }),
      on: vi.fn(),
      respond: vi.fn(),
    };
    const adapter = new CodexRuntimeAdapter({ client: client as never, store });

    await adapter.startSession('session-1', 'Draft the report', {
      workspaceRoot: 'E:/finance',
      project: { id: 'p1', name: 'Finance', rootPath: 'E:/finance' },
      projectMemory: 'Use the approved workbook.',
      skillPaths: ['C:/skills/spreadsheets/SKILL.md'],
    });

    expect(client.request).toHaveBeenNthCalledWith(3, 'turn/start', expect.objectContaining({
      systemPrompt: expect.stringContaining('Use the approved workbook.'),
    }));
    expect(JSON.stringify(client.request.mock.calls[2])).not.toContain('other-project-memory');
  });

  test('initializes, starts a thread, and starts a turn for a new Cowork session', async () => {
    const store = createMessageStore();
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ thread: { id: 'thread-1' } })
        .mockResolvedValueOnce({ turn: { id: 'turn-1' } }),
      on: vi.fn(),
      respond: vi.fn(),
    };
    const adapter = new CodexRuntimeAdapter({ client: client as never, store });

    await adapter.startSession('session-1', 'Hello Codex', { workspaceRoot: 'C:/work' });

    expect(client.request).toHaveBeenNthCalledWith(1, 'initialize', expect.any(Object));
    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/start', expect.objectContaining({ cwd: 'C:/work' }));
    expect(client.request).toHaveBeenNthCalledWith(3, 'turn/start', expect.objectContaining({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Hello Codex' }],
    }));
  });

  test('resumes a persisted thread instead of creating a new context', async () => {
    const store = createMessageStore();
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
      store,
      getPersistedThreadId: () => 'thread-old',
      saveThreadId: vi.fn(),
    });

    await adapter.startSession('session-1', 'Continue', {});

    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/resume', { threadId: 'thread-old' });
    expect(client.request).toHaveBeenNthCalledWith(3, 'turn/start', expect.objectContaining({ threadId: 'thread-old' }));
  });

  test('merges agent message deltas into one persisted assistant message and finalizes canonical text', async () => {
    const { adapter, client, store } = await startAdapter();
    const newMessages = vi.fn();
    const messageUpdates = vi.fn();
    adapter.on('message', newMessages);
    adapter.on('messageUpdate', messageUpdates);

    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'agent-1', delta: '# 标题' },
    });
    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'agent-1', delta: '\n\n正文' },
    });
    client.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 3,
        item: {
          type: 'agentMessage',
          id: 'agent-1',
          text: '# 标题\n\n正文。',
          phase: 'final_answer',
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      },
    });

    expect(newMessages).toHaveBeenCalledTimes(1);
    expect(newMessages).toHaveBeenCalledWith('session-1', expect.objectContaining({
      id: 'message-1',
      type: 'assistant',
      content: '# 标题',
      metadata: expect.objectContaining({ isStreaming: true, isFinal: false }),
    }));
    expect(messageUpdates).toHaveBeenLastCalledWith(
      'session-1',
      'message-1',
      '# 标题\n\n正文。',
      expect.objectContaining({ isStreaming: false, isFinal: true, codexItemId: 'agent-1' }),
    );
    expect(store.messages.get('message-1')).toMatchObject({
      content: '# 标题\n\n正文。',
      metadata: expect.objectContaining({ isStreaming: false, isFinal: true }),
    });
  });

  test('classifies commentary agent messages as thinking while keeping final answers visible', async () => {
    const { adapter, client } = await startAdapter();
    const newMessages = vi.fn();
    adapter.on('message', newMessages);

    client.emit('notification', {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        startedAtMs: 1,
        item: {
          type: 'agentMessage',
          id: 'commentary-1',
          text: '',
          phase: 'commentary',
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      },
    });
    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'commentary-1', delta: '正在检查代码。' },
    });
    client.emit('notification', {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        startedAtMs: 2,
        item: {
          type: 'agentMessage',
          id: 'answer-1',
          text: '',
          phase: 'final_answer',
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      },
    });
    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'answer-1', delta: '修改完成。' },
    });

    expect(newMessages).toHaveBeenNthCalledWith(1, 'session-1', expect.objectContaining({
      content: '正在检查代码。',
      metadata: expect.objectContaining({ codexMessagePhase: 'commentary', isThinking: true }),
    }));
    expect(newMessages).toHaveBeenNthCalledWith(2, 'session-1', expect.objectContaining({
      content: '修改完成。',
      metadata: expect.objectContaining({ codexMessagePhase: 'final_answer', isThinking: false }),
    }));
  });

  test('maps reasoning summary deltas to a persisted thinking message', async () => {
    const { adapter, client, store } = await startAdapter();
    const newMessages = vi.fn();
    const messageUpdates = vi.fn();
    adapter.on('message', newMessages);
    adapter.on('messageUpdate', messageUpdates);

    client.emit('notification', {
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reason-1', summaryIndex: 0, delta: '检查代码' },
    });
    client.emit('notification', {
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reason-1', summaryIndex: 0, delta: '和测试' },
    });
    client.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 3,
        item: { type: 'reasoning', id: 'reason-1', summary: ['检查代码和测试'], content: [] },
      },
    });

    expect(newMessages).toHaveBeenCalledTimes(1);
    expect(newMessages).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'assistant',
      content: '检查代码',
      metadata: expect.objectContaining({ isThinking: true, isStreaming: true }),
    }));
    expect(messageUpdates).toHaveBeenLastCalledWith(
      'session-1',
      'message-1',
      '检查代码和测试',
      expect.objectContaining({ isThinking: true, isFinal: true }),
    );
    expect(store.messages).toHaveLength(1);
  });

  test('maps command execution lifecycle to one tool use and one final tool result', async () => {
    const { adapter, client, store } = await startAdapter();
    const newMessages = vi.fn();
    const messageUpdates = vi.fn();
    adapter.on('message', newMessages);
    adapter.on('messageUpdate', messageUpdates);
    const commandItem = {
      type: 'commandExecution',
      id: 'command-1',
      command: 'npm test',
      cwd: 'E:/project/own/LobsterAI',
      processId: null,
      source: 'agent',
      status: 'inProgress',
      commandActions: [],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
      pluginId: null,
      scriptPath: null,
    };

    client.emit('notification', {
      method: 'item/started',
      params: { threadId: 'thread-1', turnId: 'turn-1', startedAtMs: 1, item: commandItem },
    });
    client.emit('notification', {
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: 'PASS ' },
    });
    client.emit('notification', {
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: '40 tests' },
    });
    expect(messageUpdates).toHaveBeenLastCalledWith(
      'session-1',
      'message-2',
      'PASS 40 tests',
      expect.objectContaining({ toolResult: 'PASS 40 tests', isStreaming: true }),
    );
    client.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 3,
        item: {
          ...commandItem,
          status: 'completed',
          aggregatedOutput: 'PASS 42 tests',
          exitCode: 0,
          durationMs: 1200,
        },
      },
    });

    expect(newMessages).toHaveBeenNthCalledWith(1, 'session-1', expect.objectContaining({
      type: 'tool_use',
      metadata: expect.objectContaining({
        toolName: 'Bash',
        toolUseId: 'command-1',
        toolInput: { command: 'npm test', cwd: 'E:/project/own/LobsterAI' },
      }),
    }));
    expect(newMessages).toHaveBeenNthCalledWith(2, 'session-1', expect.objectContaining({
      type: 'tool_result',
      content: 'PASS ',
      metadata: expect.objectContaining({ toolUseId: 'command-1', isStreaming: true }),
    }));
    expect(messageUpdates).toHaveBeenLastCalledWith(
      'session-1',
      'message-2',
      'PASS 42 tests',
      expect.objectContaining({ toolUseId: 'command-1', isError: false, isFinal: true }),
    );
    expect(store.messages).toHaveLength(2);
  });

  test('streams Codex plan deltas as one thinking message before finalizing the plan item', async () => {
    const { adapter, client, store } = await startAdapter();
    const newMessages = vi.fn();
    const messageUpdates = vi.fn();
    adapter.on('message', newMessages);
    adapter.on('messageUpdate', messageUpdates);

    client.emit('notification', {
      method: 'item/plan/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'plan-1', delta: '1. 检查' },
    });
    client.emit('notification', {
      method: 'item/plan/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'plan-1', delta: '\n2. 修改' },
    });
    client.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 3,
        item: { type: 'plan', id: 'plan-1', text: '1. 检查\n2. 修改\n3. 验证' },
      },
    });

    expect(newMessages).toHaveBeenCalledTimes(1);
    expect(newMessages).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'assistant',
      content: '1. 检查',
      metadata: expect.objectContaining({ isThinking: true, codexItemId: 'plan-1' }),
    }));
    expect(messageUpdates).toHaveBeenLastCalledWith(
      'session-1',
      'message-1',
      '1. 检查\n2. 修改\n3. 验证',
      expect.objectContaining({ isThinking: true, isFinal: true }),
    );
    expect(store.messages).toHaveLength(1);
  });

  test('reports a failed completed turn as an error instead of a successful completion', async () => {
    const { adapter, client } = await startAdapter();
    const errors = vi.fn();
    const completes = vi.fn();
    adapter.on('error', errors);
    adapter.on('complete', completes);

    client.emit('notification', {
      method: 'error',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        willRetry: true,
        error: { message: 'Temporary upstream failure', codexErrorInfo: null, additionalDetails: null, misalignment: null },
      },
    });
    expect(errors).not.toHaveBeenCalled();

    client.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          items: [],
          itemsView: { type: 'full' },
          status: 'failed',
          error: { message: 'Provider rejected the request', codexErrorInfo: null, additionalDetails: null, misalignment: null },
          startedAt: 1,
          completedAt: 2,
          durationMs: 1000,
        },
      },
    });

    expect(errors).toHaveBeenCalledWith('session-1', 'Provider rejected the request');
    expect(completes).not.toHaveBeenCalled();
  });

  test('finalizes persisted streaming messages when a session is stopped', async () => {
    const { adapter, client, store } = await startAdapter();
    const messageUpdates = vi.fn();
    adapter.on('messageUpdate', messageUpdates);

    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'agent-1', delta: '保留已有内容' },
    });
    adapter.stopSession('session-1');

    expect(messageUpdates).toHaveBeenLastCalledWith(
      'session-1',
      'message-1',
      '保留已有内容',
      expect.objectContaining({ isStreaming: false, isFinal: true }),
    );
    expect(store.messages.get('message-1')).toMatchObject({
      content: '保留已有内容',
      metadata: expect.objectContaining({ isStreaming: false, isFinal: true }),
    });
  });

  test('marks a continued Codex turn active again after the previous turn completed', async () => {
    const { adapter, client } = await startAdapter();
    const statuses = vi.fn();
    adapter.on('sessionStatus', statuses);

    client.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', items: [], status: 'completed', error: null },
      },
    });
    expect(adapter.isSessionActive('session-1')).toBe(false);

    await adapter.continueSession('session-1', '继续');

    expect(adapter.isSessionActive('session-1')).toBe(true);
    expect(statuses).toHaveBeenLastCalledWith('session-1', 'running');
  });

  test('ignores a late completed notification after the session was stopped', async () => {
    const { adapter, client } = await startAdapter();
    const completes = vi.fn();
    adapter.on('complete', completes);

    adapter.stopSession('session-1');
    client.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', items: [], status: 'completed', error: null },
      },
    });

    expect(completes).not.toHaveBeenCalled();
  });

  test('resolves a pending permission before reporting a disconnected Codex session', async () => {
    const { adapter, client } = await startAdapter();
    const resolved = vi.fn();
    const errors = vi.fn();
    adapter.on('permissionResolved', resolved);
    adapter.on('error', errors);

    client.emit('serverRequest', {
      id: 9,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', itemId: 'command-1' },
    });
    client.emit('close');

    expect(resolved).toHaveBeenCalledWith('session-1', 'codex:9');
    expect(errors).toHaveBeenCalledWith('session-1', 'Codex app-server disconnected');
  });

  test('routes Codex MCP elicitation through the standard permission UI', async () => {
    const { adapter, client } = await startAdapter();
    const permissions = vi.fn();
    adapter.on('permissionRequest', permissions);

    client.emit('serverRequest', {
      id: 10,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        serverName: 'computer-use',
        message: 'Allow Computer Use to control Notepad?',
      },
    });

    expect(permissions).toHaveBeenCalledWith('session-1', expect.objectContaining({
      requestId: 'codex:10',
      toolName: 'mcpServer/elicitation/request',
    }));
  });

  test('renders a completed web search as a read-only tool item', async () => {
    const { adapter, client } = await startAdapter();
    const messages = vi.fn();
    adapter.on('message', messages);
    const item = {
      type: 'webSearch',
      id: 'search-1',
      query: 'latest policy',
      status: 'completed',
      result: [],
    };

    client.emit('notification', {
      method: 'item/started',
      params: { threadId: 'thread-1', item },
    });
    client.emit('notification', {
      method: 'item/completed',
      params: { threadId: 'thread-1', item },
    });

    expect(messages).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'tool_use',
      metadata: expect.objectContaining({ toolName: 'WebSearch', readOnly: true }),
    }));
  });
});
