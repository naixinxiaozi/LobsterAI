# Codex Office Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OpenClaw application runtime with a pinned Codex app-server and present LobsterAI as a project-centered office workbench.

**Architecture:** Electron main owns one Codex JSONL process using the application-scoped `CODEX_HOME`; renderer UI continues to communicate only through preload IPC. Projects own allowed roots, conversations own Codex thread IDs, and all tool actions are mapped to existing approval and artifact boundaries. OpenClaw, IM, scheduled-task, voice, and Worktree subsystems are removed rather than retained as compatibility paths.

**Tech Stack:** Electron 43, React 18, Redux Toolkit, TypeScript, SQLite/better-sqlite3, Vitest, Codex app-server JSONL JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-09-20-codex-office-workbench-design.md`

## Global Constraints

- Require Node.js `>=24.15.0 <25` and use `npm.cmd` when PowerShell blocks `npm`.
- Use `%APPDATA%/LobsterAI/codex` as the only Codex home; do not read or write `%USERPROFILE%/.codex`.
- Development resolves Windows `codex`; packaging embeds a pinned compatible Codex binary.
- LobsterAI self-hosted login, credit/quota, and model catalog stay independent from Codex authentication and configuration.
- Never serialize tokens, API keys, or credential-bearing headers into logs, diagnostics, tests, fixtures, or shared configuration.
- Remote capability means Codex web search only; do not add remote desktop, remote app-server, host-control, or Worktree support.
- Delete legacy OpenClaw/agent/IM/scheduled-task/plugin data after a recoverable database backup; do not expose old-history viewing or export.
- Do not commit until the user has tested and explicitly asked for a commit.
- Every production behavior begins with a failing Vitest test; all touched TypeScript files pass changed-file ESLint with zero warnings.

## Review Focus

- A partial or malformed JSONL message must surface a scoped app-server error, not crash Electron or resolve a different request (Task 1).
- A Codex process exit while an approval is visible must dismiss that approval and leave the conversation stopped (Task 2).
- A migration interrupted after backup but before cleanup must restart idempotently without leaving OpenClaw rows or an uninitialized project schema (Task 3).
- A temporary conversation must not inherit a previous project's filesystem root or memory (Task 4).
- A live-search request must not expand local command networking or enable remote host access (Task 6).

---

## File Structure

- `src/main/libs/codexAppServerProtocol.ts`: narrow generated-version protocol types and method constants.
- `src/main/libs/codexAppServerClient.ts`: JSONL framing, request correlation, server requests, lifecycle rejection.
- `src/main/libs/codexAppServerManager.ts`: pinned/dev executable resolution, child lifecycle, config projection.
- `src/main/libs/codexNativeConfig.ts`: application-owned Codex configuration rendering without credentials.
- `src/main/libs/agentEngine/codexRuntimeAdapter.ts`: app-server thread/turn/item to Cowork event mapping.
- `src/main/projects/projectStore.ts`: project CRUD, root authorization metadata, and project memory persistence.
- `src/main/coworkStore.ts` and `src/main/sqliteStore.ts`: conversation-to-project/thread schema and destructive legacy migration.
- `src/main/ipcHandlers/projects/handlers.ts`: project IPC boundary.
- `src/renderer/components/projectSidebar/`: project/conversation navigation components and pure view helpers.
- `src/renderer/services/projects.ts`, `src/renderer/store/slices/projectSlice.ts`: renderer project state and IPC calls.
- `scripts/codex-runtime-*.cjs`: fetch/verify/package the pinned Codex runtime.
- `scripts/electron-builder-config.cjs` and `electron-builder.json`: package Codex, never `cfmind`.

### Task 1: Harden the app-server client and fixed-runtime manager

**Files:**
- Modify: `src/main/libs/codexAppServerProtocol.ts`
- Modify: `src/main/libs/codexAppServerClient.ts`
- Modify: `src/main/libs/codexAppServerManager.ts`
- Modify: `src/main/libs/codexNativeConfig.ts`
- Test: `src/main/libs/codexAppServerClient.test.ts`
- Test: `src/main/libs/codexAppServerManager.test.ts`
- Test: `src/main/libs/codexNativeConfig.test.ts`

**Interfaces:**
- Produces `CodexAppServerClient.initialize(): Promise<void>`, `request<T>()`, `notify()`, and typed notification/server-request events.
- Produces `CodexAppServerManager.start(): Promise<CodexAppServerClient>`, `stop(): void`, and `resolveCodexCommand(): CodexCommand`.

- [ ] **Step 1: Write failing client tests**

```ts
test('rejects only pending requests when a malformed JSONL line arrives', async () => {
  const transport = createFakeTransport();
  const client = new CodexAppServerClient(transport);
  const pending = client.request('thread/start', {});
  transport.pushOutput('{not-json}\n');
  await expect(pending).rejects.toThrow('Invalid Codex app-server JSONL');
});

