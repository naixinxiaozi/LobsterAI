import type { OpenClawEngineStatus } from '../openclawEngineManager';
import type { CoworkAgentEngine } from './types';

export const ensureCoworkEngineReady = async (
  engine: CoworkAgentEngine,
  ensureOpenClaw: () => Promise<OpenClawEngineStatus>,
): Promise<OpenClawEngineStatus> => {
  if (engine === 'openclaw') {
    return ensureOpenClaw();
  }

  return {
    phase: 'running',
    version: null,
    canRetry: false,
  };
};
