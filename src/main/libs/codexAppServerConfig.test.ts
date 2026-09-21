import { describe, expect, test } from 'vitest';

import { buildCodexHomeConfig } from './codexAppServerConfig';

describe('buildCodexHomeConfig', () => {
  test('creates independent Codex configuration without a custom provider credential', () => {
    const config = buildCodexHomeConfig({ webSearch: 'cached' });

    expect(config).toContain('web_search = "cached"');
    expect(config).not.toContain('model_provider');
    expect(config).not.toContain('env_key');
    expect(config).not.toContain('LOBSTERAI_DEEPSEEK_API_KEY');
  });
});
