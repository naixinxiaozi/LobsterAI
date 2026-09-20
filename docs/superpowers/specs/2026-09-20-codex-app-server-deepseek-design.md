# Codex app-server + DeepSeek 桌面 Cowork 设计

## 目标

在不迁移定时任务和 IM 的前提下，将 LobsterAI 桌面 Cowork 的 Agent 执行链增加并优先切换到本地 `codex app-server --stdio`，固定使用 DeepSeek Responses API；保留 OpenClaw 运行时用于未迁移的 IM、定时任务和现有兼容路径。

## 非目标

- 本阶段不迁移 `src/scheduledTask/`。
- 本阶段不迁移 `src/main/im/`、OpenClaw channel bindings 或 Gateway cron API。
- 不删除 OpenClaw runtime、插件、迁移和恢复代码。
- 不实现 app-server WebSocket 远程网关。
- 不把 DeepSeek API key 写入仓库、安装包、日志或明文共享配置。

## 现状约束

- 当前 `CoworkAgentEngine` 只有 `openclaw`，主进程的 runtime router 也只绑定 `OpenClawRuntimeAdapter`。
- Cowork SQLite、Electron IPC、React renderer 和权限 UI 应继续作为产品层边界。
- OpenClaw 仍被 scheduled task 和 IM 使用，因此 OpenClaw 的 Gateway 管理必须保留。
- Codex app-server 的协议是双向 JSON-RPC over JSONL；每条连接必须先执行 `initialize`/`initialized`。
- app-server 线程 ID 与 LobsterAI 本地会话 ID 不同，必须显式持久化映射。
- app-server 的 provider/model 配置属于 `CODEX_HOME` 用户配置边界；项目本地 `.codex/config.toml` 不能覆盖 provider 设置。

## 目标架构

```text
Renderer
  -> Electron IPC
  -> CoworkStore + CoworkEngineRouter
       -> OpenClawRuntimeAdapter -> OpenClaw Gateway
       -> CodexRuntimeAdapter    -> Codex app-server --stdio -> DeepSeek Responses API
```

### CodexAppServerManager

负责启动、停止、重启和健康状态；使用 LobsterAI 专用 `CODEX_HOME`，生成 DeepSeek provider 配置和模型目录，注入由 Electron `safeStorage` 解密得到的临时环境变量。不要复用或覆盖用户现有 Codex 配置。

### CodexAppServerClient

提供类型受限的 JSON-RPC 请求/响应/服务器请求分发：

- 初始化握手和 request id 管理。
- JSONL stdout 解析、stderr 诊断、进程退出和 pending request 拒绝。
- `thread/start`、`thread/resume`、`thread/read`、`thread/fork`。
- `turn/start`、`turn/steer`、`turn/interrupt`。
- `thread/compact/start`。
- command/file/MCP/tool/user-input server request 的统一回调。
- `skills/list`、MCP status/reload/call 相关能力。

协议类型应来源于固定版本生成快照或窄化的本地协议类型；不得手写大而全的 `Record<string, unknown>` 贯穿业务层。

### CodexRuntimeAdapter

将 app-server 的 thread/turn/item 事件转换成 `CoworkRuntimeEvents`：

- agent message delta -> `messageUpdate`。
- completed message/tool/file items -> Cowork 消息。
- command/file/MCP/user input requests -> `permissionRequest`。
- `turn/completed` -> `complete`。
- `turn/interrupt`、进程错误和恢复失败 -> `sessionStopped` 或 `error`。
- context compaction item 生命周期 -> `contextMaintenance`。

Adapter 不负责定时任务和 IM；这些仍由 OpenClaw 路径处理。

## Skills 适配

LobsterAI `SkillManager` 仍是技能安装、启用状态和安全扫描的唯一产品来源。Codex 适配层使用 app-server `skills/list` 获取当前 cwd 可见技能，并在 `turn/start` 输入中传递 `type: "skill"`、技能名称和绝对 `SKILL.md` 路径。已选技能不再主要依赖 OpenClaw `skills.load.extraDirs` 或 AGENTS.md 注入。