test('sends initialized only after initialize succeeds', async () => {
  const transport = createFakeTransport();
  const client = new CodexAppServerClient(transport);
  const initialized = client.initialize();
  transport.pushOutput('{"id":1,"result":{}}\n');
  await initialized;
  expect(transport.writes).toContainEqual({ method: 'initialized' });
});
```

- [ ] **Step 2: Run the focused client test and verify the expected failure**

Run: `npm.cmd test -- codexAppServerClient`

Expected: FAIL because `initialize()` and malformed-line handling do not exist.

- [ ] **Step 3: Implement the minimal client protocol behavior**

```ts
async initialize(): Promise<void> {
  await this.request('initialize', {
    clientInfo: { name: 'lobsterai', version: app.getVersion() },
    capabilities: { experimentalApi: true },
  });
  this.notify('initialized');
}

private failPending(error: Error): void {
  for (const request of this.pending.values()) request.reject(error);
  this.pending.clear();
}
```

Catch `JSON.parse` failures inside `handleData`, call `failPending`, emit a
typed protocol error, and close the transport. Keep generated protocol values
in a versioned source snapshot rather than spreading `Record<string, unknown>`
through the adapter.

- [ ] **Step 4: Write failing manager/config tests**

```ts
test('uses the development Codex command only outside packaged mode', async () => {
  expect(resolveCodexCommand({ isPackaged: false, platform: 'win32' }))
    .toEqual({ command: 'codex.cmd', args: ['app-server', '--stdio'] });
  expect(resolveCodexCommand({ isPackaged: true, resourcesPath: 'C:/app/resources' }))
    .toEqual(expect.objectContaining({ command: expect.stringContaining('codex.exe') }));
});

test('renders no credential values in managed Codex config', () => {
  const config = buildCodexHomeConfig({ webSearch: 'cached' });
  expect(config).toContain('web_search = "cached"');
  expect(config).not.toContain('OPENAI_API_KEY');
});
```

- [ ] **Step 5: Run the focused manager/config tests and verify failure**

Run: `npm.cmd test -- codexAppServerManager codexNativeConfig`

Expected: FAIL because packaging resolution and web-search configuration are absent.

- [ ] **Step 6: Implement manager and configuration projection**

```ts
export function resolveCodexCommand(input: CodexCommandInput): CodexCommand {
  if (!input.isPackaged) return { command: 'codex.cmd', args: ['app-server', '--stdio'] };
  return {
    command: path.join(input.resourcesPath, 'codex-runtime', 'codex.exe'),
    args: ['app-server', '--stdio'],
  };
}
```

Render only managed values such as `web_search`, allowed MCP server entries,
and pinned model defaults. Preserve no OpenClaw/DeepSeek projection and pass no
API-key environment variable; Codex uses its isolated authentication file.

- [ ] **Step 7: Verify Task 1**

Run: `npm.cmd test -- codexAppServerClient codexAppServerManager codexNativeConfig`

Expected: PASS.

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/libs/codexAppServerProtocol.ts src/main/libs/codexAppServerClient.ts src/main/libs/codexAppServerManager.ts src/main/libs/codexNativeConfig.ts`

Expected: zero errors and warnings.

### Task 2: Make Codex the only Cowork runtime

**Files:**
- Modify: `src/main/libs/agentEngine/types.ts`
- Modify: `src/main/libs/agentEngine/coworkEngineRouter.ts`
- Modify: `src/main/libs/agentEngine/codexRuntimeAdapter.ts`
- Modify: `src/main/main.ts`
- Delete: `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- Test: `src/main/libs/agentEngine/codexRuntimeAdapter.test.ts`
- Test: `src/main/libs/agentEngine/coworkEngineRouter.test.ts`

**Interfaces:**
- `CoworkAgentEngine` is the single literal `'codex'`.
- `CodexRuntimeAdapter` owns `startSession`, `continueSession`, `stopSession`, `respondToPermission`, and process-close cleanup.

- [ ] **Step 1: Write failing runtime tests**

```ts
test('does not route a new session to an OpenClaw fallback', async () => {
  const router = new CoworkEngineRouter({ codexRuntime: runtime });
  await router.startSession('session-1', 'hello');
  expect(runtime.startSession).toHaveBeenCalledWith('session-1', 'hello', {});
});

