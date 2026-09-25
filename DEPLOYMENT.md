# OAOOAO 生产部署说明

本文说明 OAOOAO 前端（Next.js 16）在生产环境部署时必须配置的内容。
本文不保存任何密码、API Key、支付密钥或数据库连接串明文。

## 1. 架构与角色

```
浏览器 ──HTTPS──> OAOOAO 前端（Next.js）
                      │  服务端转发，携带会话 Cookie
                      └──HTTP──> 后端服务（真实业务与数据）
```

- 浏览器只与前端的 `/api/*` 通信，前端通过 `app/api/[...path]/route.ts` 转发到后端。
- 前端不保存渠道密钥：生成任务只提交逻辑模型 ID，真正的渠道与密钥由后端解析。
- 会话 Cookie 由后端下发，前端转发时保持同源与凭据。

## 2. 必须配置的环境变量

### 前端（OAOOAO，本项目）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `OAOAO_BACKEND_URL` | 是 | 后端服务地址，形如 `http://127.0.0.1:3200`。必须是前端服务器可访问的地址，不能填浏览器地址。 |
| `OAOAO_PUBLIC_URL` | 生产建议 | 站点的对外源，形如 `https://studio.example.com`。用于校验写入请求的 `Origin`/`Referer`。 |

说明：

- **必须与浏览器访问的源完全一致**（协议、域名、端口）。不一致时所有 `POST`/`PATCH`/`DELETE` 都会返回 403「跨站请求已被拦截」。
- 反向代理终止 TLS 时，仍需把 `OAOAO_PUBLIC_URL` 设为 `https://` 开头的公网地址。
- 未设置 `OAOAO_PUBLIC_URL` 时，前端会回退为按请求头推断当前源。仅在单节点、无代理的本地环境可接受。

### 后端（由后端服务自身配置）

后端需要配置的内容不属于本仓库，但生产环境至少需要：

- 数据库连接与 Redis 连接
- 会话/加密密钥
- 对象存储（如启用）
- 邮件 SMTP（如启用邮箱注册）
- 各上游渠道的 API Key（在管理后台 `/admin/channels` 配置，或通过环境变量注入后由后端读取）
- 支付渠道密钥（如启用在线支付，见第 5 节）

前端不会读取、记录或转发这些密钥的明文。

## 3. HTTPS 与 Cookie

### HTTPS

生产环境必须使用 HTTPS：

1. 在反向代理（Nginx / Caddy / 云负载均衡）终止 TLS，证书需覆盖实际域名。
2. 将 HTTP 永久重定向到 HTTPS（301）。
3. 前端与后端之间的内网跳转可以是 HTTP，但对外链路必须加密。

### Cookie 属性

会话 Cookie 由**后端**下发，请在服务器配置中确保：

| 属性 | 要求 | 原因 |
| --- | --- | --- |
| `Secure` | 生产必须开启 | 只在 HTTPS 上传输，避免明文泄露。HTTPS 未就绪前开启会导致登录态完全失效。 |
| `HttpOnly` | 必须开启 | 阻止脚本读取会话，降低 XSS 影响。前端不需要读取 Cookie。 |
| `SameSite` | `Lax`（推荐）或 `Strict` | 阻断裂站请求携带会话。若使用第三方支付回跳，`Lax` 兼容性更好；`None` 只在确实需要跨站时使用，且必须同时有 `Secure`。 |
| `Domain` | 建议不设置（主机级 Cookie） | 不设置时 Cookie 绑定到确切主机，范围最小。前后端不同子域时按需设置为父域，但会扩大到该域下所有子域。 |
| `Path` | `/` | 前端统一在 `/api` 下访问后端接口。 |

注意：

- 如果前端与后端在不同站点（不同注册域），需要评估 `SameSite` 与 CORS 策略；更推荐让前端与后端处于同一个站点、通过同源 `/api` 路径访问，本项目的代理架构正是为此设计。
- 修改 `Domain` 或 `SameSite` 后必须重新登录验证，旧 Cookie 不会自动迁移。

## 4. 反向代理要求

前端代理 `app/api/[...path]/route.ts` 已经处理了以下事项，反向代理需要与之配合：