技能路径必须经过现有允许路径检查；skill 列表不可把用户目录外的任意路径直接交给 renderer 或 app-server。

## MCP 适配

LobsterAI MCP store、凭据、安全扫描和设置 UI 保留。启用的 MCP server 写入 Codex 专用配置层，然后通过 `config/mcpServer/reload` 刷新已加载线程。Adapter 订阅并映射：

- `mcpServerStatus/list` -> MCP 状态和工具列表。
- `mcpServer/tool/call` -> 工具调用展示、结果和错误。
- `mcpServer/elicitation/request` -> 结构化用户输入 UI。
- MCP 工具副作用审批 -> 现有 Cowork 权限 UI。

OpenClaw 原生 MCP 配置不直接作为 Codex 配置使用；两者分别生成，避免配置字段互相污染。

## 压缩与上下文用量

调用 `thread/compact/start` 触发 app-server 压缩。将 `contextCompaction` 的 `item/started`/`item/completed` 映射为现有上下文维护事件。使用 app-server 的 thread/turn/item 元数据计算或读取 Cowork context usage；移除对 OpenClaw Gateway history 和 OpenClaw session key 的依赖。

压缩失败必须保留原线程可恢复状态，并向 UI 返回可区分的失败原因；不能用本地删除消息来模拟压缩。

## 会话恢复

Cowork session 表增加或采用明确的 Codex thread ID 字段，避免继续把历史 `claude_session_id` 当作通用字段。启动流程：

1. 读取 Cowork session 的 `codexThreadId`。
2. 调用 `thread/resume`。
3. 恢复订阅并读取需要补齐的历史。
4. 将 app-server item 映射回本地消息，按稳定 ID 去重。
5. 只有在明确判定线程不存在或 provider 不匹配时才进入“需要新会话”错误；禁止静默创建新上下文。

会话使用 provider 配置分组，DeepSeek 线程不得误恢复到 OpenAI/ChatGPT provider 线程。

## DeepSeek 配置与安全

默认模型先使用 `deepseek-flash`，保留通过固定产品常量切换 `deepseek-v4-pro` 的能力；本阶段不开放任意 provider 编辑。

配置生成包含：

```toml
model_provider = "deepseek"
model = "deepseek-flash"
model_reasoning_effort = "high"
web_search = "disabled"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
env_key = "LOBSTERAI_DEEPSEEK_API_KEY"
```

模型目录必须声明 DeepSeek 模型的上下文窗口、reasoning effort、工具格式和输入模态；配置生成测试不得包含真实 key。

首版只宣称经过真实探针验证的工具能力。DeepSeek Responses API 对内置工具存在部分支持限制，因此 web search、computer use 等能力默认关闭，shell/file/patch、MCP 是否可用必须通过真实 app-server + DeepSeek 测试确认。

## 验收标准

- 无 API key 出现在日志、源码、测试快照、配置快照或诊断导出。
- app-server 进程异常退出时所有 pending RPC 和活动 Cowork session 都能结束或进入明确错误。
- 新会话能够使用 DeepSeek 完成文本回复并流式显示。
- shell/file approval 能够通过现有 UI allow/deny，并在 app-server 侧得到最终 item 状态。
- Skills 列表和选中技能能作用于新 turn。
- MCP reload、状态展示、工具调用和 elicitation 能完成最小闭环。
- context compact 的开始/结束/失败状态在 UI 中可见。
- 关闭并重新打开 LobsterAI 后，Codex thread 能通过映射恢复；provider 不匹配不会串会话。
- OpenClaw 的 scheduled task 和 IM 测试、现有运行时路径不被破坏。

## 参考实现

实现参考：`E:\project\mychatgpt\codex\codex-rs\app-server`，重点查看 `README.md`、`src/request_processors/`、`src/mcp_refresh.rs`、`src/skills_watcher.rs`、`src/thread_state.rs` 和 app-server V2 集成测试。参考源码只读，不作为 LobsterAI 的运行时依赖。
