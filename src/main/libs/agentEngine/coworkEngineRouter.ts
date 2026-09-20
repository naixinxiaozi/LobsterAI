import { EventEmitter } from 'events';

import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import {
  BackgroundJobKillOutcome,
  type BackgroundJobKillResult,
  type CoworkBackgroundJob,
} from '../../../shared/cowork/backgroundJobs';
import type {
  CoworkBtwAbortResponse,
  CoworkBtwSubmitResponse,
} from '../../../shared/cowork/btw';
import type { CoworkGoal } from '../../../shared/cowork/goal';
import { OpenClawQuestion } from '../../../shared/cowork/openclawQuestion';
import type { CoworkSteerResponse } from '../../../shared/cowork/steer';
import type {
  CoworkAgentEngine,
  CoworkContextUsage,
  CoworkContinueOptions,
  CoworkForkCompactionSummary,
  CoworkRuntime,
  CoworkRuntimeEvents,
  CoworkSessionPatchResult,
  CoworkStartOptions,
  PermissionResult,
} from './types';
import { ENGINE_SWITCHED_CODE } from './types';

type RouterDeps = {
  getCurrentEngine: () => CoworkAgentEngine;
  openclawRuntime: CoworkRuntime;
  codexRuntime?: CoworkRuntime;
};

export class CoworkEngineRouter extends EventEmitter implements CoworkRuntime {
  private readonly getCurrentEngine: () => CoworkAgentEngine;
  private readonly runtimes: Record<CoworkAgentEngine, CoworkRuntime>;
  private readonly sessionEngine = new Map<string, CoworkAgentEngine>();
  private readonly requestEngine = new Map<string, CoworkAgentEngine>();
  private readonly requestSession = new Map<string, string>();
  private currentEngine: CoworkAgentEngine;

  constructor(deps: RouterDeps) {
    super();
    this.getCurrentEngine = deps.getCurrentEngine;
    this.runtimes = {
      openclaw: deps.openclawRuntime,
      codex: deps.codexRuntime ?? deps.openclawRuntime,
    };
    this.currentEngine = this.safeResolveEngine();

    this.bindRuntimeEvents('openclaw', deps.openclawRuntime);
    if (deps.codexRuntime) {
      this.bindRuntimeEvents('codex', deps.codexRuntime);
    }
  }

