import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import { OpenClawEngineErrorCode, OpenClawEnginePhase } from '../../../shared/openclawEngine/constants';
import type { OpenClawEngineStatus } from '../../types/cowork';
import EngineFailureOverlay from './EngineFailureOverlay';

const snapshot = vi.hoisted(() => ({ status: null as OpenClawEngineStatus | null }));

vi.mock('../../services/cowork', () => ({
  coworkService: { getOpenClawEngineStatusSnapshot: () => snapshot.status },
}));
vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../services/logReporter', () => ({ LogReporterAction: {}, reportYdAnalyzer: vi.fn() }));

describe('EngineFailureOverlay', () => {
  test('shows the initial startup cause without requiring a repair attempt', () => {
    snapshot.status = {
      phase: OpenClawEnginePhase.Error,
      version: '2026.8.1',
      message: 'Cannot find package openclaw imported from discord/dist/owner-access.js',
      canRetry: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(EngineFailureOverlay, { activeEngine: 'openclaw' }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain(snapshot.status.message);
    expect(html).toContain('coworkOpenClawQuickRepair');
  });

  test('does not offer repair while the supervisor is recovering', () => {
    snapshot.status = {
      phase: OpenClawEnginePhase.Starting,
      version: '2026.8.1',
      message: 'Restarting OpenClaw gateway (attempt 1/5)...',
      canRetry: false,
    };

    expect(renderToStaticMarkup(
      React.createElement(EngineFailureOverlay, { activeEngine: 'openclaw' }),
    )).toBe('');
  });

  test('guides reinstall instead of config repair when runtime workers are missing', () => {
    snapshot.status = {
      phase: OpenClawEnginePhase.Error,
      version: '2026.8.1',
      errorCode: OpenClawEngineErrorCode.RuntimeFilesMissing,
      canRetry: false,
    };
    const html = renderToStaticMarkup(
      React.createElement(EngineFailureOverlay, { activeEngine: 'openclaw' }),
    );
    expect(html).toContain('coworkOpenClawRuntimeDamagedRepairHint');
    expect(html).not.toContain('coworkOpenClawQuickRepair');
    expect(html).not.toContain('coworkOpenClawRestartGateway');
  });

  test('does not block the Codex engine when OpenClaw is unavailable', () => {
    snapshot.status = {
      phase: OpenClawEnginePhase.Error,
      version: null,
      message: 'Bundled OpenClaw runtime is missing.',
      canRetry: true,
    };

    expect(renderToStaticMarkup(
      React.createElement(EngineFailureOverlay, { activeEngine: 'codex' }),
    )).toBe('');
  });
});
