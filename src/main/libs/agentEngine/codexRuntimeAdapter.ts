import { EventEmitter } from 'node:events';

import type { CoworkMessage } from '../../coworkStore';
import type { CodexAppServerClient } from '../codexAppServerClient';
import type {
  CoworkContextUsage,
  CoworkContinueOptions,
  CoworkRuntime,
  CoworkStartOptions,
  PermissionRequest,
  PermissionResult,
} from './types';

type CodexClient = Pick<CodexAppServerClient, 'request' | 'on' | 'respond' | 'respondError'>;

type ThreadStartResult = { thread?: { id?: string } };
type CodexNotification = { method: string; params?: unknown };
type CodexServerRequest = { id: number | string; method: string; params?: unknown };

const CodexNotificationMethod = {
  AgentMessageDelta: 'item/agentMessage/delta',
  CommandExecutionOutputDelta: 'item/commandExecution/outputDelta',
  Error: 'error',
  ItemCompleted: 'item/completed',
  ItemStarted: 'item/started',
  PlanDelta: 'item/plan/delta',
  ReasoningSummaryTextDelta: 'item/reasoning/summaryTextDelta',
  ReasoningTextDelta: 'item/reasoning/textDelta',
  TurnCompleted: 'turn/completed',
  TurnFailed: 'turn/failed',
} as const;

const CodexItemType = {
  AgentMessage: 'agentMessage',
  CollabAgentToolCall: 'collabAgentToolCall',
  CommandExecution: 'commandExecution',
  DynamicToolCall: 'dynamicToolCall',
  FileChange: 'fileChange',
  ImageGeneration: 'imageGeneration',
  ImageView: 'imageView',
  McpToolCall: 'mcpToolCall',
  Plan: 'plan',
  Reasoning: 'reasoning',
  Sleep: 'sleep',
  WebSearch: 'webSearch',
} as const;

type CodexMessageStore = {
  addMessage: (
    sessionId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'>,
    timestamp?: number,
  ) => CoworkMessage;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updates: { content?: string; metadata?: Record<string, unknown> },
  ) => void;
};

type StreamedMessageState = {
  sessionId: string;
  messageId: string;
  content: string;
  metadata: Record<string, unknown>;
};

type CodexToolDescriptor = {
  name: string;
  input: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);

const asString = (value: unknown): string => typeof value === 'string' ? value : '';

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const stringifyValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getToolDescriptor = (item: Record<string, unknown>): CodexToolDescriptor | null => {
  const type = asString(item.type);
  if (type === CodexItemType.CommandExecution) {
    return {
      name: 'Bash',
      input: {
        command: asString(item.command),
        cwd: asString(item.cwd),
      },
    };
  }
  if (type === CodexItemType.FileChange) {
    return { name: 'FileChange', input: { changes: asArray(item.changes) } };
  }
  if (type === CodexItemType.McpToolCall) {
    const server = asString(item.server);
    const tool = asString(item.tool) || 'MCP';
    return {
      name: server ? `${server}:${tool}` : tool,
      input: asRecord(item.arguments),
    };
  }
  if (type === CodexItemType.DynamicToolCall) {
    const namespace = asString(item.namespace);
    const tool = asString(item.tool) || 'Tool';
    return {
      name: namespace ? `${namespace}:${tool}` : tool,
      input: asRecord(item.arguments),
    };
  }
  if (type === CodexItemType.WebSearch) {
    return { name: 'WebSearch', input: { ...item } };
  }
  if (type === CodexItemType.ImageView) {
    return { name: 'ViewImage', input: { path: asString(item.path) } };
  }
  if (type === CodexItemType.ImageGeneration) {
    return { name: 'ImageGeneration', input: { ...item } };
  }
  if (type === CodexItemType.CollabAgentToolCall) {
    return {
      name: asString(item.tool) || 'CollabAgent',
      input: {
        prompt: item.prompt,
        receiverThreadIds: asArray(item.receiverThreadIds),
      },
    };
  }
  if (type === CodexItemType.Sleep) {
    return { name: 'Wait', input: { ...item } };
  }
  return null;
};

