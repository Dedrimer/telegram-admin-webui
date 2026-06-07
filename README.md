# Telegram Downloader Admin WebUI

这是一个可选后台管理组件，作为独立容器运行，通过 `telegram-downloader` 暴露的只读 Admin API 获取状态。

## 启动

在 `D:\02` 根目录使用测试机 compose：

```powershell
docker compose up -d --build
```

或者在 `telegram-downloader` 仓库目录叠加可选 WebUI compose：

```powershell
docker compose -f docker-compose.local.yml -f docker-compose.webui.yml up -d --build
```

默认访问地址：

```text
http://localhost:8090
```

## 环境变量

- `ADMIN_WEBUI_PORT`: WebUI 暴露端口，默认 `8090`
- `ADMIN_UI_REFRESH_INTERVAL_MS`: 页面刷新间隔，默认 `3000`
- `ADMIN_API_TOKEN`: 可选访问令牌；设置后 WebUI 会通过 `X-Admin-Token` 请求后端 API

## API

`telegram-downloader` 侧新增接口：

- `GET /health`
- `GET /api/overview`
- `GET /api/downloads`
- `GET /api/system`
- `GET /api/bot`

这些接口只读取下载状态、队列、进程资源、磁盘占用、Bot API 连通性和 bot 基本信息，不执行下载控制操作。
