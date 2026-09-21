import { EventEmitter } from 'events';
import { describe, expect, test, vi } from 'vitest';

import { CoworkEngineRouter } from './coworkEngineRouter';
import type { CoworkRuntime } from './types';

function createCodexRuntime(): CoworkRuntime {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter) as CoworkRuntime['on'],
    off: emitter.off.bind(emitter) as CoworkRuntime['off'],
    startSession: vi.fn().mockResolvedValue(undefined),
    continueSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn(),
    stopAllSessions: vi.fn(),
    respondToPermission: vi.fn(),
    isSessionActive: vi.fn().mockReturnValue(false),
    getSessionConfirmationMode: vi.fn().mockReturnValue('modal'),
  };
}

describe('CoworkEngineRouter Codex-only runtime', () => {
  test('starts a new conversation through Codex without an OpenClaw fallback', async () => {
    const codexRuntime = createCodexRuntime();
    const router = new CoworkEngineRouter({ codexRuntime });

    await router.startSession('session-1', 'Draft the report');

    expect(codexRuntime.startSession).toHaveBeenCalledWith('session-1', 'Draft the report', {});
  });
});
