import crypto from 'node:crypto';
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

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);

export class CodexRuntimeAdapter extends EventEmitter implements CoworkRuntime {
  private readonly threadBySession = new Map<string, string>();
  private readonly sessionByThread = new Map<string, string>();
  private readonly activeSessions = new Set<string>();
  private readonly requestByPermissionId = new Map<string, number | string>();
  private readonly sessionByPermissionId = new Map<string, string>();
  private initialized = false;

  constructor(private readonly options: {
    client: CodexClient;
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
    await this.startTurn(sessionId, threadId, prompt, options);
  }

  stopSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
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

    if (notification.method === 'item/agentMessage/delta') {
      const delta = typeof params.delta === 'string' ? params.delta : '';
      if (delta) this.emitAssistantDelta(sessionId, delta);
    } else if (notification.method === 'turn/completed') {
      this.activeSessions.delete(sessionId);
      this.emit('sessionStatus', sessionId, 'completed');
      this.emit('complete', sessionId, threadId);
    } else if (notification.method === 'turn/failed') {
      const error = typeof params.error === 'string' ? params.error : 'Codex turn failed';
      this.activeSessions.delete(sessionId);
      this.emit('error', sessionId, error);
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

  private emitAssistantDelta(sessionId: string, content: string): void {
    const message: CoworkMessage = {
      id: crypto.randomUUID(),
      type: 'assistant',
      content,
      timestamp: Date.now(),
      metadata: { isStreaming: true },
    };
    this.emit('message', sessionId, message);
  }

  private handleClientClose(): void {
    for (const sessionId of this.activeSessions) this.emit('error', sessionId, 'Codex app-server disconnected');
    this.activeSessions.clear();
  }
}
