# OAOOAO Studio

这是 OAOOAO Studio 的前端工作台，基于 Next.js 16、React 19、TypeScript 和 React Flow。

## 本地运行

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

默认读取 `.env.local` 中的 `OAOAO_BACKEND_URL`，当前本地配置指向 `http://127.0.0.1:3200`。`app/api/[...path]/route.ts` 校验浏览器来源后转发 API，保留会话 Cookie 和流式响应。反向代理部署可设置 `OAOAO_PUBLIC_URL`。

本仓库包含完整前端与 API 转发层，不包含独立业务后端、数据库、实际密钥或用户数据。首页 `/` 可独立预览，创作工作台为 `/studio`；登录、生成、支付和管理功能需要兼容后端。首页素材与验收说明见 `LANDING_PAGE_NOTES.md`。

登录入口：`/login`

订阅页：`/plans`，组件来源为用户提供的 `D:\下载\订阅.zip`，保留黑色背景、横向套餐栏、周期和档位选择、权益分组。沿用此前去掉顶部活动横幅的改动。价格、商品、周期和权益读取真实后台；不导入压缩包中的虚拟售价。

商品管理：`/admin/products`；订单管理：`/admin/orders`。支持新增、编辑、上架、下架，以及订阅页名称、分组、档位、配色、权益配置。相同 `metadata.membership.groupId` 和 `tierId` 的商品按实际有效期归入不同周期，购买时使用对应商品 ID。金额以分存储，年付为整期价格。

旧管理入口 `/management` 只会按 `section` 参数跳转到 `/admin` 下的对应页面，不再进入任何外部管理端。

## OAOOAO 管理后台

独立后台入口为 `/admin`，使用 OAOOAO 的黑白灰工作台样式，全部数据来自当前后端的真实管理接口：

- `/admin`：今日与近 7/30 日调用、成功率、失败率、活跃用户、调用类型分布、模型排行、渠道成功率、排队任务、收入与退款摘要
- `/admin/users`：用户搜索与分页、详情抽屉、资料编辑、启用/禁用、积分与套餐调整、管理员职责分配、调用记录与订单消费
- `/admin/generation`：按用户/模型/渠道/类型/状态/时间筛选，任务详情、耗时、上游任务 ID、错误原因、积分消耗、重试、取消与人工接管
- `/admin/channels`：渠道新增/编辑/删除/启停、连通性测试、拉取模型列表、模型能力与协议配置、逻辑模型显示名称、优先级/权重/并发、失败次数与冷却状态
- `/admin/products`：订阅套餐与积分包的新增、编辑、上下架、周期/价格/积分/权益配置，以及促销活动
- `/admin/orders`：订单搜索分页与状态筛选、订单详情、关闭、退款、支付状态，以及财务摘要、优惠券、邀请返利与支付渠道统计
- `/admin/content`：公告新增/编辑/发布/下线、首页与登录后弹窗、生效区间，作品审核、下架、推荐与举报治理
- `/admin/settings`：站点品牌、注册开关、每日免费积分、计费与权益、生成并发与默认参数、邮件服务（含测试发信）、对象存储、数据保留
- `/admin/audit`：管理员操作、登录、配置变更、用户与渠道修改、退款与积分调整，支持关键词/操作类型/结果/目标/时间筛选，敏感字段自动脱敏

后台导航与页面按钮都由后端返回的管理员职责控制。未登录或无管理员职责时只显示登录提示；接口失败会显示明确错误与重试入口，不使用本地 mock 数据冒充线上管理数据。危险操作（禁用用户、退款、关闭订单、下架作品、删除渠道等）统一走确认弹窗；API Key、密码与令牌类字段始终脱敏，编辑时只能写入新值。

## 已接入

- `/api/auth/session`：启动时读取真实会话、积分与**真实逻辑模型目录**（模型下拉与积分估算的唯一来源）
- `/api/auth/login`：真实登录并保存后端会话 Cookie
- `/api/image-tasks`、`/api/video-generation-tasks`、`/api/audio-tasks`、`/api/text-tasks`：真实创建生成任务
- 任务详情 `GET /api/{image,video,audio,text}-tasks/{id}`：轮询状态、结果、错误原因与积分消耗
- 任务取消 `PATCH`、重新检查上游 `POST {action:"recover"}`：作用于后端真实任务
- `/api/agent/runs`：导演 Agent 真实运行创建、详情轮询、暂停/恢复/重试/取消与子任务重试
- `/api/generation-logs`：生成记录分页读取
- `/api/billing/products`：套餐页读取后台启用商品、价格和权益
- `/api/billing/orders` 与订单 checkout：登录后创建真实订单并进入后端支付流程
- `/api/canvas/projects`：画布项目创建、读取和版本化保存
- 画布同步状态：已同步、保存中、本地预览、版本冲突、同步失败

## 真实生成业务

前台生成流程已接入后端真实接口，模型目录、任务、结果与积分全部来自后端：

