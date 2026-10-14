# OAOOAO 生产部署说明

本文适用于本仓库的 Next.js 前端和 [backend/ 后端](backend/README.md)。示例统一使用 `https://example.com`、前端端口 `3000` 和后端端口 `3001`；替换为实际部署配置。不要将密码、渠道密钥、完整环境文件、数据库备份或用户数据提交到仓库。

## 1. 运行架构与当前能力

```text
浏览器 → HTTPS 反向代理 → Next.js 前端 :3000
                              │ /api/* 服务端代理
                              └→ 独立后端 :3001 → PostgreSQL
                                                   持久化媒体目录
                                                   后台任务 worker
```

- 前端使用 Node.js 22、Next.js 16 和 pnpm 12；pnpm 精确版本以 `package.json` 的 `packageManager` 为准，依赖以锁文件为准。需要 Node 服务运行 `/api` 代理，不能只发布静态 HTML。
- 后端使用 Node.js 22、TypeScript、Fastify 和 PostgreSQL。会话、积分、订单和任务保存在 PostgreSQL，**不需要 Redis**。
- 后端本地媒体目录必须持久化，并对运行账户可写。视频合成与水印导出依赖 FFmpeg、FFprobe、所需编解码器和字体；详见后端 README。备份数据库不会自动备份媒体文件。
- 浏览器提交逻辑模型 ID，后端使用已实现且已配置的上游适配器调用模型。配置字段存在不代表相应协议已实现或已验收。
- 当前收款方式只有 `manual`。微信扫码登录、短信登录、MFA 注册/验证、易支付、支付宝/微信支付/Stripe 的实际支付执行均未实现，不能通过填写凭证把它们变成可用能力。
- 创作媒体写入对象存储尚未实现。S3 配置检测只执行 `HeadBucket`，不是上传或写入验收；开启对象存储会阻止不支持的创作媒体操作，应继续使用受支持的持久化本地媒体目录。
- SMTP 邮件功能需要配置并验证真实投递。不要把短信、微信或 MFA 当作未配置 SMTP 时的替代登录方式。

后端功能边界、迁移细节和容器要求以 [后端 README](backend/README.md) 及 [部署与回滚文档](backend/docs/DEPLOYMENT.md) 为准。

## 2. 环境变量

### 前端

通过进程环境或未入库的 `.env.production.local` 配置。下列变量只在服务端使用，不要改成 `NEXT_PUBLIC_*`：

```dotenv
OAOAO_BACKEND_URL=http://127.0.0.1:3001
OAOAO_PUBLIC_URL=https://example.com
OAOAO_TRUST_REVERSE_PROXY=false
```

| 变量 | 说明 |
| --- | --- |
| `OAOAO_BACKEND_URL` | 必填。前端服务器能访问的后端 HTTP(S) 地址，不是浏览器地址，也不要附加 `/api`。前端会追加完整的 `/api/*` 路径。容器间使用实际服务地址，例如 `http://backend:3001`。 |
| `OAOAO_PUBLIC_URL` | 生产必须显式设置为浏览器访问的源，包含协议及非默认端口，例如 `https://example.com`。代理用它验证写入请求的 `Origin` / `Referer`。 |
| `OAOAO_TRUST_REVERSE_PROXY` | 默认关闭。仅当可信入口覆盖 `X-Real-IP`，且浏览器无法绕过入口直连 Next.js 时，才设为 `true`。它允许前端把经验证格式的客户端 IP 转交后端。 |

反向代理终止 TLS 时，`OAOAO_PUBLIC_URL` 仍是外部 HTTPS 源。未设置时源码会从当前请求推断源，这只适合受控本地开发，不能替代生产的显式配置。

### 后端

后端不会自动加载 `.env`：使用进程环境、容器 `--env-file`，或 Node.js 的 `--env-file`。名称与前端不同：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串。使用专用数据库与账户，通过秘密管理系统注入。 |
| `ENCRYPTION_KEY` | 32 个随机字节的 Base64 编码。保护已保存的集成秘密及验证令牌；随受保护的备份保留，不可随意轮换。 |
| `NODE_ENV` | 生产设为 `production`。 |
| `PUBLIC_ORIGIN` | 与前端公网源一致，此例为 `https://example.com`。生产模式要求 HTTPS。 |
| `ALLOWED_ORIGINS` | 前端先校验浏览器来源，再将上游 `Origin` 改成后端目标源。因此本例必须包含 `http://127.0.0.1:3001`；容器目标是 `http://backend:3001` 时填写该精确源。不要用关闭 CSRF 检查代替配置。 |
| `HOST` / `PORT` | 同机进程可设 `127.0.0.1` / `3001`；容器内部使用 `0.0.0.0` / `3001`，对外暴露仍受私网或回环限制。 |
| `MEDIA_ROOT` | 持久化媒体目录；容器挂载位置和权限应与后端镜像约定一致。 |
| `WORKER_ENABLED` | 导入、对账、候选版本验收期间设为 `false`。默认开启；验收通过后设为 `true` 并重启后端，恢复生成和商业维护任务。 |
| `TRUSTED_PROXY_CIDRS` | 只列直接连接后端的可信代理 IP 或有边界的 CIDR。空值不信任转发 IP；不要信任任意公网转发链。 |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` | 仅初次创建管理员时使用，完成后移除。不得用它覆盖已有管理员。 |
| `TEST_DATABASE_URL` | 自动化测试专用的一次性数据库，绝不能指向生产数据库。 |

`WORKER_ENABLED=false` 不会禁止 HTTP 写入，候选环境仍需访问隔离。前后端代理信任必须成套配置；否则后端可能把所有用户视为同一个代理 IP，影响限流。启用前验证真实客户端 IP 和伪造转发头的处理结果。

## 3. 构建、迁移与启动

在同一仓库根目录中使用锁定的 pnpm 版本，只安装和构建前端：

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run test:acceptance
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3000
```