test('resolves a visible permission when the Codex transport closes', () => {
  adapter.emitPermissionForTest('session-1', 'codex:9');
  client.emit('close');
  expect(events.permissionResolved).toContainEqual(['session-1', 'codex:9']);
  expect(events.error).toContainEqual(['session-1', 'Codex app-server disconnected']);
});
```

- [ ] **Step 2: Run focused runtime tests and verify failure**

Run: `npm.cmd test -- codexRuntimeAdapter coworkEngineRouter`

Expected: FAIL because the router currently requires an OpenClaw runtime and
the adapter does not resolve pending approvals on close.

- [ ] **Step 3: Implement the single-runtime router and close cleanup**

```ts
export type CoworkAgentEngine = 'codex';

type RouterDeps = { codexRuntime: CoworkRuntime };

private handleClientClose(): void {
  for (const [permissionId, sessionId] of this.sessionByPermissionId) {
    this.emit('permissionResolved', sessionId, permissionId);
  }
  this.requestByPermissionId.clear();
  this.sessionByPermissionId.clear();
  // finalize active message state and emit one scoped error per session
}
```

Call the manager client `initialize()` method instead of duplicating the
handshake in the adapter. Remove engine-switching, OpenClaw native-question,
and fallback behavior from main-process construction and renderer config.

- [ ] **Step 4: Verify Task 2**

Run: `npm.cmd test -- codexRuntimeAdapter coworkEngineRouter`

Expected: PASS.

Run: `npm.cmd run compile:electron`

Expected: PASS.

### Task 3: Introduce projects and perform destructive legacy migration

**Files:**
- Create: `src/main/projects/projectStore.ts`
- Create: `src/main/projects/projectStore.test.ts`
- Modify: `src/main/sqliteStore.ts`
- Modify: `src/main/coworkStore.ts`
- Modify: `src/main/coworkStore.test.ts`
- Delete: `src/main/agentManager.ts`
- Delete: `src/main/openclawSessionPolicy/`

**Interfaces:**
- `ProjectStore.createProject(input): Project`, `listProjects(): Project[]`, `updateMemory(projectId, content): void`.
- `CoworkSession` carries `projectId: string | null` and `codexThreadId: string | null`.

- [ ] **Step 1: Write failing migration/store tests**

```ts
test('replaces legacy session and agent data with an empty Codex project schema', () => {
  const db = createLegacyDatabaseWithOpenClawRows();
  migrateLobsterAiDatabase(db, { userDataPath: fixturePath });
  expect(db.prepare('SELECT COUNT(*) AS count FROM cowork_sessions').get()).toEqual({ count: 0 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 });
  expect(db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('agents')).toBeUndefined();
});

test('keeps temporary conversations isolated from project memory', () => {
  const project = store.createProject({ name: 'Accounts', rootPath: 'E:/accounts' });
  store.updateMemory(project.id, 'Use the approved template.');
  expect(store.getMemoryForConversation(null)).toBe('');
});
```

- [ ] **Step 2: Run migration/store tests and verify failure**

Run: `npm.cmd test -- projectStore coworkStore`

Expected: FAIL because `projects`, destructive migration, and scoped memory do
not exist.

- [ ] **Step 3: Implement idempotent backup, cleanup, and project tables**

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  memory TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
ALTER TABLE cowork_sessions ADD COLUMN project_id TEXT;
ALTER TABLE cowork_sessions ADD COLUMN codex_thread_id TEXT;
```

Create the recoverable backup before deleting legacy rows and obsolete tables.
Use a migration marker in `kv` so a restart resumes cleanup safely. Delete
`openclaw` user-data state only after the database migration commits.

- [ ] **Step 4: Verify Task 3**

Run: `npm.cmd test -- projectStore coworkStore`

Expected: PASS.

Run: `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/projects/projectStore.ts src/main/sqliteStore.ts src/main/coworkStore.ts`

Expected: zero errors and warnings.

### Task 4: Expose project-backed conversations through IPC and renderer state

