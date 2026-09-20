# Self-hosted Authentication and Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Youdao authentication, quota, model, and proxy dependency with a configurable self-hosted Node mock service while preserving the existing Electron auth IPC and UI.

**Architecture:** Add a dependency-free Node HTTP service under `server/` that implements the existing auth/quota/model/proxy contract with deterministic in-memory data. Route the Electron main process through `LOBSTER_SERVER_BASE_URL` and route renderer portal links through `VITE_LOBSTER_SERVER_BASE_URL`, both defaulting to the local mock service.

**Tech Stack:** Node.js built-in `http`, `crypto`, and `node:test`; TypeScript/Vitest for the Electron client; existing Electron IPC and OpenClaw token proxy.

**Spec:** `docs/superpowers/specs/2026-09-20-self-hosted-auth-credits-design.md`

## Global Constraints

- The mock service must use only Node.js standard-library modules.
- The service binds to `127.0.0.1` by default and does not log tokens.
- All JSON API responses use `{ code, message?, data? }`.
- Authenticated routes require `Authorization: Bearer <accessToken>`.
- No client endpoint defaults to a `youdao.com` hostname.
- Existing auth IPC, Renderer UI, and OpenClaw provider identifiers remain compatible.
- Preserve unrelated existing worktree changes in `src/main/main.ts` and `src/main/libs/agentEngine/coworkEngineReadiness.*`.

## Review Focus

- Login callback with a missing or mismatched `state` must be rejected rather than issuing a usable code; covered in Task 1 callback tests.
- Expired/unknown access tokens must return HTTP 401 and never expose quota data; covered in Task 1 auth tests.
- Refresh token rotation and reuse must not silently create an unrelated session; covered in Task 1 refresh tests.
- A malformed JSON request or unknown route must return bounded JSON errors without crashing the service; covered in Task 1 HTTP tests.
- Packaged/runtime configuration must use the explicit self-hosted base URL rather than falling back to a Youdao endpoint; covered in Task 2 endpoint tests and Task 3 main endpoint tests.

### Task 1: Dependency-free self-hosted mock service

**Files:**
- Create: `server/self-hosted-auth-server.mjs`
- Create: `server/self-hosted-auth-server.test.mjs`
- Modify: `package.json` to add `server:mock`
- Create: `docs/self-hosted-auth.md`

**Interfaces:**
- Produces `createSelfHostedAuthServer(options)` returning `{ server, address }` for tests and `startSelfHostedAuthServer()` for CLI startup.
- Produces routes `GET /login`, `POST /api/auth/exchange`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/user/profile`, `GET /api/user/quota`, `GET /api/user/profile-summary`, `GET /api/models/available`, `GET /api/models/pricing-catalog`, and `POST /api/proxy/v1/chat/completions`.
- Later tasks consume the same HTTP contract through the current `fetchWithAuth` and token proxy code.

- [ ] **Step 1: Write failing protocol tests**

  Add node:test cases that start the server on port 0 and assert:

  ```js
  const login = await fetch(`${baseUrl}/login?redirect_uri=${encodeURIComponent(callback)}&state=s1`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Mock User/);

  const exchange = await postJson('/api/auth/exchange', { authCode: issuedCode });
  assert.equal(exchange.body.code, 0);
  assert.equal(typeof exchange.body.data.accessToken, 'string');

  const quota = await get('/api/user/quota', accessToken);
  assert.deepEqual(quota.body.data, { creditsLimit: 1000, creditsUsed: 120, creditsRemaining: 880, planName: 'Mock Free', subscriptionStatus: 'free' });
  ```

  Include tests for state mismatch, missing Bearer token, invalid token, refresh rotation, profile summary, model catalog, malformed JSON, unknown route, and deterministic chat completion.

- [ ] **Step 2: Run the protocol tests and observe failure**

  Run: `node --test server/self-hosted-auth-server.test.mjs`

  Expected: FAIL because the service module and route implementation do not yet exist.

- [ ] **Step 3: Implement the smallest service**

  Use `http.createServer`, URL parsing, `crypto.randomBytes`, and in-memory `Map`s. Generate a short-lived authorization code only after the login page's submit action; verify the stored redirect URI and state during exchange. Store access-token and refresh-token records separately, rotate refresh tokens, and return fixed mock data. Add CORS headers, bounded body parsing, JSON helpers, and CLI environment variables `HOST` and `PORT`.

- [ ] **Step 4: Run protocol tests and verify green**

  Run: `node --test server/self-hosted-auth-server.test.mjs`

  Expected: all service tests pass with zero failures.

- [ ] **Step 5: Add startup documentation and script**

  Add `"server:mock": "node server/self-hosted-auth-server.mjs"` and document:

  ```text
  npm run server:mock
  # default: http://127.0.0.1:8787
  HOST=0.0.0.0 PORT=8787 npm run server:mock
  ```

  State clearly that the implementation is mock-only and in-memory.

### Task 2: Configurable client endpoint defaults

**Files:**
- Modify: `src/main/libs/endpoints.ts`
- Modify: `src/renderer/services/endpoints.ts`
- Create or modify: `src/renderer/services/endpoints.test.ts`
- Modify: `vite.config.ts` only if required to expose the renderer variable safely

**Interfaces:**
- Produces main `getServerApiBaseUrl(): string` with runtime override from `LOBSTER_SERVER_BASE_URL` and default `http://127.0.0.1:8787`.
- Produces renderer `getSelfHostedBaseUrl(): string` with build-time override from `VITE_LOBSTER_SERVER_BASE_URL` and the same local default.
- Existing callers keep using `getServerApiBaseUrl`, `getPortalLoginUrl`, `getPortalProfileUrl`, `getPortalCreditsDetailUrl`, `getPortalPricingUrl`, and related helpers.