前端环境变量必须在服务启动时存在。生产进程使用服务管理器或容器管理，不使用开发服务器。

在另一个终端，从同一仓库根目录进入 `backend/`，使用后端独立的 npm 锁文件。先注入目标数据库及运行配置，再执行：

```sh
cd backend
npm ci
npm run typecheck
npm run build
node --env-file=.env dist/src/migrate.js
node --env-file=.env dist/src/server.js
```

这些后端命令的工作目录均为 `backend/`，假定其中的 `.env` 是本机受保护且已正确配置的文件；部署平台也可以直接注入环境变量并省略 `--env-file`。构建会将迁移 SQL 复制到 `dist/migrations`，迁移必须作为独立的一次性步骤执行，启动 API 不会自动迁移。

全新空站点且没有导入管理员时，才使用 `node --env-file=.env dist/src/bootstrap.js` 创建初始管理员。迁入已有用户时，不要提前 bootstrap；数据导入要求空的目标业务表。

- `/api/health/live` 检查进程；`/api/health/ready` 检查数据库访问与打包迁移清单、校验和。后端私网还有 `/health` 和 `/ready`。
- readiness 返回 503 时先核对数据库和迁移，不要编辑已执行的迁移 SQL 来绕过校验。
- 健康检查通过不等于模型调用、邮件投递、人工收款或数据迁移已通过验收。

