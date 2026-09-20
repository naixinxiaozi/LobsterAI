import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;

const MOCK_USER = {
  id: 'mock-user',
  userId: 'mock-user',
  nickname: 'Mock User',
  phone: '13800000000',
  avatarUrl: null,
  accountMode: 'personal',
};

const MOCK_QUOTA = {
  planName: 'Mock Free',
  subscriptionStatus: 'free',
  creditsLimit: 1000,
  creditsUsed: 120,
  creditsRemaining: 880,
  hasPaidCredits: false,
  mediaGenerationEntitled: false,
};

const MOCK_PROFILE_SUMMARY = {
  id: MOCK_USER.id,
  nickname: MOCK_USER.nickname,
  totalCreditsRemaining: MOCK_QUOTA.creditsRemaining,
  creditItems: [{
    id: 'mock-credit-item',
    name: 'Mock Free Credits',
    remaining: MOCK_QUOTA.creditsRemaining,
    expiresAt: null,
  }],
  availableResetCount: 0,
  availablePromoSubscriptionCount: 0,
  creditsResetCampaign: null,
};

const MOCK_MODELS = [{
  modelId: 'deepseek-flash',
  modelName: 'DeepSeek Flash',
  provider: 'Self-hosted Mock',
  apiFormat: 'openai',
  supportsImage: false,
  supportsVideo: false,
  supportsThinking: false,
  supportsToolCalling: true,
  agenticReady: true,
  contextWindow: 128000,
  maxTokens: 4096,
  accessible: true,
  costMultiplier: 0,
}];

const MOCK_PRICING_CATALOG = {
  textModels: [{
    modelId: 'deepseek-flash',
    modelName: 'DeepSeek Flash',
    provider: 'Self-hosted Mock',
    providerLabel: 'Self-hosted Mock',
    description: 'Deterministic self-hosted DeepSeek Flash mock model',
    supportsImage: false,
    supportsThinking: false,
    costMultiplier: 0,
  }],
  imageModels: [],
  videoModels: [],
};

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
};

const success = (data) => ({ code: 0, data });
const failure = (code, message) => ({ code, message });

const token = (prefix) => `${prefix}-${randomBytes(24).toString('hex')}`;

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      reject(new Error('Request body is too large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!body) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error('Malformed JSON body'));
    }
  });
  req.on('error', reject);
});

const getBearerToken = (req) => {
  const value = req.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  const accessToken = value.slice('Bearer '.length).trim();
  return accessToken || null;
};

const html = (redirectUri, state) => `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>LobsterAI 自部署登录</title></head>
  <body style="font-family: sans-serif; max-width: 32rem; margin: 4rem auto; line-height: 1.6">
    <h1>LobsterAI 自部署登录</h1>
    <p>当前为本地 Mock 用户：Mock User</p>
    <p>点击下方按钮完成登录，客户端会自动回到桌面应用。</p>
    <form method="get" action="/login">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="approve" value="1">
      <button type="submit">使用 Mock User 登录</button>
    </form>
  </body>
</html>`;

const portalHtml = (detail) => `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>LobsterAI 自部署账户</title></head>
  <body style="font-family: sans-serif; max-width: 42rem; margin: 4rem auto; line-height: 1.6">
    <h1>LobsterAI 自部署账户</h1>
    <p>用户：${escapeHtml(MOCK_USER.nickname)}</p>
    <p>套餐：${escapeHtml(MOCK_QUOTA.planName)}</p>
    <p>剩余积分：<strong>${MOCK_QUOTA.creditsRemaining}</strong></p>
    ${detail ? '<p>积分明细：Mock Free Credits</p><p>当前服务使用固定 Mock 数据。</p>' : '<p><a href="/portal/profile/detail">查看积分明细</a></p>'}
  </body>
</html>`;

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

