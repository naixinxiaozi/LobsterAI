# Codex Office Workbench Design

## Status

Approved design pending implementation planning.

## Goal

Replace the OpenClaw runtime completely with a fixed-version Codex app-server
runtime and focus LobsterAI on an office workbench. The product supports local
projects and project conversations, files, manual multi-step automation,
computer use, web search, plugins, skills, MCP servers, and project memory.

The product does not support voice input, scheduled tasks, Worktrees, IM
channels, remote host control, or remote app-server connections.

## Product Boundaries

### LobsterAI account vs. Codex account

LobsterAI retains only its self-hosted account login, credits or quotas, and
the model catalog available to the LobsterAI product. These values are not
Codex authentication, provider configuration, or a source of Codex model
credentials.

Codex authentication is independent. LobsterAI owns an application-scoped
`CODEX_HOME` at `%APPDATA%/LobsterAI/codex`; it neither reads nor changes the
user's global `%USERPROFILE%/.codex`. The app-scoped `auth.json` is available
only to the bundled Codex process. Secrets and tokens must not appear in logs,
diagnostics, source control, generated fixtures, or exports.

### Runtime and packaging

The main process launches `codex app-server --stdio` and communicates over
JSONL JSON-RPC. Development initially resolves the installed Windows `codex`
command. Distribution packages a pinned Codex version and invokes that binary
instead. The app-server client sends `initialize`, then `initialized`, before
starting or resuming a thread.

The app-server is the only agent runtime. No OpenClaw gateway, fallback,
compatibility adapter, configuration synchronizer, background process, patch,
runtime builder, or packaged resource remains.

## Architecture

```text
React renderer
  -> Electron preload and IPC
  -> project/session store + Codex runtime adapter
  -> Codex app-server JSONL client
  -> bundled Codex process using %APPDATA%/LobsterAI/codex
```

The renderer stays isolated from Node.js. The main process owns child-process
lifecycle, JSONL framing, request IDs, protocol error handling, file-path
authorization, and tool approvals. Protocol types are generated from the
pinned app-server version and kept in a versioned source snapshot.

An unexpected app-server exit rejects every pending request and transitions
affected conversations to a visible stopped or failed state. A late tool
response cannot recreate a resolved or dismissed approval.

## Projects and Conversations

The agent-oriented data model and UI are replaced with projects and
conversations:

- A project represents an allowed local root path and its project-scoped
  metadata.
- Each conversation belongs to a project and stores its `codex_thread_id`.
- A temporary conversation has no project and cannot gain arbitrary file
  access without an explicit project selection.
- The sidebar is titled "Projects and conversations". Projects expand to show
  conversations; unassigned conversations appear under "Temporary
  conversations".
- New conversations select a project by defaulting to the most recently used
  project.

The previous "My Agents" navigation and agent CRUD are removed.

## Capabilities and Permissions

Files, command execution, patches, Computer Use, and MCP tools with side
effects use the existing Electron approval surface. Denial or cancellation is
sent to the matching Codex request and interrupts the relevant turn when
needed.

Web search is the only remote capability. It is shown as a read-only tool item
in the conversation. The default is cached search; a user can explicitly use
live search for current information. Web search does not grant local command
network access, remote desktop control, or a remote app-server endpoint.

The existing local Computer Use package is exposed as a Codex MCP server. It
remains local and requires explicit approval for desktop control.

LobsterAI remains the product owner of skill discovery, plugin installation,
MCP configuration, and security scanning. Skills are exposed through Codex's
skill mechanism; enabled MCP servers are rendered into Codex configuration and
reloaded through the app-server. OpenClaw plugin records are not converted:
they are deleted with the old runtime and users install compatible Codex
plugins again.

"Automation" means a user-started multi-step Codex workflow. Recurring,
scheduled, and unattended tasks are out of scope.

## Project Memory

Memory is scoped to a project and supplied only to conversations for that
project. Its data and files stay within LobsterAI-managed storage and are
provided through the Codex integration boundary; memory must not widen the
project's permitted filesystem paths.

## Migration and Deletion

The upgrade makes a recoverable database backup before migration. It then
deletes, rather than preserves for read-only use, all OpenClaw, agent, IM,
scheduled-task, and legacy plugin records. It removes the old OpenClaw state
directory and runtime resources. Successful migration uses the existing backup
retention policy to remove backups later.

New schema introduces projects, project-scoped memory, and Codex thread IDs.
The migration is idempotent and must remain safe if the application stops and
restarts during the upgrade.

## Removal Scope

Remove all OpenClaw runtime code and package content, including gateway and
configuration modules, runtime build and patch scripts, `cfmind`, IM channel
code, cron/scheduled-task code, voice-input code, Worktree UI and runtime
paths, their IPC contracts, translations, dependencies, and tests.

Do not remove generic file preview, artifact rendering, browser preview,
approval, self-hosted account, credit, model catalog, local Computer Use,
skills, MCP, or memory capabilities when they can be connected to Codex.

## Verification

Automated coverage must prove JSONL framing and correlation, initialize
ordering, process-exit cleanup, thread start/resume, project mapping, config
redaction, data deletion, permissions, skill and MCP reload behavior, project
sidebar grouping, and web-search tool rendering.

Before handoff, run targeted Vitest tests, the full `npm test` suite,
`npm run compile:electron`, `npm run build`, and changed-file ESLint with zero
warnings. Manually validate independent Codex login, project conversations,
file approvals, cached and live web search, local Computer Use, skills, MCP,
project memory, and successful cleanup of old OpenClaw data. Inspect the final
source tree and packaged resource manifest to verify it has no OpenClaw,
`cfmind`, voice, scheduled-task, or Worktree runtime entrypoints.
