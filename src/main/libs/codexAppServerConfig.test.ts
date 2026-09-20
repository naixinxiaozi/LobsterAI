import { describe, expect, test } from 'vitest';

import { buildCodexHomeConfig, readDotEnvValue } from './codexAppServerConfig';

describe('buildCodexHomeConfig', () => {
  test('creates a DeepSeek Responses provider without embedding the API key', () => {
    const config = buildCodexHomeConfig({ model: 'deepseek-flash' });

    expect(config).toContain('model = "deepseek-flash"');
    expect(config).toContain('model_provider = "deepseek"');
    expect(config).toContain('base_url = "https://api.deepseek.com/"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('env_key = "LOBSTERAI_DEEPSEEK_API_KEY"');
    expect(config).not.toContain('sk-');
  });

  test('reads Engine_AUTH_API_KEY from dotenv syntax without exposing its value in config', () => {
    const env = 'OTHER=value\nexport Engine_AUTH_API_KEY="from-dotenv"\n';

    expect(readDotEnvValue(env, 'Engine_AUTH_API_KEY')).toBe('from-dotenv');
    expect(buildCodexHomeConfig()).not.toContain('from-dotenv');
  });
});
