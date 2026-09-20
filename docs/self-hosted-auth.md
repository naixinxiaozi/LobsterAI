# 自部署认证与积分 Mock 服务

项目现在可以使用仓库内的轻量 Mock 服务，不需要连接 `youdao.com`。

## 启动服务

```text
npm run server:mock
```

默认监听：`http://127.0.0.1:8787`

也可以指定监听地址和端口：

```text
HOST=0.0.0.0 PORT=8787 npm run server:mock
```

Windows PowerShell：

```powershell
$env:HOST='0.0.0.0'
$env:PORT='8787'
npm run server:mock
```

## 启动桌面端

开发环境默认使用本机 Mock 服务。若服务部署在其他地址，启动 Electron 前设置：

```powershell
$env:LOBSTER_SERVER_BASE_URL='http://127.0.0.1:8787'
$env:VITE_LOBSTER_SERVER_BASE_URL='http://127.0.0.1:8787'
npm run electron:dev
```

打包版本需要在构建时设置 `VITE_LOBSTER_SERVER_BASE_URL`，主进程运行时使用 `LOBSTER_SERVER_BASE_URL`。

## Mock 行为

- 登录用户固定为 `Mock User`。
- 初始额度为 1000，已使用 120，剩余 880。
- 提供 DeepSeek `deepseek-flash` 云端模型。
- 模型返回固定文本：`这是自部署 Mock 服务的回复。`
- token 和登录会话只保存在服务进程内，服务重启后失效。
- 服务不实现真实注册、密码、支付、充值或持久化积分。

该服务适合本地开发、联调和演示。生产部署前仍需要接入真实身份系统、HTTPS、持久化存储、密钥轮换和安全的 token 存储。