- **模型目录**：来自会话 `settings.logicalModels` 与 `defaultModels`。下拉里只有后台已配置且至少有一条启用绑定的逻辑模型；没有真实目录时不会伪造模型。
- **任务创建**：图片、视频、音频、文本分别提交到对应后端接口，并携带 `clientRequestId`。后端据此去重，重复提交不会产生第二条任务。
- **状态轮询**：活跃任务每 2.5 秒查询一次后端详情，进入 success / error / cancelled 后停止；最长轮询 30 分钟。
- **结果展示**：图片、视频、音频结果解析为可播放媒体；文本任务展示返回文本。不同接口的 result 结构在 `lib/studio/generation-api.ts` 统一归一化。
- **失败原因**：后端返回的错误原文展示在任务卡片与任务详情中，不替换成笼统文案。
- **积分消耗**：优先读取任务返回的积分字段，同时解析后端 `x-vozeb-pro-points-*` 响应头得到实时余额。
- **取消 / 重试 / 重新检查**：全部作用于后端任务。取消前有确认提示；后端返回 409 时把冲突原因展示给用户。
- **刷新恢复**：最近任务 ID 保存在浏览器本地，页面刷新后按 ID 重新向后端拉取，任务不会丢失。
- **导演 Agent**：通过 `/api/agent/runs` 创建真实运行，展示后端返回的子任务状态，并支持暂停、恢复、整体重试、取消与单个子任务重试。
- **本地预览**：未登录或后端不可用时，工作台与任务中心明确显示「本地预览」并说明不会提交；不会把演示数据显示成真实成功。

## 支付流程

- **手动支付**：`/api/billing/orders` 创建订单 → `/api/billing/orders/{id}/checkout` 返回人工支付信息 → 用户付款后由管理员在 `/admin/orders` 标记已支付或关闭。
- **订单查询**：`GET /api/billing/orders/{id}` 读取当前支付状态与快照。
- **关闭**：`POST /api/billing/orders/{id}/cancel` 关闭未支付订单。
- **退款**：`POST /api/admin/billing/orders/{id}/refund` 只对已支付订单生效，未支付订单后端返回 409「只有已支付订单可以退款」。
- **支付回调**：后端确实存在 `/api/billing/webhooks/{provider}`（POST/GET），会校验签名密钥并驱动订单与积分结算。本地未配置支付密钥时该接口返回「支付回调密钥未配置」，这是预期行为，不是实现缺失。
- 本地可用的支付渠道只有 `manual`（见 `/api/billing/products` 的 `paymentProviders`）。真实在线支付需要在后端配置对应渠道密钥后才能验证，本仓库不伪造支付成功。

## 检查

```powershell
pnpm exec tsc --noEmit --pretty false
pnpm build
node --test tests/membership.test.cjs
```

验收脚本（需要本地后端 3200 与前端 3310 正在运行，且已存在管理员账号）：

需要登录的旧验收脚本使用隔离环境中的 `fusion_admin`，密码必须通过 `OAOAO_TEST_PASSWORD` 环境变量提供，仓库不附带密码。部分脚本复用本地后端目录的 Playwright 与 sharp 安装，需按本机路径配置后运行；首页检查支持 `PLAYWRIGHT_ROOT` 指定依赖所在项目。夹具数据库连接使用 `OAOAO_TEST_DATABASE_URL`，仅限隔离测试库。不要将这些有写入操作的脚本用于生产环境。含内部环境信息的历史运营报告仅保留在本地，不随公开仓库发布。

```powershell
node tests/proxy-config.test.mjs         # 代理配置：非法 OAOAO_BACKEND_URL 返回 503 而非 500
node tests/api-robustness.test.mjs       # 接口健壮性：畸形输入不产生 5xx，干净任务可正常取消
node tests/generation-flow.test.mjs      # 真实生成：登录、模型目录、创建、轮询、终态、积分、取消、去重、刷新恢复、未登录 401
node tests/generation-browser-check.mjs  # 浏览器生成：真实模型下拉、任务中心、刷新恢复、界面取消打到后端、本地预览标记
node tests/admin-smoke.mjs               # 9 个页面 + 17 个管理接口 + 未登录 401
node tests/admin-write-check.mjs         # 写入路径：公告、设置、渠道密钥保持、用户资料、越权与跨站拦截
node tests/admin-browser-check.mjs       # 真实浏览器渲染、品牌文字、横向溢出与控制台错误
node tests/admin-interaction-check.mjs   # 抽屉、确认弹窗、标签页、用户详情分页与设置分节交互
```

`generation-flow.test.mjs`、`admin-write-check.mjs` 与 `admin-interaction-check.mjs` 只操作自建测试数据并清理，不会修改既有用户、订单或配置。

后端的登录与视频接口有频率限制（登录 15 分钟 8 次、视频 1 分钟 6 次）。频繁运行测试会触发 429，脚本会识别为环境节流并跳过或标记，不会误报为失败。

遇到「系统接口 500」时的排查顺序见 `DEPLOYMENT.md` 第 6 节。三类成因（代理地址缺协议、请求体格式、上游任务标识冲突）均已修复，并分别由 `tests/proxy-config.test.mjs` 与 `tests/api-robustness.test.mjs` 持续回归。

后端的套餐与画布接口仍需按现有服务的数据库、Redis 和支付配置运行。支付按钮在未登录状态会被保护，不会创建订单。

本次订阅与管理验收记录见 `SUBSCRIPTION_ADMIN_TEST_REPORT.md`。生产部署的环境变量、HTTPS、Cookie 与反向代理要求见 `DEPLOYMENT.md`。