容器构建和媒体卷权限请按 [后端说明](backend/README.md#配置与部署) 执行；从根目录构建后端镜像时使用 `docker build -f backend/Dockerfile backend`，构建上下文只包含后端目录。前端和后端仍是两个进程或镜像，必须从同一个已审查的仓库提交构建。发布记录应记录该提交、两个锁文件、前后端产物或镜像摘要，以及实际运行环境配置的非秘密标识。

## 4. HTTPS、Cookie 与反向代理

生产公网入口必须使用 HTTPS，并将 HTTP 重定向到 HTTPS。后端和 PostgreSQL 只允许受控内网或回环访问。

后端生产会话 Cookie 为 `__Host-oaooao_session`，设置 `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`，不设置 `Domain`。开发模式使用另一个 Cookie 名称。不要重写 Cookie 的域或去掉安全属性；部署切换后重新验证登录、退出和会话撤销。

前端代理会原样转发请求体和 Cookie，逐条转发多个 `Set-Cookie`，不缓存 API 响应，并移除不应跨代理传递的连接头及浏览器提供的转发头。公网入口需保留请求方法、`Origin`、`Referer` 和 `Sec-Fetch-Site`，不要缓存认证接口、积分或账户响应，也不要对流式响应进行缓冲或再次压缩。

下面是 HTTPS 虚拟主机中的 Nginx 片段，证书与 HTTP 重定向另行配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;
    proxy_set_header Referer $http_referer;
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    client_max_body_size 64m;
}
```

入口超时按实际流式请求调整。后台任务持久化运行，不能依赖浏览器连接保持整个生成周期；断线后应读取已有任务状态，不要直接重提收费任务。JSON 请求当前受后端 8 MiB 限制，multipart 还有每文件 50 MiB 等限制，具体接口可能更严格。示例入口总请求上限为 64 MiB；允许多文件上传时需同步核对总大小，不能通过放宽入口限制绕过业务限制。

## 5. 商用模式与人工收款

默认自用模式不开放公开购买。商用模式也不代表支付已经就绪。上线购买前，需要同时完成：

1. 发布真实适用的购买政策、服务条款、隐私政策及联系渠道。
2. 配置并启用 `manual` 收款说明，让用户知道实际收款方式和订单核对流程。
3. 启用有效商品；套餐商品还需要对应的有效权益方案。价格、积分数量和期限必须经过核对。
4. 验证下单、重复请求处理和后台订单权限。配置未就绪时保持购买关闭，不伪造渠道 ready 或支付成功。

用户创建订单不会自动获得积分。管理员必须在服务外核实实际到账、金额和订单归属后，才确认订单已支付。当前没有可启用的在线支付签名回调协议；不要照旧文档配置易支付或微信回调来期待自动入账。

人工退款同样不会转账：先通过退款准备流程冻结相应购买积分及已结算邀请奖励，取得 reservation ID；再执行并核实外部退款，最后用该 ID 确认退款完成。如果尚未对外退款，核实后才能取消准备并解除冻结。准备记录不会自动到期。详细接口与对账规则见后端部署文档。

## 6. 数据、备份与版本切换

日常升级和首次迁移都必须保留可恢复的 PostgreSQL 备份、媒体数据、匹配的 `ENCRYPTION_KEY`、审计记录及旧版本产物。备份包含敏感数据，使用受控存储并实际演练恢复。

迁移或切换按后端部署文档执行，至少做到：

1. 在隔离数据库与媒体目录演练迁移、导入和对账，关闭候选 worker。真实用户资料不作为测试夹具或发布附件。
2. 核对账户、永久/每日/限时积分、订单、历史流水、项目、画布与媒体读取；历史套餐标签不能触发重复补发。
3. 正式切换前冻结旧服务的写入和 worker，处理未决订单及上游任务，保存最终一致的数据基线。全程只保留一个有效业务写入方。
4. 迁移、校验和代表性验收通过后，再切换前端代理目标、开启新 worker 与用户写入。
5. 新后端尚无新写入时可以按已验证基线回退；出现新订单、积分变化或项目编辑后，不得直接指向旧数据库。先冻结、保留证据并核对新增数据，再决定修复或经验证的回迁。

不要反复导入旧快照、重放历史积分发放或删除旧数据库来完成回滚。本项目没有自动破坏性 down migration，也没有自动反向迁移工具。

## 7. 发布后的验证与排查

在隔离测试数据库运行后端 `npm test`。前端的 `pnpm run test:acceptance` 是当前维护的验收入口；不要把依赖旧服务结构、私有夹具或可能写入数据的历史脚本直接对生产运行。

正式放量前验证登录与退出、跨账户隔离、管理员权限、项目保存与刷新恢复、媒体读取、积分流水和已启用的购买入口。真实模型、邮件与人工收款需单独端到端核实；模拟测试和健康检查不能替代这些结果。

| 现象 | 先检查 |
| --- | --- |
| 前端 `/api/*` 返回 503，提示后端未配置或地址无效 | `OAOAO_BACKEND_URL` 是否存在、使用 HTTP(S)，以及实际服务启动环境。 |
| 返回 502 后端连接失败 | 私网地址、端口、DNS、网络规则、后端进程与代理日志；不要输出密钥或 Cookie。 |
| 写入返回 403 | 公网 `OAOAO_PUBLIC_URL`、后端 `PUBLIC_ORIGIN`、精确内部 `ALLOWED_ORIGINS` 以及被入口保留的来源头。 |
| 登录后仍未登录 | HTTPS、生产 Cookie、多个 `Set-Cookie` 是否完整传递、旧会话是否已失效。 |
| readiness 返回 503 | 数据库可达性、迁移清单与校验和；不要修改已应用迁移。 |
| 请求返回 413 | 入口总请求限制、后端 JSON 或文件限制及对应接口限制。 |
| 已下单但无积分 | 先核实是否真的到账并由有权限的管理员确认；人工方式没有自动支付回调。 |
| 任务等待或需要人工检查 | worker 状态、逻辑模型/渠道配置、上游真实结果与日志；未知结果不得当作确认失败重复收费或自动重发。 |

## 8. 源码版本与第三方声明

前端页脚固定链接到 [OAOOAO 开源仓库](https://github.com/buyue666/OAOOAO) 和 [AGPL-3.0 许可证](LICENSE)。前端在根目录，后端在同一仓库的 [backend/](backend/README.md)。部署前确认该提交及两个目录的完整源码可公开访问，不能让入口指向私有或缺失的源码。

每次发布为实际构建的同一仓库提交保留可检出的版本标记、前后端锁文件、迁移和构建/运行说明。运行自定义修改时也要提供对应修改的源码；只链接一个与线上版本不同的最新分支不能说明当前运行版本。发布记录应明确该提交与前后端产物摘要之间的对应关系，避免源码链接与部署版本脱节。

保留 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、依赖许可证及 [后端第三方声明](backend/THIRD_PARTY_DEPENDENCY_NOTICES.txt)。应用许可证不会替代依赖、图标、字体和素材的许可；后端镜像中的 FFmpeg 与系统包还各有其声明和源码义务，分发镜像时需按实际包含的版本处理。
