# 部署 paintpaint

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