1. **保留请求方法**：`POST`、`PATCH`、`PUT`、`DELETE` 必须原样转发，不能被改写为 `GET`。
2. **保留请求body**：不要缓冲或截断 JSON body；生成任务的 body 可能较大（含参考图 data URL，单次上限 32 MB）。
3. **保留 Cookie**：请求方向必须携带 `Cookie` 头，响应方向必须回传 `Set-Cookie`。多个 `Set-Cookie` 都要保留，不能合并成一个。
4. **流式响应**：生成任务与 Agent 事件使用流式响应（SSE）。代理必须关闭响应缓冲：
   - Nginx：`proxy_buffering off;`，并适当提高 `proxy_read_timeout`（生成任务可能长时间轮询）。
   - Caddy：默认不缓冲，无需额外配置。
5. **不要添加压缩**：前端转发时已设置 `accept-encoding: identity` 并移除 `content-encoding`，代理不要再次压缩流式响应。
6. **超时**：视频与 Agent 任务最长可能运行数十分钟。反向代理的读写超时建议不低于 30 分钟，否则长任务会在代理层被断开（后端任务仍会继续，但前端会失去连接）。
7. **来源校验**：前端已校验 `Origin`/`Referer` 与 `Sec-Fetch-Site`。反向代理不要改写或移除这些头，否则写入请求会被判为跨站。

参考的 Nginx 片段（仅关键项）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3310;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;
    proxy_set_header Referer $http_referer;
    proxy_buffering off;
    proxy_read_timeout 1800s;
    proxy_send_timeout 1800s;
    client_max_body_size 40m;
}
```

## 5. 支付配置

### 当前状态

- 本地可用支付渠道只有 `manual`（人工支付），可通过 `GET /api/billing/products` 的 `paymentProviders` 确认。
- 后端存在真实支付回调接口 `/api/billing/webhooks/{provider}`（支持 `POST` 与 `GET`），会校验签名密钥后驱动订单与积分结算。
- 未配置支付密钥时，回调返回「支付回调密钥未配置」。这是**配置缺失**，不是实现缺失。

### 生产启用在线支付需要做

1. 在后端配置对应渠道的密钥（Stripe / 易支付等），变量名以 `GET /api/admin/billing/payment-config` 返回的 `fields[].envNames` 为准。
2. 在支付渠道后台把回调地址配置为后端公网地址 + `webhookPath`，例如：
   `https://api.example.com/api/billing/webhooks/stripe`
   `payment-config` 返回的 `webhookUrl` 已经给出完整地址，可直接使用。
3. 回调地址必须是**公网可达的 HTTPS**，且不能被登录鉴权重定向拦截。
4. 配置完成后回到 `/admin/orders`，确认「支付渠道统计」出现该渠道，并用一笔小额真实订单验证：下单 → 支付 → 回调 → 订单变为已支付 → 积分到账。
5. 退款同样依赖渠道配置；未配置时退款会失败并返回后端错误。

### 未配置在线支付时

- 只使用人工支付：用户下单后由管理员在 `/admin/orders` 人工标记已支付或关闭订单。
- 不要为了让测试通过而放宽后端校验或伪造支付成功。

## 6. 接口返回 500 时的排查顺序

「系统接口 500」出现过三类原因，均已在 2026-09 修复。按以下顺序排查：

### 1) `OAOAO_BACKEND_URL` 配置错误（最常见）

当该变量缺少 `http://` 或 `https://` 前缀（例如写成 `127.0.0.1:3200`）时，
地址解析会失败，导致**所有** `/api/*` 请求异常。

已修复为返回 503 并给出明确提示：

```
{"error":"后端服务地址无效，请检查 OAOAO_BACKEND_URL 是否包含 http:// 或 https:// 前缀"}
```

看到这条信息即说明是环境变量问题，不需要改代码。
可用 `node tests/proxy-config.test.mjs` 复现与验证该行为。

### 2) 请求体格式不正确（已修复为 400）

后端 `readJsonBody` 此前会放行 `null`、数字、字符串、顶层数组等**合法 JSON 但不是请求对象**的内容，
后续 `body.xxx` 抛 TypeError 或以 500 结束；部分路由又把入参错误重新抛出。
现在统一返回 400 与明确原因：

