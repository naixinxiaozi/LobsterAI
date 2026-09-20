import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createSelfHostedAuthServer } from './self-hosted-auth-server.mjs';

const callbackUrl = 'http://127.0.0.1:45678/auth/callback';

let server;
let baseUrl;

before(async () => {
  ({ server, address: baseUrl } = await createSelfHostedAuthServer({ port: 0 }));
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML login pages are intentionally not JSON.
  }
  return { response, text, body };
};

const postJson = (path, payload, token) => request(path, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(payload),
});

describe('self-hosted auth service', () => {
  test('starts when launched as a Windows-style CLI entrypoint', async () => {
    const serverPath = fileURLToPath(new URL('./self-hosted-auth-server.mjs', import.meta.url));
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const output = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 3000);
        child.stdout.on('data', chunk => {
          stdout += chunk.toString();
          if (stdout.includes('[SelfHostedAuth] listening at ')) {
            clearTimeout(timer);
            resolve(stdout);
          }
        });
        child.stderr.on('data', chunk => {
          stderr += chunk.toString();
        });
        child.once('error', reject);
        child.once('exit', code => {
          if (code !== null) reject(new Error(`server exited before starting: ${code}; ${stderr}`));
        });
      });

      assert.match(output, /\[SelfHostedAuth\] listening at http:\/\/127\.0\.0\.1:\d+/);
    } finally {
      child.kill();
    }
  });

  test('serves a login page with the requested callback context', async () => {
    const result = await request(
      `/login?redirect_uri=${encodeURIComponent(callbackUrl)}&state=state-1`,
    );

    assert.equal(result.response.status, 200);
    assert.match(result.text, /Mock User/);
    assert.match(result.text, /state-1/);
  });

  test('exchanges an approved login code and returns the mock quota', async () => {
    const login = await request(
      `/login?redirect_uri=${encodeURIComponent(callbackUrl)}&state=state-2&approve=1`,
    );
    assert.equal(login.response.status, 302);
    const location = new URL(login.response.headers.get('location'));
    const code = location.searchParams.get('code');
    assert.equal(location.searchParams.get('state'), 'state-2');

    const exchange = await postJson('/api/auth/exchange', { authCode: code });
    assert.equal(exchange.response.status, 200);
    assert.equal(exchange.body.code, 0);
    assert.equal(exchange.body.data.user.id, 'mock-user');
    assert.equal(exchange.body.data.quota.creditsRemaining, 880);
    assert.equal(typeof exchange.body.data.accessToken, 'string');
    assert.equal(typeof exchange.body.data.refreshToken, 'string');
  });

  test('rejects invalid authentication and returns profile summary for a valid token', async () => {
    const unauthorized = await request('/api/user/quota');
    assert.equal(unauthorized.response.status, 401);
    assert.notEqual(unauthorized.body.code, 0);

    const login = await request(
      `/login?redirect_uri=${encodeURIComponent(callbackUrl)}&state=state-3&approve=1`,
    );
    const code = new URL(login.response.headers.get('location')).searchParams.get('code');
    const exchange = await postJson('/api/auth/exchange', { authCode: code });
    const token = exchange.body.data.accessToken;

    const summary = await request('/api/user/profile-summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(summary.response.status, 200);
    assert.equal(summary.body.data.totalCreditsRemaining, 880);
    assert.equal(summary.body.data.creditItems.length, 1);
  });

  test('rotates refresh tokens and rejects the old refresh token', async () => {
    const login = await request(
      `/login?redirect_uri=${encodeURIComponent(callbackUrl)}&state=state-4&approve=1`,
    );
    const code = new URL(login.response.headers.get('location')).searchParams.get('code');
    const exchange = await postJson('/api/auth/exchange', { authCode: code });
    const oldRefreshToken = exchange.body.data.refreshToken;

    const refresh = await postJson('/api/auth/refresh', { refreshToken: oldRefreshToken });
    assert.equal(refresh.response.status, 200);
    assert.notEqual(refresh.body.data.refreshToken, oldRefreshToken);

    const reused = await postJson('/api/auth/refresh', { refreshToken: oldRefreshToken });
    assert.equal(reused.response.status, 401);
  });

  test('serves model metadata and a deterministic OpenAI-compatible completion', async () => {
    const models = await request('/api/models/available');
    assert.equal(models.response.status, 200);
    assert.equal(models.body.data[0].modelId, 'deepseek-flash');

    const completion = await postJson('/api/proxy/v1/chat/completions', {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(completion.response.status, 401);

    const login = await request(
      `/login?redirect_uri=${encodeURIComponent(callbackUrl)}&state=state-5&approve=1`,
    );
    const code = new URL(login.response.headers.get('location')).searchParams.get('code');
    const exchange = await postJson('/api/auth/exchange', { authCode: code });
    const authorized = await postJson('/api/proxy/v1/chat/completions', {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: 'hello' }],
    }, exchange.body.data.accessToken);
    assert.equal(authorized.response.status, 200);
    assert.equal(authorized.body.choices[0].message.content, '这是自部署 Mock 服务的回复。');
  });

  test('serves a simple portal page for profile and credit links', async () => {
    const profile = await request('/portal/profile');
    assert.equal(profile.response.status, 200);
    assert.match(profile.text, /Mock User/);

    const detail = await request('/portal/profile/detail');
    assert.equal(detail.response.status, 200);
    assert.match(detail.text, /880/);
  });

  test('returns bounded JSON errors for malformed JSON and unknown routes', async () => {
    const malformed = await request('/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.response.status, 400);
    assert.equal(typeof malformed.body.message, 'string');

    const unknown = await request('/unknown');
    assert.equal(unknown.response.status, 404);
    assert.notEqual(unknown.body.code, 0);
  });
});