  override on<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.on(event, listener);
  }

  override off<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.off(event, listener);
  }

  async startSession(sessionId: string, prompt: string, options: CoworkStartOptions = {}): Promise<void> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimes[engine];
    this.sessionEngine.set(sessionId, engine);
    try {
      await runtime.startSession(sessionId, prompt, options);
    } catch (error) {
      this.sessionEngine.delete(sessionId);
      this.clearRequestEngineBySession(sessionId);
      throw error;
    }
  }

  async continueSession(sessionId: string, prompt: string, options: CoworkContinueOptions = {}): Promise<void> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimes[engine];
    this.sessionEngine.set(sessionId, engine);
    try {
      await runtime.continueSession(sessionId, prompt, options);
    } catch (error) {
      this.sessionEngine.delete(sessionId);
      this.clearRequestEngineBySession(sessionId);
      throw error;
    }
  }

  async submitSteer(sessionId: string, text: string, clientSteerId: string): Promise<CoworkSteerResponse> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimeForSession(sessionId, engine);
    this.sessionEngine.set(sessionId, engine);
    if (!runtime.submitSteer) {
      throw new Error(`Steer is not supported by engine: ${engine}`);
    }
    return runtime.submitSteer(sessionId, text, clientSteerId);
  }

  async submitBtw(sessionId: string, question: string, runId: string): Promise<CoworkBtwSubmitResponse> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimeForSession(sessionId, engine);
    this.sessionEngine.set(sessionId, engine);
    if (!runtime.submitBtw) {
      throw new Error(`BTW side questions are not supported by engine: ${engine}`);
    }
    return runtime.submitBtw(sessionId, question, runId);
  }

  async abortBtw(sessionId: string, runId: string): Promise<CoworkBtwAbortResponse> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimeForSession(sessionId, engine);
    this.sessionEngine.set(sessionId, engine);
    if (!runtime.abortBtw) {
      throw new Error(`Stopping BTW side questions is not supported by engine: ${engine}`);
    }
    return runtime.abortBtw(sessionId, runId);
  }

  async runGoalCommand(sessionId: string, command: string): Promise<CoworkGoal | null> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimeForSession(sessionId, engine);
    this.sessionEngine.set(sessionId, engine);
    if (!runtime.runGoalCommand) {
      throw new Error(`Goal commands are not supported by engine: ${engine}`);
    }
    return runtime.runGoalCommand(sessionId, command);
  }

  async patchSession(sessionId: string, patch: OpenClawSessionPatch): Promise<CoworkSessionPatchResult | void> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimeForSession(sessionId, engine);
    this.sessionEngine.set(sessionId, engine);
    if (!runtime.patchSession) {
      throw new Error(`Session patch is not supported by engine: ${engine}`);
    }
    return runtime.patchSession(sessionId, patch);
  }

  async getContextUsage(sessionId: string): Promise<CoworkContextUsage | null> {
    const runtime = this.runtimeForSession(sessionId, this.safeResolveEngine());
    if (!runtime.getContextUsage) {
      return null;
    }
    return runtime.getContextUsage(sessionId);
  }

  async compactContext(sessionId: string): Promise<{ compacted: boolean; reason?: string; usage?: CoworkContextUsage | null }> {
    const engine = this.safeResolveEngine();
    const runtime = this.runtimeForSession(sessionId, engine);
    this.sessionEngine.set(sessionId, engine);
    if (!runtime.compactContext) {
      throw new Error(`Context compaction is not supported by engine: ${engine}`);
    }
    return runtime.compactContext(sessionId);
  }

  async getForkCompactionSummary(sessionId: string, beforeCreatedAt?: number): Promise<CoworkForkCompactionSummary | null> {
    const runtime = this.runtimeForSession(sessionId, this.safeResolveEngine());
    if (!runtime.getForkCompactionSummary) {
      return null;
    }
    return runtime.getForkCompactionSummary(sessionId, beforeCreatedAt);
  }

  stopSession(sessionId: string): void {
    this.runtimeForSession(sessionId, this.safeResolveEngine()).stopSession(sessionId);
    this.sessionEngine.delete(sessionId);
    this.clearRequestEngineBySession(sessionId);
  }

  stopAllSessions(): void {
    for (const runtime of new Set(Object.values(this.runtimes))) {
      runtime.stopAllSessions();
    }
    this.sessionEngine.clear();
    this.requestEngine.clear();
    this.requestSession.clear();
  }

  respondToPermission(requestId: string, result: PermissionResult): void | Promise<void> {
    if (requestId.startsWith(OpenClawQuestion.RequestIdPrefix)) {
      // Native answers must be acknowledged before the renderer dismisses the question.
      return this.runtimeForRequest(requestId).respondToPermission(requestId, result);
    }
    const engine = this.requestEngine.get(requestId);
    if (engine) {
      this.runtimeForRequest(requestId).respondToPermission(requestId, result);
      if (result.behavior === 'allow' || result.behavior === 'deny') {
        this.requestEngine.delete(requestId);
        this.requestSession.delete(requestId);
      }
      return;
    }

    this.runtimeForRequest(requestId).respondToPermission(requestId, result);
  }

  isSessionActive(sessionId: string): boolean {
    return this.runtimeForSession(sessionId, this.safeResolveEngine()).isSessionActive(sessionId);
  }

  getPendingQuestions() {
    return Object.values(this.runtimes).flatMap(runtime => runtime.getPendingQuestions?.() ?? []);
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.sessionEngine.keys())
      .filter((sessionId) => this.runtimeForSession(sessionId, this.currentEngine).isSessionActive(sessionId));
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.runtimeForSession(sessionId, this.safeResolveEngine()).getSessionConfirmationMode(sessionId);
  }

  async deleteSubagentSession(parentSessionId: string, runId: string): Promise<boolean> {
    const runtime = this.runtimeForSession(parentSessionId, this.safeResolveEngine());
    if (!runtime.deleteSubagentSession) {
      return false;
    }
    return runtime.deleteSubagentSession(parentSessionId, runId);
  }

  async listBackgroundJobs(sessionId: string): Promise<CoworkBackgroundJob[]> {
    return (await this.runtimeForSession(sessionId, this.safeResolveEngine()).listBackgroundJobs?.(sessionId)) ?? [];
  }

  async killBackgroundJob(sessionId: string, jobId: string): Promise<BackgroundJobKillResult> {
    return (await this.runtimeForSession(sessionId, this.safeResolveEngine()).killBackgroundJob?.(sessionId, jobId))
      ?? { outcome: BackgroundJobKillOutcome.Unsupported };
  }

  async clearSettledBackgroundJobs(sessionId: string): Promise<CoworkBackgroundJob[]> {
    return (await this.runtimeForSession(sessionId, this.safeResolveEngine()).clearSettledBackgroundJobs?.(sessionId)) ?? [];
  }

  onSessionDeleted(sessionId: string): void {
    const runtime = this.runtimeForSession(sessionId, this.safeResolveEngine());
    this.sessionEngine.delete(sessionId);
    this.clearRequestEngineBySession(sessionId);
    runtime.onSessionDeleted?.(sessionId);
  }

  handleEngineConfigChanged(nextEngine: CoworkAgentEngine): void {
    if (nextEngine === this.currentEngine) {
      return;
    }

    this.currentEngine = nextEngine;
    const activeSessionIds = Array.from(this.sessionEngine.keys())
      .filter((sessionId) => this.runtimeForSession(sessionId, this.sessionEngine.get(sessionId) ?? this.currentEngine).isSessionActive(sessionId));
    this.stopAllSessions();

    activeSessionIds.forEach((sessionId) => {
      this.emit('error', sessionId, ENGINE_SWITCHED_CODE);
    });
  }

  private bindRuntimeEvents(engine: CoworkAgentEngine, runtime: CoworkRuntime): void {
    runtime.on('message', (sessionId, message, beforeMessageId) => {
      this.sessionEngine.set(sessionId, engine);
      this.emit('message', sessionId, message, beforeMessageId);
    });

    runtime.on('messageUpdate', (sessionId, messageId, content, metadata) => {
      this.sessionEngine.set(sessionId, engine);
      this.emit('messageUpdate', sessionId, messageId, content, metadata);
    });

    runtime.on('sessionStatus', (sessionId, status) => {
      if (status === 'running') {
        this.sessionEngine.set(sessionId, engine);
      }
      this.emit('sessionStatus', sessionId, status);
    });

    runtime.on('btwResult', (sessionId, result) => {
      this.sessionEngine.set(sessionId, engine);
      this.emit('btwResult', sessionId, result);
    });

    runtime.on('contextUsageUpdate', (sessionId, usage) => {
      this.sessionEngine.set(sessionId, engine);
      this.emit('contextUsageUpdate', sessionId, usage);
    });

    runtime.on('contextMaintenance', (sessionId, active) => {
      this.sessionEngine.set(sessionId, engine);
      this.emit('contextMaintenance', sessionId, active);
    });

    runtime.on('permissionRequest', (sessionId, request) => {
      this.sessionEngine.set(sessionId, engine);
      this.requestEngine.set(request.requestId, engine);
      this.requestSession.set(request.requestId, sessionId);
      this.emit('permissionRequest', sessionId, request);
    });

    runtime.on('permissionResolved', (sessionId, requestId) => {
      this.requestEngine.delete(requestId);
      this.requestSession.delete(requestId);
      this.emit('permissionResolved', sessionId, requestId);
    });

    runtime.on('complete', (sessionId, claudeSessionId) => {
      this.sessionEngine.delete(sessionId);
      this.clearRequestEngineBySession(sessionId);
      this.emit('complete', sessionId, claudeSessionId);
    });

    runtime.on('error', (sessionId, error) => {
      this.sessionEngine.delete(sessionId);
      this.clearRequestEngineBySession(sessionId);
      this.emit('error', sessionId, error);
    });

    runtime.on('sessionStopped', (sessionId) => {
      this.emit('sessionStopped', sessionId);
    });

    runtime.on('backgroundJobsChanged', (sessionId, event) => {
      this.emit('backgroundJobsChanged', sessionId, event);
    });
  }

  private clearRequestEngineBySession(sessionId: string): void {
    for (const [requestId, requestSessionId] of this.requestSession.entries()) {
      if (requestSessionId !== sessionId) continue;
      this.requestSession.delete(requestId);
      this.requestEngine.delete(requestId);
    }
  }

  private safeResolveEngine(): CoworkAgentEngine {
    this.currentEngine = this.getCurrentEngine();
    return this.currentEngine;
  }

  private runtimeForSession(sessionId: string, fallback: CoworkAgentEngine): CoworkRuntime {
    return this.runtimes[this.sessionEngine.get(sessionId) ?? fallback];
  }

  private runtimeForRequest(requestId: string): CoworkRuntime {
    return this.runtimes[this.requestEngine.get(requestId) ?? this.safeResolveEngine()];
  }
}
