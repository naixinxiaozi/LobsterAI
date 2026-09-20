# Codex app-server + DeepSeek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local Codex app-server runtime backed by DeepSeek and adapt Cowork Skills, MCP, compaction, approvals, and session resume without migrating scheduled tasks or IM.

**Architecture:** Keep CoworkStore, Electron IPC, renderer events, and the existing OpenClaw runtime. Add a typed JSONL JSON-RPC client, a Codex process manager, and a CodexRuntimeAdapter behind the existing CoworkEngineRouter. Generate a LobsterAI-owned Codex configuration using an encrypted DeepSeek key exposed only through the child process environment.

**Tech Stack:** Electron main process, TypeScript, Node child process, JSONL JSON-RPC, SQLite/better-sqlite3, React renderer, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-codex-app-server-deepseek-design.md`

## Global Constraints

- Do not migrate scheduled tasks or IM in this plan.
- Do not delete or rewrite OpenClaw runtime code.
- Use local `codex app-server --stdio`; do not add remote WebSocket support.
- Keep DeepSeek API keys out of source, logs, test fixtures, snapshots, and diagnostics.
- Use `npm.cmd` on Windows when PowerShell blocks `npm`.
- Every touched TypeScript file must pass the repository CI ESLint command.
- Follow TDD: each production behavior starts with a failing Vitest test.

## Review Focus

- JSONL framing, out-of-order responses, server requests, and process exit must not hang or reject the wrong Cowork session; cover in Task 1.
- DeepSeek provider configuration must preserve unrelated config and never serialize the key; cover in Task 2.
- A provider-mismatched or missing Codex thread must not silently create a new conversation; cover in Task 3.
- Approval cancellation and late app-server responses must not resurrect a renderer prompt; cover in Task 4.
- MCP reload/elicitation and skill paths must stay within LobsterAI-managed roots; cover in Tasks 5 and 6.

### Task 1: Typed app-server JSONL client

**Files:**
- Create: `src/main/libs/codexAppServerProtocol.ts`
- Create: `src/main/libs/codexAppServerClient.ts`
- Test: `src/main/libs/codexAppServerClient.test.ts`

**Interfaces:**
- Produces `CodexAppServerClient`, `CodexServerRequest`, `CodexNotification`, and typed methods for initialization, thread/turn lifecycle, compaction, skills, MCP, and approval responses.

- [ ] Write failing tests for JSONL framing, response correlation, notifications, server requests, malformed lines, and process exit rejection.
- [ ] Run `npm.cmd test -- codexAppServerClient` and observe the expected missing-module failures.
- [ ] Implement the narrow protocol types and injected transport/process interface.
- [ ] Run the focused test and verify all cases pass.
- [ ] Run changed-file ESLint with `--max-warnings 0`.

### Task 2: DeepSeek config and app-server process manager

**Files:**
- Create: `src/main/libs/codexAppServerManager.ts`
- Create: `src/main/libs/codexAppServerConfig.ts`
- Test: `src/main/libs/codexAppServerConfig.test.ts`
- Test: `src/main/libs/codexAppServerManager.test.ts`
- Modify: `src/main/libs/coworkUtil.ts` or the existing runtime resolver only if needed for packaged Codex resolution.

**Interfaces:**
- Produces `buildDeepSeekCodexConfig`, `resolveCodexHome`, and manager lifecycle methods `start`, `stop`, `restart`, `getStatus`, `getClient`.

- [ ] Write failing config tests for DeepSeek provider fields, preserved non-managed config, redacted diagnostics, and absent plaintext key.
- [ ] Run the focused tests and verify they fail for missing exports.
- [ ] Implement config generation using `env_key = LOBSTERAI_DEEPSEEK_API_KEY` and a fixed `deepseek-flash` model catalog entry.
- [ ] Write failing manager tests for start, duplicate start, stop, restart, and child exit propagation.
- [ ] Implement process resolution for development and packaged layouts without assuming the global Codex command exists in the installer.
- [ ] Run focused tests and changed-file ESLint.

### Task 3: Cowork engine types, router, and session mapping

**Files:**
- Modify: `src/main/libs/agentEngine/types.ts`
- Modify: `src/main/libs/agentEngine/coworkEngineRouter.ts`
- Modify: `src/main/coworkStore.ts`
- Modify: `src/main/sqliteStore.ts` only for an idempotent Codex thread mapping migration.
- Modify: `src/renderer/types/cowork.ts` and related config types.
- Tests: focused router/store/migration tests colocated with each source file.

**Interfaces:**
- Adds `codex-app-server` to the engine discriminant and a `codexThreadId` session field while preserving OpenClaw sessions.

- [ ] Write failing tests for selecting Codex runtime, persisting the thread ID, and refusing provider-mismatched resume.
- [ ] Run focused tests and verify failure before implementation.
- [ ] Add the engine discriminant and idempotent migration; keep historical fields readable.
- [ ] Update the router to bind both runtimes and route session/request ownership by engine.
- [ ] Run focused tests, `npm.cmd run compile:electron`, and changed-file ESLint.

### Task 4: CodexRuntimeAdapter core streaming and approvals

**Files:**
- Create: `src/main/libs/agentEngine/codexRuntimeAdapter.ts`
- Create: `src/main/libs/agentEngine/codexEventMapping.ts`
- Test: `src/main/libs/agentEngine/codexRuntimeAdapter.test.ts`
- Modify: `src/main/main.ts` runtime construction and event forwarding.
- Modify: `src/main/preload.ts` or renderer types only where the existing Cowork events lack a required field.

**Interfaces:**
- Implements `CoworkRuntime` for `startSession`, `continueSession`, `stopSession`, `respondToPermission`, `isSessionActive`, context usage, and compaction.

- [ ] Write failing tests for initialize/start/turn event mapping, delta aggregation, complete/error/interrupt, command approval, file approval, and late response cleanup.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement core lifecycle and item mapping using the client from Task 1.
- [ ] Wire the adapter into main-process construction and preserve OpenClaw for existing paths.
- [ ] Run focused tests, compile, and changed-file ESLint.

### Task 5: Skills adaptation

**Files:**
- Create: `src/main/libs/agentEngine/codexSkillsAdapter.ts`
- Modify: `src/main/skills/skillManager.ts` only for a read-only managed-root/skill path API if required.
- Modify: `src/main/libs/agentEngine/codexRuntimeAdapter.ts`
- Tests: `src/main/libs/agentEngine/codexSkillsAdapter.test.ts` and relevant skill manager tests.

**Interfaces:**
- Produces `listCodexSkills(cwds)` and `buildSkillTurnInputs(selectedSkillIds, cwd)`.

- [ ] Write failing tests for enabled/disabled skills, selected skill input shape, absolute path enforcement, and missing skill behavior.
- [ ] Run focused tests and verify red.
- [ ] Implement app-server `skills/list` integration and `type: "skill"` turn inputs.
- [ ] Run focused tests, compile, and changed-file ESLint.

### Task 6: MCP adaptation

**Files:**
- Create: `src/main/mcp/codexMcpConfig.ts`
- Create: `src/main/mcp/codexMcpAdapter.ts`
- Test: `src/main/mcp/codexMcpAdapter.test.ts`
- Modify: `src/main/mcp/mcpRuntime.ts` only at the adapter boundary.
- Modify: `src/main/main.ts` MCP reload/status wiring.

**Interfaces:**
- Produces `writeCodexMcpConfig`, `reloadCodexMcp`, `listCodexMcpStatus`, and mapping callbacks for tool calls and elicitation.

- [ ] Write failing tests for config projection, secret redaction, reload, status normalization, tool call result/error, and elicitation cancellation.
- [ ] Run focused tests and verify red.
- [ ] Implement a Codex-specific config projection from the existing MCP store.
- [ ] Map app-server MCP requests and notifications into existing Cowork permission/user-input flows.
- [ ] Run focused tests, compile, and changed-file ESLint.

### Task 7: Compaction and session recovery

**Files:**
- Modify: `src/main/libs/agentEngine/codexRuntimeAdapter.ts`
- Create: `src/main/libs/agentEngine/codexSessionRecovery.ts`
- Tests: `src/main/libs/agentEngine/codexSessionRecovery.test.ts` and adapter tests.
- Modify: `src/main/coworkStore.ts` only for recovery metadata and message reconciliation.

**Interfaces:**
- Produces `resumeCodexThread`, `reconcileCodexItems`, and `compactCodexThread`.

- [ ] Write failing tests for resume success, not-found, provider mismatch, duplicate item replay, compaction lifecycle, and compaction failure.
- [ ] Run focused tests and verify red.
- [ ] Implement resume-first startup, stable item/message deduplication, and explicit recovery errors.
- [ ] Implement `thread/compact/start` mapping to context maintenance and usage refresh.
- [ ] Run focused tests, compile, and changed-file ESLint.

### Task 8: Renderer settings/capability presentation and integration verification

**Files:**
- Modify: `src/renderer/components/Settings.tsx` and i18n entries for the Codex/DeepSeek engine.
- Modify: `src/renderer/store/slices/coworkSlice.ts` and `src/renderer/services/cowork.ts` only where needed for engine state.
- Tests: relevant renderer/service tests.
- Add or update: a narrow app-server integration probe under `tests/` that requires an explicitly configured local Codex binary and never embeds credentials.

- [ ] Write failing tests for engine selection, unavailable capability display, and recovery error presentation.
- [ ] Run focused tests and verify red.
- [ ] Implement the minimal renderer changes; do not expose scheduled task or IM migration controls.
- [ ] Run focused tests, `npm.cmd run build`, `npm.cmd run compile:electron`, and changed-file ESLint.
- [ ] Run `npm.cmd test` and record unrelated failures separately.
- [ ] Manually validate the real DeepSeek app-server chain if a non-secret API key is configured: text, shell approval, file approval, skill, MCP, compact, close/reopen resume.

## Final verification

- Review the diff for OpenClaw scheduled-task/IM churn, generated files, secrets, and unrelated formatting.
- Run `npm.cmd test`.
- Run `npm.cmd run build` and `npm.cmd run compile:electron`.
- Run changed-file ESLint with `--max-warnings 0`.
- Report separately what was verified with mocks/unit tests versus the real DeepSeek network and packaged runtime.
