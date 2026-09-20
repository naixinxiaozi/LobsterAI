import { describe, expect, test, vi } from 'vitest';

import { ensureCoworkEngineReady } from './coworkEngineReadiness';

describe('ensureCoworkEngineReady', () => {
  test('does not probe OpenClaw when Codex is the active engine', async () => {
    const ensureOpenClaw = vi.fn().mockRejectedValue(
      new Error('Bundled OpenClaw runtime is missing.'),
    );

    await expect(ensureCoworkEngineReady('codex', ensureOpenClaw)).resolves.toMatchObject({
      phase: 'running',
    });
    expect(ensureOpenClaw).not.toHaveBeenCalled();
  });

  test('ensures OpenClaw when OpenClaw is the active engine', async () => {
    const status = { phase: 'starting' as const, version: null, canRetry: false };
    const ensureOpenClaw = vi.fn().mockResolvedValue(status);

    await expect(ensureCoworkEngineReady('openclaw', ensureOpenClaw)).resolves.toBe(status);
    expect(ensureOpenClaw).toHaveBeenCalledOnce();
  });
});