- [ ] **Step 1: Write failing endpoint tests**

  Assert the default endpoint is local, a valid environment override is normalized without a trailing slash, and generated portal URLs are rooted at the configured self-hosted base.

- [ ] **Step 2: Run the endpoint tests and observe failure**

  Run: `npx vitest run src/renderer/services/endpoints.test.ts`

  Expected: FAIL because the current helpers still contain Youdao defaults and no renderer base helper.

- [ ] **Step 3: Implement endpoint configuration**

  Replace production/test Youdao defaults in the touched auth/portal helpers with the self-hosted resolver. Keep unrelated update/download endpoints unchanged unless they are part of the authentication or credit flow. Main endpoint resolution must honor the runtime override in packaged builds too.

- [ ] **Step 4: Run endpoint tests and verify green**

  Run: `npx vitest run src/renderer/services/endpoints.test.ts`

  Expected: all endpoint tests pass and no generated URL contains `youdao.com`.

### Task 3: Route login initiation through the self-hosted service

**Files:**
- Modify: `src/renderer/services/auth.ts`
- Modify: `src/main/main.ts` only in the existing auth login handler if needed
- Modify: `src/renderer/services/auth.test.ts`
- Modify: `src/main/libs/endpoints.test.ts` if that test file exists after Task 2

**Interfaces:**
- Existing `window.electron.auth.login(loginUrl?)` remains unchanged.
- `authService.login()` must use the configured self-hosted `/login` URL and no longer query the Youdao Overmind login-url endpoint.
- Existing exchange, refresh, quota, profile-summary, and model-loading code continues to use the main-process server base.

- [ ] **Step 1: Add failing login-source tests**

  Extend auth service tests so a login call invokes the Electron auth bridge with the configured self-hosted login URL, while retaining the existing browser handoff result handling.

- [ ] **Step 2: Run the focused auth tests and observe failure**

  Run: `npx vitest run src/renderer/services/auth.test.ts`

  Expected: FAIL because the current implementation first calls the Overmind login-url endpoint and falls back to the Youdao Portal URL.

- [ ] **Step 3: Implement the login source change**

  Make the renderer resolve the self-hosted login URL directly. Preserve the main process local callback/state construction, deep-link fallback, token exchange, refresh behavior, and auth lifecycle events. Do not alter the existing auth IPC channel names.

- [ ] **Step 4: Run the focused auth tests and verify green**

  Run: `npx vitest run src/renderer/services/auth.test.ts`

  Expected: all auth service tests pass.

- [ ] **Step 5: Add a main endpoint assertion**

  Add or extend a pure endpoint test to prove `LOBSTER_SERVER_BASE_URL` is honored in runtime resolution and is available to the login exchange, quota, and proxy callers.

### Task 4: Full verification and operator handoff

**Files:**
- Modify: `README_zh.md` with the self-hosted startup/configuration section
- Modify: `.env.example` with `LOBSTER_SERVER_BASE_URL` and `VITE_LOBSTER_SERVER_BASE_URL` examples if appropriate
- Modify: only files required by lint/type errors discovered in Tasks 1–3

**Interfaces:**
- Operators can start the mock service and build/run the desktop client without editing source files.
- No new public API is introduced beyond the documented environment variables and mock service routes.

- [ ] **Step 1: Run mock service smoke test**

  Start `npm run server:mock` on an ephemeral test port or use the node:test harness to verify login, exchange, quota, profile summary, models, and chat completion together.

- [ ] **Step 2: Run changed-file lint**

  Run the repository's CI-equivalent ESLint command for every touched `.ts`/`.tsx` file.

  Expected: zero errors, zero warnings for changed TypeScript files.

- [ ] **Step 3: Run project verification**

  Run:

  ```text
  npm test
  npm run compile:electron
  npm run build
  ```

  Expected: each command exits with code 0. If an unrelated pre-existing failure occurs, record the exact command and failure separately instead of broadening the change.

- [ ] **Step 4: Review the diff and dependency scan**

  Confirm no new `youdao.com` endpoint remains in the auth/portal/proxy path, no tokens are logged, no existing unrelated changes were reverted, and the mock server has no third-party dependency.

- [ ] **Step 5: Document limitations**

  Report that the service is deterministic/in-memory, does not implement real accounts or billing, and that production deployment still needs persistent storage, HTTPS, real identity, and token-at-rest hardening.

