import { describe, expect, test } from 'vitest';

import { resolveSelfHostedServerBaseUrl } from './selfHostedServerBaseUrl';

describe('selfHostedServerBaseUrl', () => {
  test('uses a local default when no runtime override is configured', () => {
    expect(resolveSelfHostedServerBaseUrl(undefined)).toBe('http://127.0.0.1:8787');
  });

  test('normalizes an explicit remote self-hosted URL', () => {
    expect(resolveSelfHostedServerBaseUrl(' https://auth.example.test/lobster/ ')).toBe(
      'https://auth.example.test/lobster',
    );
  });

  test('rejects non-http URLs and credentials', () => {
    expect(() => resolveSelfHostedServerBaseUrl('file:///tmp/auth')).toThrow('HTTP(S)');
    expect(() => resolveSelfHostedServerBaseUrl('https://user:pass@example.test')).toThrow(
      'credentials',
    );
  });
});
