import { EventEmitter } from 'events';

import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import {
  BackgroundJobKillOutcome,
  type BackgroundJobKillResult,
  type CoworkBackgroundJob,
} from '../../../shared/cowork/backgroundJobs';
import type { CoworkBtwAbortResponse, CoworkBtwSubmitResponse } from '../../../shared/cowork/btw';
import type { CoworkGoal } from '../../../shared/cowork/goal';
import type { CoworkSteerResponse } from '../../../shared/cowork/steer';
import type {
  CoworkContextUsage,
  CoworkContinueOptions,
  CoworkForkCompactionSummary,
  CoworkRuntime,
  CoworkRuntimeEvents,
  CoworkSessionPatchResult,
  CoworkStartOptions,
  PermissionResult,
} from './types';

type RouterDeps = { codexRuntime: CoworkRuntime };

/** Routes all Cowork activity through the single supported Codex runtime. */
export class CoworkEngineRouter extends EventEmitter implements CoworkRuntime {
  private readonly runtime: CoworkRuntime;
  private readonly activeSessionIds = new Set<string>();

  constructor({ codexRuntime }: RouterDeps) {
    super();
    this.runtime = codexRuntime;
    this.bindRuntimeEvents(codexRuntime);
  }

  override on<U extends keyof CoworkRuntimeEvents>(event: U, listener: CoworkRuntimeEvents[U]): this {
    return super.on(event, listener);
  }

  override off<U extends keyof CoworkRuntimeEvents>(event: U, listener: CoworkRuntimeEvents[U]): this {
    return super.off(event, listener);
  }

  async startSession(sessionId: string, prompt: string, options: CoworkStartOptions = {}): Promise<void> {
    this.activeSessionIds.add(sessionId);
    try {
      await this.runtime.startSession(sessionId, prompt, options);
    } catch (error) {
      this.activeSessionIds.delete(sessionId);
      throw error;
    }
  }

  async continueSession(sessionId: string, prompt: string, options: CoworkContinueOptions = {}): Promise<void> {
    this.activeSessionIds.add(sessionId);
    try {
      await this.runtime.continueSession(sessionId, prompt, options);
    } catch (error) {
      this.activeSessionIds.delete(sessionId);
      throw error;
    }
  }

  async submitSteer(sessionId: string, text: string, clientSteerId: string): Promise<CoworkSteerResponse> {
    if (!this.runtime.submitSteer) throw new Error('Steer is not supported by Codex');
    return this.runtime.submitSteer(sessionId, text, clientSteerId);
  }

  async submitBtw(sessionId: string, question: string, runId: string): Promise<CoworkBtwSubmitResponse> {
    if (!this.runtime.submitBtw) throw new Error('BTW side questions are not supported by Codex');
    return this.runtime.submitBtw(sessionId, question, runId);
  }

  async abortBtw(sessionId: string, runId: string): Promise<CoworkBtwAbortResponse> {
    if (!this.runtime.abortBtw) throw new Error('Stopping BTW side questions is not supported by Codex');
    return this.runtime.abortBtw(sessionId, runId);
  }

  async runGoalCommand(sessionId: string, command: string): Promise<CoworkGoal | null> {
    if (!this.runtime.runGoalCommand) throw new Error('Goal commands are not supported by Codex');
    return this.runtime.runGoalCommand(sessionId, command);
  }

  async patchSession(sessionId: string, patch: OpenClawSessionPatch): Promise<CoworkSessionPatchResult | void> {
    if (!this.runtime.patchSession) throw new Error('Session patch is not supported by Codex');
    return this.runtime.patchSession(sessionId, patch);
  }

  async getContextUsage(sessionId: string): Promise<CoworkContextUsage | null> {
    return this.runtime.getContextUsage?.(sessionId) ?? null;
  }

  async compactContext(sessionId: string): Promise<{ compacted: boolean; reason?: string; usage?: CoworkContextUsage | null }> {
    if (!this.runtime.compactContext) throw new Error('Context compaction is not supported by Codex');
    return this.runtime.compactContext(sessionId);
  }

  async getForkCompactionSummary(sessionId: string, beforeCreatedAt?: number): Promise<CoworkForkCompactionSummary | null> {
    return this.runtime.getForkCompactionSummary?.(sessionId, beforeCreatedAt) ?? null;
  }

  stopSession(sessionId: string): void { this.runtime.stopSession(sessionId); this.activeSessionIds.delete(sessionId); }
  stopAllSessions(): void { this.runtime.stopAllSessions(); this.activeSessionIds.clear(); }
  respondToPermission(requestId: string, result: PermissionResult): void | Promise<void> {
    return this.runtime.respondToPermission(requestId, result);
  }
  isSessionActive(sessionId: string): boolean { return this.runtime.isSessionActive(sessionId); }
  getActiveSessionIds(): string[] { return [...this.activeSessionIds].filter(id => this.runtime.isSessionActive(id)); }
  getPendingQuestions() { return this.runtime.getPendingQuestions?.() ?? []; }
  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.runtime.getSessionConfirmationMode(sessionId);
  }
  async deleteSubagentSession(parentSessionId: string, runId: string): Promise<boolean> {
    return this.runtime.deleteSubagentSession?.(parentSessionId, runId) ?? false;
  }
  async listBackgroundJobs(sessionId: string): Promise<CoworkBackgroundJob[]> {
    return this.runtime.listBackgroundJobs?.(sessionId) ?? [];
  }
  async killBackgroundJob(sessionId: string, jobId: string): Promise<BackgroundJobKillResult> {
    return this.runtime.killBackgroundJob?.(sessionId, jobId) ?? { outcome: BackgroundJobKillOutcome.Unsupported };
  }
  async clearSettledBackgroundJobs(sessionId: string): Promise<CoworkBackgroundJob[]> {
    return this.runtime.clearSettledBackgroundJobs?.(sessionId) ?? [];
  }
  onSessionDeleted(sessionId: string): void { this.activeSessionIds.delete(sessionId); this.runtime.onSessionDeleted?.(sessionId); }

  private bindRuntimeEvents(runtime: CoworkRuntime): void {
    (['message', 'messageUpdate', 'sessionStatus', 'btwResult', 'goalUpdate', 'contextUsageUpdate',
      'contextMaintenance', 'permissionRequest', 'permissionResolved', 'complete', 'error',
      'sessionStopped', 'backgroundJobsChanged'] as const).forEach(event => {
      runtime.on(event, ((...args: unknown[]) => this.emit(event, ...args)) as CoworkRuntimeEvents[typeof event]);
    });
    runtime.on('complete', sessionId => this.activeSessionIds.delete(sessionId));
    runtime.on('error', sessionId => this.activeSessionIds.delete(sessionId));
  }
}