const getToolResult = (item: Record<string, unknown>): { content: string; isError: boolean } => {
  const type = asString(item.type);
  if (type === CodexItemType.CommandExecution) {
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null;
    return {
      content: asString(item.aggregatedOutput),
      isError: exitCode !== null && exitCode !== 0,
    };
  }
  if (type === CodexItemType.FileChange) {
    const status = asString(item.status);
    return { content: stringifyValue(item.changes), isError: status.toLowerCase().includes('fail') };
  }
  if (type === CodexItemType.McpToolCall) {
    const error = item.error;
    return {
      content: error ? stringifyValue(error) : stringifyValue(item.result),
      isError: Boolean(error),
    };
  }
  if (type === CodexItemType.DynamicToolCall) {
    return {
      content: stringifyValue(item.contentItems),
      isError: item.success === false,
    };
  }
  const status = asString(item.status);
  return {
    content: stringifyValue(item.result ?? item),
    isError: status.toLowerCase().includes('fail'),
  };
};

export class CodexRuntimeAdapter extends EventEmitter implements CoworkRuntime {
  private readonly threadBySession = new Map<string, string>();
  private readonly sessionByThread = new Map<string, string>();
  private readonly activeSessions = new Set<string>();
  private readonly requestByPermissionId = new Map<string, number | string>();
  private readonly sessionByPermissionId = new Map<string, string>();
  private readonly agentMessagePhaseByItem = new Map<string, string>();
  private readonly assistantMessageByItem = new Map<string, StreamedMessageState>();
  private readonly reasoningMessageByItem = new Map<string, StreamedMessageState>();
  private readonly toolUseMessageByItem = new Map<string, string>();
  private readonly toolResultMessageByItem = new Map<string, StreamedMessageState>();
  private initialized = false;

  constructor(private readonly options: {
    client: CodexClient;
    store: CodexMessageStore;
    getSkillInstructions?: () => string | null;
    getPersistedThreadId?: (sessionId: string) => string | null;
    saveThreadId?: (sessionId: string, threadId: string) => void;
  }) {
    super();
    options.client.on('notification', notification => this.handleNotification(notification));
    options.client.on('serverRequest', request => this.handleServerRequest(request));
    options.client.on('close', () => this.handleClientClose());
  }

  async startSession(sessionId: string, prompt: string, options: CoworkStartOptions = {}): Promise<void> {
    await this.ensureInitialized();
    const threadId = await this.startThread(sessionId, options);
    await this.startTurn(sessionId, threadId, prompt, options);
  }

  async continueSession(sessionId: string, prompt: string, options: CoworkContinueOptions = {}): Promise<void> {
    await this.ensureInitialized();
    const threadId = this.threadBySession.get(sessionId);
    if (!threadId) {
      throw new Error(`Codex thread is unavailable for session ${sessionId}; refusing to create a new context`);
    }
    this.activeSessions.add(sessionId);
    this.emit('sessionStatus', sessionId, 'running');
    try {
      await this.startTurn(sessionId, threadId, prompt, options);
    } catch (error) {
      this.activeSessions.delete(sessionId);
      throw error;
    }
  }

  stopSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.finalizeOpenMessages(sessionId);
    this.clearSessionItems(sessionId);
    this.emit('sessionStopped', sessionId);
  }

  stopAllSessions(): void {
    for (const sessionId of this.activeSessions) this.stopSession(sessionId);
  }

  respondToPermission(requestId: string, result: PermissionResult): void {
    const request = this.requestByPermissionId.get(requestId);
    if (request === undefined) return;
    this.requestByPermissionId.delete(requestId);
    const sessionId = this.sessionByPermissionId.get(requestId) ?? '';
    this.sessionByPermissionId.delete(requestId);
    if (result.behavior === 'allow') {
      this.options.client.respond(request, { decision: 'accept' });
    } else {
      this.options.client.respond(request, { decision: 'decline', message: result.message });
    }
    this.emit('permissionResolved', sessionId, requestId);
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSessionConfirmationMode(): 'modal' {
    return 'modal';
  }

  async compactContext(sessionId: string): Promise<{ compacted: boolean; usage?: CoworkContextUsage | null }> {
    const threadId = this.threadBySession.get(sessionId);
    if (!threadId) return { compacted: false, usage: null };
    this.emit('contextMaintenance', sessionId, true);
    try {
      await this.options.client.request('thread/compact/start', { threadId });
      return { compacted: true, usage: null };
    } finally {
      this.emit('contextMaintenance', sessionId, false);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.options.client.request('initialize', {
      clientInfo: { name: 'lobsterai', version: '2026.9.18' },
      capabilities: { experimentalApi: true },
    });
    this.initialized = true;
  }

  private async startThread(sessionId: string, options: CoworkStartOptions): Promise<string> {
    const persistedThreadId = this.options.getPersistedThreadId?.(sessionId);
    if (persistedThreadId) {
      await this.options.client.request('thread/resume', { threadId: persistedThreadId });
      this.threadBySession.set(sessionId, persistedThreadId);
      this.sessionByThread.set(persistedThreadId, sessionId);
      this.activeSessions.add(sessionId);
      this.emit('sessionStatus', sessionId, 'running');
      return persistedThreadId;
    }
    const result = await this.options.client.request<ThreadStartResult>('thread/start', {
      ...(options.workspaceRoot ? { cwd: options.workspaceRoot } : {}),
      approvalPolicy: options.autoApprove ? 'never' : 'on-request',
      ...(this.options.getSkillInstructions?.() ? { developerInstructions: this.options.getSkillInstructions?.() } : {}),
    });
    const threadId = result.thread?.id;
    if (!threadId) throw new Error('Codex app-server did not return a thread id');
    this.threadBySession.set(sessionId, threadId);
    this.sessionByThread.set(threadId, sessionId);
    this.options.saveThreadId?.(sessionId, threadId);
    this.activeSessions.add(sessionId);
    this.emit('sessionStatus', sessionId, 'running');
    return threadId;
  }

  private async startTurn(sessionId: string, threadId: string, prompt: string, options: CoworkStartOptions | CoworkContinueOptions): Promise<void> {
    await this.options.client.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    });
  }

  private handleNotification(notification: CodexNotification): void {
    const params = asRecord(notification.params);
    const threadId = typeof params.threadId === 'string' ? params.threadId : null;
    const sessionId = threadId ? this.sessionByThread.get(threadId) : null;
    if (!sessionId) return;

    if (notification.method === CodexNotificationMethod.Error) {
      if (!this.activeSessions.has(sessionId)) return;
      if (params.willRetry === true) return;
      const error = asRecord(params.error);
      const message = asString(error.message) || 'Codex turn failed';
      this.finalizeOpenMessages(sessionId);
      this.activeSessions.delete(sessionId);
      this.emit('error', sessionId, message);
      this.clearSessionItems(sessionId);
    } else if (notification.method === CodexNotificationMethod.AgentMessageDelta) {
      const delta = typeof params.delta === 'string' ? params.delta : '';
      const itemId = asString(params.itemId);
      if (delta && itemId) this.appendAssistantDelta(sessionId, itemId, delta);
    } else if (
      notification.method === CodexNotificationMethod.ReasoningSummaryTextDelta
      || notification.method === CodexNotificationMethod.ReasoningTextDelta
      || notification.method === CodexNotificationMethod.PlanDelta
    ) {
      const delta = asString(params.delta);
      const itemId = asString(params.itemId);
      if (delta && itemId) this.appendReasoningDelta(sessionId, itemId, delta);
    } else if (notification.method === CodexNotificationMethod.CommandExecutionOutputDelta) {
      const delta = asString(params.delta);
      const itemId = asString(params.itemId);
      if (delta && itemId) this.appendToolResultDelta(sessionId, itemId, delta);
    } else if (notification.method === CodexNotificationMethod.ItemStarted) {
      this.handleItemStarted(sessionId, asRecord(params.item));
    } else if (notification.method === CodexNotificationMethod.ItemCompleted) {
      this.handleItemCompleted(sessionId, asRecord(params.item));
    } else if (notification.method === CodexNotificationMethod.TurnCompleted) {
      if (!this.activeSessions.has(sessionId)) return;
      this.finalizeOpenMessages(sessionId);
      this.activeSessions.delete(sessionId);
      const turn = asRecord(params.turn);
      if (asString(turn.status) === 'failed') {
        const error = asRecord(turn.error);
        this.emit('error', sessionId, asString(error.message) || 'Codex turn failed');
      } else {
        this.emit('sessionStatus', sessionId, 'completed');
        this.emit('complete', sessionId, threadId);
      }
      this.clearSessionItems(sessionId);
    } else if (notification.method === CodexNotificationMethod.TurnFailed) {
      if (!this.activeSessions.has(sessionId)) return;
      const error = typeof params.error === 'string' ? params.error : 'Codex turn failed';
      this.activeSessions.delete(sessionId);
      this.emit('error', sessionId, error);
      this.clearSessionItems(sessionId);
    }
  }

  private handleServerRequest(request: CodexServerRequest): void {
    const params = asRecord(request.params);
    const threadId = typeof params.threadId === 'string' ? params.threadId : null;
    const sessionId = threadId ? this.sessionByThread.get(threadId) : null;
    if (!sessionId) {
      this.options.client.respondError(request.id, -32000, 'Unknown Codex thread');
      return;
    }
    const requestId = `codex:${String(request.id)}`;
    this.requestByPermissionId.set(requestId, request.id);
    this.sessionByPermissionId.set(requestId, sessionId);
    const permission: PermissionRequest = {
      requestId,
      toolName: request.method,
      toolInput: params,
    };
    this.emit('permissionRequest', sessionId, permission);
  }

  private itemKey(sessionId: string, itemId: string): string {
    return `${sessionId}:${itemId}`;
  }

  private createMessage(
    sessionId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'>,
  ): CoworkMessage {
    const stored = this.options.store.addMessage(sessionId, message);
    this.emit('message', sessionId, stored);
    return stored;
  }

  private updateMessage(
    state: StreamedMessageState,
    content: string,
    metadata: Record<string, unknown>,
  ): void {
    state.content = content;
    state.metadata = metadata;
    this.options.store.updateMessage(state.sessionId, state.messageId, { content, metadata });
    this.emit('messageUpdate', state.sessionId, state.messageId, content, metadata);
  }

  private appendAssistantDelta(sessionId: string, itemId: string, delta: string): void {
    const key = this.itemKey(sessionId, itemId);
    const existing = this.assistantMessageByItem.get(key);
    if (existing) {
      this.updateMessage(existing, `${existing.content}${delta}`, existing.metadata);
      return;
    }
    const phase = this.agentMessagePhaseByItem.get(key) ?? null;
    const metadata = {
      codexItemId: itemId,
      codexMessagePhase: phase,
      isThinking: phase === 'commentary',
      isStreaming: true,
      isFinal: false,
    };
    const message = this.createMessage(sessionId, {
      type: 'assistant',
      content: delta,
      metadata,
    });
    this.assistantMessageByItem.set(key, {
      sessionId,
      messageId: message.id,
      content: delta,
      metadata,
    });
  }

  private appendReasoningDelta(sessionId: string, itemId: string, delta: string): void {
    const key = this.itemKey(sessionId, itemId);
    const existing = this.reasoningMessageByItem.get(key);
    if (existing) {
      this.updateMessage(existing, `${existing.content}${delta}`, existing.metadata);
      return;
    }
    const metadata = {
      codexItemId: itemId,
      isThinking: true,
      isStreaming: true,
      isFinal: false,
    };
    const message = this.createMessage(sessionId, {
      type: 'assistant',
      content: delta,
      metadata,
    });
    this.reasoningMessageByItem.set(key, {
      sessionId,
      messageId: message.id,
      content: delta,
      metadata,
    });
  }

  private handleItemStarted(sessionId: string, item: Record<string, unknown>): void {
    const itemId = asString(item.id);
    if (!itemId) return;
    if (asString(item.type) === CodexItemType.AgentMessage) {
      const phase = asString(item.phase);
      if (phase) this.agentMessagePhaseByItem.set(this.itemKey(sessionId, itemId), phase);
      return;
    }
    const descriptor = getToolDescriptor(item);
    if (!descriptor) return;
    this.ensureToolUseMessage(sessionId, itemId, descriptor);
  }

  private handleItemCompleted(sessionId: string, item: Record<string, unknown>): void {
    const itemId = asString(item.id);
    if (!itemId) return;
    const key = this.itemKey(sessionId, itemId);
    const type = asString(item.type);

    if (type === CodexItemType.AgentMessage) {
      const canonicalText = asString(item.text);
      const existing = this.assistantMessageByItem.get(key);
      const phase = asString(item.phase) || this.agentMessagePhaseByItem.get(key) || null;
      const metadata = {
        ...(existing?.metadata ?? {}),
        codexItemId: itemId,
        codexMessagePhase: phase,
        isThinking: phase === 'commentary',
        isStreaming: false,
        isFinal: true,
      };
      if (existing) {
        this.updateMessage(existing, canonicalText || existing.content, metadata);
      } else if (canonicalText) {
        const message = this.createMessage(sessionId, {
          type: 'assistant',
          content: canonicalText,
          metadata,
        });
        this.assistantMessageByItem.set(key, {
          sessionId,
          messageId: message.id,
          content: canonicalText,
          metadata,
        });
      }
      return;
    }

    if (type === CodexItemType.Reasoning || type === CodexItemType.Plan) {
      const canonicalText = type === CodexItemType.Plan
        ? asString(item.text)
        : [...asArray(item.summary), ...asArray(item.content)]
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join('\n\n');
      const existing = this.reasoningMessageByItem.get(key);
      const metadata = {
        ...(existing?.metadata ?? {}),
        codexItemId: itemId,
        isThinking: true,
        isStreaming: false,
        isFinal: true,
      };
      if (existing) {
        this.updateMessage(existing, canonicalText || existing.content, metadata);
      } else if (canonicalText) {
        const message = this.createMessage(sessionId, {
          type: 'assistant',
          content: canonicalText,
          metadata,
        });
        this.reasoningMessageByItem.set(key, {
          sessionId,
          messageId: message.id,
          content: canonicalText,
          metadata,
        });
      }
      return;
    }

    const descriptor = getToolDescriptor(item);
    if (!descriptor) return;
    this.ensureToolUseMessage(sessionId, itemId, descriptor);
    const result = getToolResult(item);
    this.finalizeToolResult(sessionId, itemId, result.content, result.isError);
  }

  private ensureToolUseMessage(
    sessionId: string,
    itemId: string,
    descriptor: CodexToolDescriptor,
  ): void {
    const key = this.itemKey(sessionId, itemId);
    if (this.toolUseMessageByItem.has(key)) return;
    const message = this.createMessage(sessionId, {
      type: 'tool_use',
      content: `Using tool: ${descriptor.name}`,
      metadata: {
        codexItemId: itemId,
        toolName: descriptor.name,
        toolInput: descriptor.input,
        toolUseId: itemId,
      },
    });
    this.toolUseMessageByItem.set(key, message.id);
  }

  private appendToolResultDelta(sessionId: string, itemId: string, delta: string): void {
    const key = this.itemKey(sessionId, itemId);
    const existing = this.toolResultMessageByItem.get(key);
    if (existing) {
      const content = `${existing.content}${delta}`;
      this.updateMessage(existing, content, {
        ...existing.metadata,
        toolResult: content,
      });
      return;
    }
    const metadata = {
      codexItemId: itemId,
      toolUseId: itemId,
      toolResult: delta,
      isError: false,
      isStreaming: true,
      isFinal: false,
    };
    const message = this.createMessage(sessionId, {
      type: 'tool_result',
      content: delta,
      metadata,
    });
    this.toolResultMessageByItem.set(key, {
      sessionId,
      messageId: message.id,
      content: delta,
      metadata,
    });
  }

  private finalizeToolResult(
    sessionId: string,
    itemId: string,
    content: string,
    isError: boolean,
  ): void {
    const key = this.itemKey(sessionId, itemId);
    const existing = this.toolResultMessageByItem.get(key);
    const finalContent = content || existing?.content || '';
    const metadata = {
      ...(existing?.metadata ?? {}),
      codexItemId: itemId,
      toolUseId: itemId,
      toolResult: finalContent,
      ...(isError ? { error: finalContent || 'Tool execution failed' } : {}),
      isError,
      isStreaming: false,
      isFinal: true,
    };
    if (existing) {
      this.updateMessage(existing, finalContent, metadata);
      return;
    }
    const message = this.createMessage(sessionId, {
      type: 'tool_result',
      content: finalContent,
      metadata,
    });
    this.toolResultMessageByItem.set(key, {
      sessionId,
      messageId: message.id,
      content: finalContent,
      metadata,
    });
  }

  private finalizeOpenMessages(sessionId: string): void {
    for (const state of [
      ...this.assistantMessageByItem.values(),
      ...this.reasoningMessageByItem.values(),
      ...this.toolResultMessageByItem.values(),
    ]) {
      if (state.sessionId !== sessionId || state.metadata.isFinal === true) continue;
      this.updateMessage(state, state.content, {
        ...state.metadata,
        isStreaming: false,
        isFinal: true,
      });
    }
  }

  private clearSessionItems(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const collection of [
      this.agentMessagePhaseByItem,
      this.assistantMessageByItem,
      this.reasoningMessageByItem,
      this.toolUseMessageByItem,
      this.toolResultMessageByItem,
    ]) {
      for (const key of collection.keys()) {
        if (key.startsWith(prefix)) collection.delete(key);
      }
    }
  }

  private handleClientClose(): void {
    for (const sessionId of this.activeSessions) {
      this.finalizeOpenMessages(sessionId);
      this.emit('error', sessionId, 'Codex app-server disconnected');
      this.clearSessionItems(sessionId);
    }
    this.activeSessions.clear();
  }
}
