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

默认 HTTP 访问地址：

```text
http://localhost:8090
```

## HTTPS

默认镜像只启用 HTTP。测试环境可以用自动自签名证书开启 HTTPS：

```yaml
environment:
  ADMIN_WEBUI_ENABLE_HTTPS: "true"
  ADMIN_WEBUI_AUTO_SELF_SIGNED: "true"
ports:
  - "8443:443"
```

浏览器会提示证书不受信任，手动继续访问即可。

生产或长期使用建议提供证书和私钥：

```yaml
environment:
  ADMIN_WEBUI_ENABLE_HTTPS: "true"
  ADMIN_WEBUI_AUTO_SELF_SIGNED: "false"
  ADMIN_WEBUI_SSL_CERT: "/etc/nginx/certs/tls.crt"
  ADMIN_WEBUI_SSL_KEY: "/etc/nginx/certs/tls.key"
ports:
  - "8443:443"
volumes:
  - ./admin-webui-certs:/etc/nginx/certs:ro
```

证书目录需要包含：

```text
admin-webui-certs/tls.crt
admin-webui-certs/tls.key
```

启用后访问：

```text
https://localhost:8443
```

## 环境变量

- `ADMIN_WEBUI_PORT`: WebUI 暴露端口，默认 `8090`
- `ADMIN_UI_REFRESH_INTERVAL_MS`: 页面默认刷新间隔，默认 `1000`
- `ADMIN_API_TOKEN`: 可选访问令牌；设置后 WebUI 会通过 `X-Admin-Token` 请求后端 API
- `ADMIN_WEBUI_ENABLE_HTTPS`: 是否启用 HTTPS，默认 `false`
- `ADMIN_WEBUI_AUTO_SELF_SIGNED`: 缺少证书时自动生成自签名证书，默认 `false`
- `ADMIN_WEBUI_SSL_CERT`: HTTPS 证书路径，默认 `/etc/nginx/certs/tls.crt`
- `ADMIN_WEBUI_SSL_KEY`: HTTPS 私钥路径，默认 `/etc/nginx/certs/tls.key`

## API

`telegram-downloader` 侧新增接口：

- `GET /health`
- `GET /api/overview`
- `GET /api/downloads`
- `GET /api/system`
- `GET /api/bot`

这些接口只读取下载状态、队列、进程资源、磁盘占用、Bot API 连通性和 bot 基本信息，不执行下载控制操作。