**Files:**
- Create: `src/main/ipcHandlers/projects/handlers.ts`
- Create: `src/renderer/services/projects.ts`
- Create: `src/renderer/store/slices/projectSlice.ts`
- Create: `src/renderer/components/projectSidebar/ProjectConversationSidebar.tsx`
- Create: `src/renderer/components/projectSidebar/projectConversationTree.ts`
- Test: `src/renderer/components/projectSidebar/projectConversationTree.test.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/App.tsx`
- Delete: `src/renderer/components/agentSidebar/`

**Interfaces:**
- Preload exposes `window.electron.projects.list/create/updateMemory/selectRoot`.
- `buildProjectConversationTree(projects, sessions)` returns project groups and a temporary group without inheriting roots.

- [ ] **Step 1: Write failing project tree tests**

```ts
test('groups a conversation under its project and leaves null project IDs temporary', () => {
  expect(buildProjectConversationTree(
    [{ id: 'p1', name: 'Finance', rootPath: 'E:/finance' }],
    [{ id: 's1', projectId: 'p1' }, { id: 's2', projectId: null }],
  )).toMatchObject({ projects: [{ projectId: 'p1', sessionIds: ['s1'] }], temporarySessionIds: ['s2'] });
});
```

- [ ] **Step 2: Run project tree tests and verify failure**

Run: `npm.cmd test -- projectConversationTree`

Expected: FAIL because the project sidebar helper does not exist.

- [ ] **Step 3: Implement IPC, state, and sidebar replacement**

```ts
export const ProjectIpcChannel = {
  List: 'projects:list',
  Create: 'projects:create',
  UpdateMemory: 'projects:update-memory',
  SelectRoot: 'projects:select-root',
} as const;
```

Authorize a selected project root with the existing path boundary before
persisting it. Replace every "My Agents" label, route, and action with project
and conversation interactions. New conversations explicitly carry a selected
`projectId` or `null`; no implicit previous root is allowed.

- [ ] **Step 4: Verify Task 4**

Run: `npm.cmd test -- projectConversationTree`

Expected: PASS.

Run: `npm.cmd run compile:electron`

Expected: PASS.

### Task 5: Connect approved office capabilities to Codex

**Files:**
- Modify: `src/main/libs/agentEngine/codexRuntimeAdapter.ts`
- Modify: `src/main/mcp/mcpRuntime.ts`
- Modify: `src/main/skillManager.ts`
- Modify: `src/main/computerUse/computerUseKit.ts`
- Modify: `src/main/main.ts`
- Test: `src/main/libs/agentEngine/codexRuntimeAdapter.test.ts`
- Test: `src/main/mcp/codexMcpAdapter.test.ts`
- Test: `src/main/skillManager.test.ts`

**Interfaces:**
- `buildCodexTurnContext({ project, memory, skillIds, webSearchMode }): CodexTurnContext`.
- `reloadCodexMcpServers(servers): Promise<void>` writes only enabled scanned MCP servers.

- [ ] **Step 1: Write failing integration tests**

```ts
test('passes only the selected project memory and enabled skills to a Codex turn', async () => {
  await adapter.startSession('s1', 'draft a report', projectOptions);
  expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
    input: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
  }));
  expect(client.request).not.toHaveBeenCalledWith('turn/start', expect.stringContaining('other-project-memory'));
});

test('registers Computer Use as a local Codex MCP server requiring approval', async () => {
  await reloadCodexMcpServers([computerUseServer]);
  expect(renderedConfig).toContain('[mcp_servers.computer-use]');
  expect(permission.toolName).toBe('mcpServer/elicitation/request');
});
```

- [ ] **Step 2: Run focused capability tests and verify failure**

Run: `npm.cmd test -- codexRuntimeAdapter codexMcpAdapter skillManager`

Expected: FAIL because turn context and Codex MCP projection are incomplete.

- [ ] **Step 3: Implement capability adapters**

```ts
export function buildCodexTurnContext(input: CodexTurnContextInput): string {
  return [
    input.memory.trim() ? `Project memory:\n${input.memory.trim()}` : '',
    ...input.skillPaths.map(skillPath => `Skill file: ${skillPath}`),
  ].filter(Boolean).join('\n\n');
}
```

Validate every skill path and MCP executable through the existing allowed-path
and security-scan boundary. Map app-server server requests to the standard
permission UI and map completed web-search and MCP items to existing tool
display components.

- [ ] **Step 4: Verify Task 5**

Run: `npm.cmd test -- codexRuntimeAdapter codexMcpAdapter skillManager`

