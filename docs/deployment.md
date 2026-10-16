# 部署 paintpaint

## 当前在线部署

`https://paintpaint.happycyn.cn` → Cloudflare Worker → 现有 Cloudflare Tunnel → Ubuntu 上的 Node.js 服务。

Worker 仅转发请求，画板、实时协作与数据库都运行在 Ubuntu。Worker 自定义域名由 Wrangler 管理 DNS 和证书。Tunnel 入口使用独立路径 `/__paintpaint`，保留宿主域名上的其他站点路由。此方案无需 DNS API 写入凭证。

### Ubuntu 常驻服务

- 目录：`~/Projects/paintpaint`
- Node：`~/.local/opt/node-v24.22.0-linux-x64/bin/node`
- 运行数据：`~/Projects/paintpaint/data/wall.sqlite`
- 用户服务：`~/.config/systemd/user/paintpaint.service`
- 监听地址：`172.17.0.1:3088`（Docker bridge 网关，供 cloudflared 容器访问）
- 环境变量：`HOST=172.17.0.1`、`PORT=3088`、`BASE_PATH=/__paintpaint`

服务模板见 [paintpaint.service](../deploy/paintpaint.service)。迁移到其他机器时请调整 Node 路径、工作目录和监听地址。用户服务需要启用 linger，确保退出 SSH 后及开机后继续运行。

```bash
systemctl --user status paintpaint
journalctl --user -u paintpaint -n 100 --no-pager
curl --fail http://172.17.0.1:3088/api/health
```

更新应用：

```bash
cd ~/Projects/paintpaint
export PATH="$HOME/.local/opt/node-v24.22.0-linux-x64/bin:$PATH"
git pull --ff-only
npm ci
npm test
npm run build
systemctl --user restart paintpaint
```

备份原生部署的数据，可先停止服务，复制整个 `data/` 到私有备份目录，再启动服务；或用 SQLite 在线备份。不要将生产数据提交到 GitHub。

### 发布域名入口

`wrangler.jsonc` 中包含自定义域名和固定的 Tunnel 源站地址，`edge/index.js` 透明转发 HTTP 与 WebSocket Upgrade。

```bash
npx wrangler login
npx wrangler deploy
```

现有 Tunnel 中需要位于默认路由之前的独立规则：

```yaml
hostname: home.happycyn.cn
path: ^/__paintpaint(/.*)?$
service: http://172.17.0.1:3088
```

源码不包含 Tunnel 凭证。源站子路径同样是公开访问入口，不承载私有接口。Worker 受当前 Cloudflare 账户的 Workers 配额约束。

## Docker

需要 Docker Engine 与 Docker Compose。生产镜像使用 Node.js 24，应用以非 root 用户运行。

```bash
git clone https://github.com/dajiba6/paintpaint.git
cd paintpaint
cp .env.example .env
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3088/api/health
```

`.env` 中可设置 `PAINT_BIND_IP` 和 `PAINT_PORT`。默认 `127.0.0.1:3088`，应用容器内端口为 3001。运行数据保存在 `wall-data` 命名卷中。

## Cloudflare Tunnel

在现有 Tunnel 的 Published application routes（公开主机名）中添加：

| 字段 | 值 |
| --- | --- |
| Subdomain | `paintpaint` |
| Domain | `happycyn.cn` |
| Service type | `HTTP` |
| URL | 宿主机运行 Tunnel 时为 `localhost:3088` |

如果 cloudflared 在 Docker 默认 bridge 网络中，`localhost` 指 cloudflared 容器自身。可以将 `.env` 的 `PAINT_BIND_IP` 配为宿主机 Docker 网桥地址（先用 `docker network inspect bridge` 确认），并将路由 URL 设为该地址的 `3088` 端口，例如 `172.17.0.1:3088`。无需把应用端口绑定到公网网卡。

保留现有 Tunnel 的其他路由。Cloudflare 面板保存公开主机名时通常会同时创建 DNS 记录。若需单独配置，创建代理开启的 CNAME：`paintpaint` → `<tunnel-id>.cfargotunnel.com`。

上线后验证：

```bash
curl --fail https://paintpaint.happycyn.cn/api/health
```

还应使用两个浏览器窗口确认笔迹实时同步；HTTP 健康检查不等于 WebSocket 已验证。

## 更新

```bash
git pull --ff-only
npm ci && npm test # 可在开发机或 CI 中完成
# 服务器使用 Docker 构建，无需宿主机安装 Node 24。
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

**不要运行 `docker compose down -v`**，`-v` 会删除画板数据卷。

## 备份

用 SQLite 的 `VACUUM INTO` 生成一致性快照，然后复制出来：

```bash
docker compose exec paintpaint node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/app/data/wall.sqlite'); db.exec(\"VACUUM INTO '/tmp/wall-backup.sqlite'\"); db.close();"
docker compose cp paintpaint:/tmp/wall-backup.sqlite ./wall-backup.sqlite
```

备份目标文件必须不存在；重复备份时使用不同文件名。备份含用户绘画数据，请保存到私有位置，不要提交到 GitHub。此仓库默认忽略 `data/`、环境配置与本地依赖。