| 情况 | 响应 |
| --- | --- |
| 畸形 JSON（`{`） | 400 `请求内容不是有效 JSON` |
| `null` / 数字 / 字符串 / 顶层数组 | 400 `请求体必须是 JSON 对象` |
| 图片任务 `prompt` 非字符串 | 400 `画面描述必须是文本` |
| 视频/音频 `prompt` 非字符串 | 400 `镜头描述必须是文本` / `音频文本必须是文本` |
| 请求体超过大小上限 | 413 `请求体过大` |

覆盖范围：`/api/admin/settings`、`/api/admin/billing/promotions`、`/api/admin/models`、
作品审核/下架/推荐、治理案件、作品申诉、关注/点赞/举报、生成记录增删改、图片/视频/音频/文本任务、Agent 运行等
共 30+ 个接口。回归测试：`node tests/api-robustness.test.mjs`。

### 3) 上游任务标识冲突（已修复为 409）

`generation_tasks` 上有唯一索引 `(channel_id, upstream_task_id)`，用于保证同一渠道下
同一个上游任务只被一个本地任务接管。当该标识已被占用时 Postgres 抛 `23505`，
旧实现未捕获，导致视频/音频任务的**取消**与**重新检查**直接 500。

现在识别该错误码并按冲突处理，返回 `409 当前任务无法取消` / `409 视频任务状态已变化，请刷新后重试`。
非唯一约束的数据库错误仍会正常抛出并记录，不会被误吞。

若已存在卡在 `needs_review` 且操作返回 409 的历史任务，可用管理后台
「生成运维 → 人工确认 → 确认上游未创建，结束任务」把它们收敛到终态。

## 7. 密钥与敏感信息
以下要求必须满足，本项目已按此实现多个环节：

- 前端不读取渠道 API Key：生成任务只提交逻辑模型 ID。
- 管理后台的渠道密钥字段始终脱敏返回，编辑时只能写入新值（留空表示沿用已保存的值）。
- 审计日志与设置接口中的密钥、密码、令牌类字段在展示前被遮蔽。
- 邮件与对象存储密钥字段同样是只写不可回显。
- 日志中不要输出 API Key、密码、Token 或 Cookie。

部署检查清单：

- [ ] 确认 `OAOAO_BACKEND_URL` 指向正确后端，且前端服务器可访问
- [ ] 确认 `OAOAO_PUBLIC_URL` 与浏览器实际访问源完全一致（含协议）
- [ ] 确认 HTTPS 已生效，HTTP 已重定向
- [ ] 确认会话 Cookie 具备 `Secure`、`HttpOnly`、合适的 `SameSite`
- [ ] 确认反向代理保留方法、body、Cookie 与流式响应，并放宽长任务超时
- [ ] 确认支付回调地址可从公网访问（如启用在线支付）
- [ ] 确认前端与后端日志中不含密钥明文

## 8. 部署后验证

```powershell
# 类型与构建
pnpm exec tsc --noEmit --pretty false
pnpm build

# 回归测试（需要后端与前端在运行）
node --test tests/membership.test.cjs
node tests/proxy-config.test.mjs
node tests/api-robustness.test.mjs
node tests/generation-flow.test.mjs
node tests/generation-browser-check.mjs
node tests/admin-smoke.mjs
node tests/admin-write-check.mjs
node tests/admin-browser-check.mjs
node tests/admin-interaction-check.mjs
```

手工验证至少覆盖：

1. 登录后 `/image` 的模型下拉只出现后台已配置的模型。
2. 提交一次真实生成，任务中心能看到状态推进、结果或失败原因、积分消耗。
3. 刷新页面后任务仍在。
4. 取消一个进行中任务，后端状态变为已取消。
5. 未登录访问 `/image` 时明确显示「本地预览」。
6. `/admin` 下 9 个页面均可打开，危险操作有确认弹窗。
7. 故意把 `OAOAO_BACKEND_URL` 写成缺少协议的地址，确认接口返回 503 且提示明确（而不是 500）。