Expected: PASS.

Run: `npm.cmd run compile:electron`

Expected: PASS.

### Task 6: Restrict remote capability to explicit Codex web search

**Files:**
- Modify: `src/main/libs/codexNativeConfig.ts`
- Modify: `src/main/libs/agentEngine/codexRuntimeAdapter.ts`
- Modify: `src/renderer/components/cowork/ToolCallGroup.tsx`
- Modify: `src/renderer/services/i18n.ts`
- Test: `src/main/libs/codexNativeConfig.test.ts`
- Test: `src/main/libs/agentEngine/codexRuntimeAdapter.test.ts`

**Interfaces:**
- `CodexWebSearchMode = 'cached' | 'live'`.
- `renderCodexWebSearchConfig(mode)` only renders `web_search` and no remote endpoint or local network policy.

- [ ] **Step 1: Write failing web-search tests**

```ts
test('renders cached search without a remote endpoint or command network policy', () => {
  const config = renderCodexWebSearchConfig('cached');
  expect(config).toContain('web_search = "cached"');
  expect(config).not.toMatch(/--remote|code-mode-host|network_access/);
});

test('renders a completed web search as a read-only tool item', () => {
  const message = mapCodexItem({ type: 'webSearch', query: 'latest policy', result: [] });
  expect(message.metadata).toMatchObject({ toolName: 'WebSearch', readOnly: true });
});
```

- [ ] **Step 2: Run web-search tests and verify failure**

Run: `npm.cmd test -- codexNativeConfig codexRuntimeAdapter`

Expected: FAIL because search modes and read-only tool metadata are absent.

- [ ] **Step 3: Implement configuration and rendering**

```ts
export const CodexWebSearchMode = { Cached: 'cached', Live: 'live' } as const;
export type CodexWebSearchMode = typeof CodexWebSearchMode[keyof typeof CodexWebSearchMode];

export function renderCodexWebSearchConfig(mode: CodexWebSearchMode): string {
  return `web_search = "${mode}"\n`;
}
```

Offer live search only as an explicit turn option. Do not add any UI or IPC for
WebSocket listeners, remote connection URLs, tunnel tokens, or remote hosts.

- [ ] **Step 4: Verify Task 6**

Run: `npm.cmd test -- codexNativeConfig codexRuntimeAdapter`

Expected: PASS.

### Task 7: Remove excluded product surfaces and legacy runtime code

**Files:**
- Delete: `src/scheduledTask/`
- Delete: `src/main/im/`
- Delete: `src/main/ipcHandlers/scheduledTask/`
- Delete: `src/renderer/components/scheduledTasks/`
- Delete: `src/renderer/services/scheduledTask.ts`
- Delete: `src/renderer/store/slices/scheduledTaskSlice.ts`
- Delete: `src/renderer/components/cowork/voiceInput/`
- Delete: `src/renderer/services/voiceInput/`
- Delete: `src/main/libs/openclaw*.ts`
- Delete: `src/main/libs/openclawPatches/`
- Delete: `src/shared/openclawEngine/`
- Delete: `src/shared/cowork/openclaw*.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/services/i18n.ts`

**Interfaces:**
- No exported runtime, IPC channel, route, translation, or renderer control has an OpenClaw, scheduled-task, voice, IM, or Worktree identifier.

- [ ] **Step 1: Write removal contract tests**

```ts
test('does not expose legacy product APIs through preload', () => {
  expect(Object.keys(buildElectronApiForTest())).not.toEqual(expect.arrayContaining([
    'scheduledTask', 'voiceInput', 'im', 'openclawRepair',
  ]));
});

test('does not render excluded navigation items', () => {
  render(<Sidebar {...sidebarProps} />);
  expect(screen.queryByText(/scheduled|voice|my agents/i)).toBeNull();
});
```

- [ ] **Step 2: Run removal contract tests and verify failure**

Run: `npm.cmd test -- Sidebar`

Expected: FAIL because legacy APIs and navigation remain.

- [ ] **Step 3: Remove code and references in dependency order**

Remove imports and IPC registrations from `main.ts` and `preload.ts` before
deleting a leaf subsystem. Delete related tests in the same change. Replace
renderer navigation with the project sidebar from Task 4 and remove every
associated i18n key once no TypeScript reference remains.

- [ ] **Step 4: Verify removal contracts**

Run: `npm.cmd test -- Sidebar`

Expected: PASS.

