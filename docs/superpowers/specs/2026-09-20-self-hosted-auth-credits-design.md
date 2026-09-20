# Self-hosted Authentication and Credits Service

## Goal

让 LobsterAI 在不依赖 `youdao.com` 的情况下完成最小可用的登录、token 续期、积分/额度查询、云端模型列表加载和 mock 云端模型调用。服务端协议保持与当前 Electron 客户端兼容，便于以后把 mock 数据替换为真实业务实现。

## Scope

### Included

- 新增一个只依赖 Node.js 标准库的自部署 mock 服务。
- 支持浏览器登录页和 Electron 本地回调登录。
- 支持 access token、refresh token、登出和 Bearer 鉴权。
- 支持用户资料、quota、积分明细、可用模型、定价目录。
- 支持 OpenAI 兼容的 mock `/api/proxy/v1/chat/completions`。
- 客户端服务端地址可通过环境变量配置，默认使用本机服务。
- 删除客户端对 `youdao.com` 服务地址的默认依赖。
- 增加服务协议测试、端点配置测试和使用文档。

### Excluded

- 真实用户注册、密码存储、短信/第三方 OAuth。
- 多租户数据库和后台管理系统。
- 真实计费、充值、支付和积分扣减结算。
- 改造现有 Renderer UI 或 OpenClaw 的认证 IPC 结构。
- 生产级 token 密钥轮换和高可用部署。

## Architecture

```text
Electron Renderer
  -> existing auth IPC
Electron Main Process
  -> configurable self-hosted base URL
Self-hosted Node service
  -> login page / callback redirect
  -> auth, quota, model, and proxy-compatible routes
```

### Client configuration

- Main process reads `LOBSTER_SERVER_BASE_URL` at runtime in development and packaged builds.
- Renderer portal URLs use `VITE_LOBSTER_SERVER_BASE_URL` at build time and fall back to `http://127.0.0.1:8787`.
- No client endpoint defaults to a `youdao.com` hostname.
- Existing test-mode behavior remains available for explicit test configuration, but does not select a Youdao hostname by default.

### Mock service behavior

- Default bind address: `127.0.0.1`.
- Default port: `8787`.
- Default user: `mock-user` / `Mock User`.
- Login endpoint accepts `redirect_uri` and `state`, then redirects with a short-lived authorization code.
- Exchange and refresh tokens are opaque random values held in memory.
- Service restart invalidates all sessions; this is intentional for the mock implementation.
- Quota and profile summary return deterministic credits so UI and client flows can be verified.
- Chat completion returns a deterministic mock assistant response and usage object.

## API contract

```text
GET  /login
POST /api/auth/exchange
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/user/profile
GET  /api/user/quota
GET  /api/user/profile-summary
GET  /api/models/available
GET  /api/models/pricing-catalog
POST /api/proxy/v1/chat/completions
```

All JSON API responses use `{ code, message?, data? }`. Authenticated routes require `Authorization: Bearer <accessToken>`.

## Error handling

- Missing or invalid tokens return HTTP 401 and a non-zero application code.
- Unknown routes return HTTP 404 JSON.
- Malformed JSON returns HTTP 400 JSON.
- Client retains its existing distinction between unauthenticated, expired, and temporarily unavailable states.
- If the self-hosted service is unavailable, local/custom providers remain unaffected; cloud model UI shows its existing unavailable state.

## Security boundary

The mock service is for local development and controlled self-hosted use. It must bind to loopback by default, avoid logging tokens, and use random opaque tokens. It is not a production identity provider. The existing client token persistence remains unchanged in this first pass and is explicitly a follow-up hardening item.

## Verification

- Node built-in tests cover login redirect, exchange, refresh, authentication failures, quota, profile summary, model catalog, and mock completion.
- Renderer endpoint tests cover self-hosted defaults and environment overrides.
- Run targeted Vitest tests, the Node mock-service tests, changed-file ESLint, `npm run compile:electron`, and `npm run build` where available.
- Manually start the mock service and verify the Electron login URL, callback, quota display, model list, and mock chat request.