export const createSelfHostedAuthServer = async ({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
} = {}) => {
  const loginCodes = new Map();
  const accessTokens = new Map();
  const refreshTokens = new Map();

  const issueSession = () => {
    const accessToken = token('mock-access');
    const refreshToken = token('mock-refresh');
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    accessTokens.set(accessToken, { refreshToken, expiresAt });
    refreshTokens.set(refreshToken, { accessToken, expiresAt });
    return { accessToken, refreshToken };
  };

  const authenticatedSession = req => {
    const accessToken = getBearerToken(req);
    const session = accessToken ? accessTokens.get(accessToken) : null;
    if (!session || session.expiresAt <= Date.now()) {
      if (accessToken) accessTokens.delete(accessToken);
      return null;
    }
    return { accessToken, ...session };
  };

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

    try {
      if (req.method === 'GET' && url.pathname === '/login') {
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const state = url.searchParams.get('state') ?? '';
        if (!redirectUri || !state) {
          json(res, 400, failure(40001, 'redirect_uri and state are required'));
          return;
        }
        if (url.searchParams.get('approve') !== '1') {
          const body = html(redirectUri, state);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          return;
        }
        const code = token('mock-code');
        loginCodes.set(code, { redirectUri, state, expiresAt: Date.now() + CODE_TTL_MS });
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', state);
        res.writeHead(302, { Location: callback.toString() });
        res.end();
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/portal' || url.pathname === '/portal/profile')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(portalHtml(false));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/portal/profile/detail') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(portalHtml(true));
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/portal/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(portalHtml(false));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/download-list') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="zh-CN"><body><h1>LobsterAI 下载</h1><p>自部署版本请使用当前构建产物。</p></body></html>');
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/exchange') {
        const body = await readBody(req);
        const record = typeof body.authCode === 'string' ? loginCodes.get(body.authCode) : null;
        if (!record || record.expiresAt <= Date.now()) {
          if (body.authCode) loginCodes.delete(body.authCode);
          json(res, 401, failure(40101, 'Invalid or expired auth code'));
          return;
        }
        loginCodes.delete(body.authCode);
        const session = issueSession();
        json(res, 200, success({ ...session, user: MOCK_USER, quota: MOCK_QUOTA }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
        const body = await readBody(req);
        const record = typeof body.refreshToken === 'string'
          ? refreshTokens.get(body.refreshToken)
          : null;
        if (!record || record.expiresAt <= Date.now()) {
          json(res, 401, failure(40102, 'Invalid or expired refresh token'));
          return;
        }
        accessTokens.delete(record.accessToken);
        refreshTokens.delete(body.refreshToken);
        const session = issueSession();
        json(res, 200, success(session));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const session = authenticatedSession(req);
        if (session) {
          accessTokens.delete(session.accessToken);
          refreshTokens.delete(session.refreshToken);
        }
        json(res, 200, success(null));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/models/available') {
        json(res, 200, success(MOCK_MODELS));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/models/pricing-catalog') {
        json(res, 200, success(MOCK_PRICING_CATALOG));
        return;
      }
      if (req.method === 'GET' && /^\/api\/(skills|kits)\/store\/(test|prod)$/.test(url.pathname)) {
        json(res, 200, success([]));
        return;
      }
      if (req.method === 'GET' && /^\/api\/update\/(test|prod|test-manual|prod-manual)$/.test(url.pathname)) {
        json(res, 200, success({ updateAvailable: false }));
        return;
      }

      const session = authenticatedSession(req);
      const requiresAuth = url.pathname.startsWith('/api/user/')
        || url.pathname === '/api/proxy/v1/chat/completions';
      if (requiresAuth && !session) {
        json(res, 401, failure(40100, 'Authentication required'));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/user/profile') {
        json(res, 200, success(MOCK_USER));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/user/quota') {
        json(res, 200, success(MOCK_QUOTA));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/user/profile-summary') {
        json(res, 200, success(MOCK_PROFILE_SUMMARY));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/proxy/v1/chat/completions') {
        const body = await readBody(req);
        json(res, 200, {
          id: 'mock-chat-completion',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model || 'deepseek-flash',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '这是自部署 Mock 服务的回复。' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
        return;
      }

      json(res, 404, failure(40400, 'Route not found'));
    } catch (error) {
      if (error?.message === 'Malformed JSON body' || error?.message === 'Request body is too large') {
        json(res, 400, failure(40000, error.message));
        return;
      }
      console.error('[SelfHostedAuth] request failed:', error?.message ?? error);
      json(res, 500, failure(50000, 'Internal server error'));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const resolvedAddress = `http://${host}:${typeof address === 'object' && address ? address.port : port}`;
  return { server, address: resolvedAddress };
};

export const startSelfHostedAuthServer = async () => {
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const result = await createSelfHostedAuthServer({ host, port });
  console.log(`[SelfHostedAuth] listening at ${result.address}`);
  return result;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startSelfHostedAuthServer();
}