Run: `Get-ChildItem src -Recurse -File -Include *.ts,*.tsx | Select-String -Pattern 'OpenClaw|openclaw|scheduledTask|voiceInput|worktree'`

Expected: no matches except migration-deletion assertions.

### Task 8: Replace OpenClaw packaging with pinned Codex packaging

**Files:**
- Create: `scripts/codex-runtime-host.cjs`
- Create: `scripts/build-codex-runtime.cjs`
- Create: `scripts/verify-codex-runtime.cjs`
- Modify: `package.json`
- Modify: `electron-builder.json`
- Modify: `scripts/electron-builder-config.cjs`
- Delete: `scripts/ensure-openclaw-version.cjs`
- Delete: `scripts/apply-openclaw-patches.cjs`
- Delete: `scripts/run-build-openclaw-runtime.cjs`
- Delete: `scripts/sync-openclaw-runtime-current.cjs`
- Delete: `scripts/bundle-openclaw-gateway.cjs`
- Delete: `scripts/ensure-openclaw-plugins.cjs`
- Delete: `scripts/precompile-openclaw-extensions.cjs`
- Delete: `scripts/prune-openclaw-runtime.cjs`
- Test: `tests/codex-runtime-packaging.test.mjs`

**Interfaces:**
- `npm run codex:runtime:host` creates `vendor/codex-runtime/current` for the current platform.
- `npm run verify:codex-runtime` validates executable version and no `cfmind` resource.

- [ ] **Step 1: Write failing package-layout tests**

```js
test('packages Codex runtime and excludes cfmind', () => {
  const config = loadBuilderConfig();
  expect(JSON.stringify(config)).toContain('codex-runtime');
  expect(JSON.stringify(config)).not.toContain('cfmind');
  expect(packageScripts['codex:runtime:host']).toBeDefined();
  expect(Object.keys(packageScripts).some(key => key.startsWith('openclaw:'))).toBe(false);
});
```

- [ ] **Step 2: Run the package-layout test and verify failure**

Run: `node --test tests/codex-runtime-packaging.test.mjs`

Expected: FAIL because OpenClaw packaging scripts and `cfmind` are still configured.

- [ ] **Step 3: Implement runtime fetch, verification, and builder resources**

The fetch script must verify an explicit version and SHA-256 before placing the
binary under `vendor/codex-runtime/<platform>-<arch>/`. The packager copies
that directory to `Resources/codex-runtime`; it never copies `cfmind` or an
OpenClaw runtime. Update `dist:*` scripts to build and verify Codex before
Electron packaging.

- [ ] **Step 4: Verify Task 8**

Run: `node --test tests/codex-runtime-packaging.test.mjs`

Expected: PASS.

Run: `npm.cmd run verify:codex-runtime`

Expected: PASS with the pinned Codex version.

### Task 9: Run complete verification and manual desktop acceptance

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`
- Delete: OpenClaw-specific documentation under `docs/` once source references are removed.

- [ ] **Step 1: Update user documentation**

Document the Codex-only runtime, independent LobsterAI and Codex sign-in,
project/conversation workflow, local Computer Use approval, cached/live web
search, and the absence of IM, recurring tasks, voice, and Worktrees.

- [ ] **Step 2: Run targeted and full automated verification**

Run: `npm.cmd test -- codexAppServerClient codexAppServerManager codexRuntimeAdapter projectStore projectConversationTree`

Expected: PASS.

Run: `npm.cmd test`

Expected: PASS; report each pre-existing failure separately if the whole suite
is not green.

Run: `npm.cmd run compile:electron`

Expected: PASS.

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 3: Run changed-file lint and source/package audits**

Run: `$changedTypeScript = git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx'; if ($changedTypeScript.Count -gt 0) { npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 $changedTypeScript }`

Expected: zero errors and warnings.

Run: `Get-ChildItem src,scripts -Recurse -File | Select-String -Pattern 'OpenClaw|openclaw|cfmind'`

Expected: no runtime or packaging matches; only intentionally retained
migration-deletion test wording may match.

- [ ] **Step 4: Manually validate Electron behavior**

Run: `npm.cmd run electron:dev`

Expected: the app starts using Windows `codex` and independent
`%APPDATA%/LobsterAI/codex` configuration. Validate sign-in separation, new
project selection, temporary conversation isolation, streamed response, file
approval, cached and live search, local Computer Use approval, skills, MCP,
project memory, and post-migration removal of old data.
