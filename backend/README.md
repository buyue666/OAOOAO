<div align="center">

![OAOOAO — Open Creative Workspace](https://raw.githubusercontent.com/buyue666/OAOOAO/main/docs/assets/repository-banner.svg)

# OAOOAO Backend

**连接创作、数据与任务的独立后端。**

[![Node.js](https://img.shields.io/badge/Node.js-22+-43853d?style=flat-square&logo=nodedotjs)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5-171717?style=flat-square&logo=fastify)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-persistence-4169e1?style=flat-square&logo=postgresql)](https://www.postgresql.org/)

[前端与项目说明](../README.md) · [运行配置](docs/GETTING-STARTED.md) · [部署指南](../DEPLOYMENT.md) · [API 覆盖范围](docs/CLIENT-API-COVERAGE.md)

</div>

---

## 能力

| 模块 | 实现 |
| --- | --- |
| 账户与权限 | 用户名与邮箱登录、微信公众号扫码登录与账户绑定、会话、密码校验、管理员权限和操作审计。 |
| 积分钱包 | 永久、每日及限时积分；事务扣费、幂等记账、退款预留和到期处理。 |
| 每日签到 | 按普通身份或有效套餐设置赠送数量和有效期，保留领取规则快照并防止重复领取。 |
| 商业配置 | 套餐、积分包、易支付通知与幂等到账、人工收款、退款登记、生成能力权限和购买政策。 |
| 创作任务 | 图片、视频、文本和音频任务；有界 Agent 计划、恢复与取消。 |
| 项目与媒体 | 画布、分镜项目、素材及生成记录持久化；本地媒体与 FFmpeg 导出。 |
| 内容与品牌 | 公告横幅、弹窗、展示时间、品牌设置、页脚与公开政策。 |

使用 Node.js、TypeScript、Fastify 和 PostgreSQL；任务队列与业务状态保存在数据库中，不依赖 Redis。前端通过同源代理访问，后端持有渠道凭据。

## 快速开始

准备 Node.js 22+、npm 和一个空的开发 PostgreSQL 数据库。媒体导出还需要 FFmpeg、FFprobe 与 CJK 字体。

```sh
git clone https://github.com/buyue666/OAOOAO.git
cd OAOOAO/backend
npm ci
```

将 `.env.example` 复制为 `.env`，设置 `DATABASE_URL`、`ENCRYPTION_KEY`、`PUBLIC_ORIGIN` 和 `ALLOWED_ORIGINS`。生成加密密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

执行迁移并启动服务：

```sh
npm run typecheck
npm run build
node --env-file=.env dist/src/migrate.js
node --env-file=.env dist/src/server.js
```

首次安装时，临时设置 `BOOTSTRAP_ADMIN_USERNAME` 和自行生成的 `BOOTSTRAP_ADMIN_PASSWORD`，运行 `dist/src/bootstrap.js` 创建管理员；完成后删除这两个初始化变量。

`.env` 不会自动加载，上述命令通过 Node 显式读取。开发模板默认关闭 worker；准备好模型和隔离环境后，再设置 `WORKER_ENABLED=true` 执行后台任务。

## 配置与部署

| 配置 | 用途 |
| --- | --- |
| `DATABASE_URL` | 专用 PostgreSQL 数据库连接。 |
| `ENCRYPTION_KEY` | 32 字节随机数据的 base64 编码，用于保护保存的集成密钥。 |
| `PUBLIC_ORIGIN` | 浏览器实际访问源，生产环境使用 HTTPS。 |
| `ALLOWED_ORIGINS` | 允许的前端和内部代理来源。 |
| `TRUSTED_PROXY_CIDRS` | 明确受信的代理 IP/CIDR。 |
| `MEDIA_ROOT` | 持久化媒体目录，数据库备份不包含媒体文件。 |
| `WORKER_ENABLED` | 后台任务和维护开关。 |

生产可以在 `backend/` 使用 Dockerfile：

```sh
docker build -t oaooao-backend:local .
```

发布时固定源码提交与镜像摘要；环境文件和媒体通过运行时注入或挂载，数据库迁移作为独立命令执行。`/health` 检查进程，`/ready` 检查数据库和迁移状态。

## 验证

```sh
npm run typecheck
npm run build
npm test
```

集成测试前设置 `TEST_DATABASE_URL`，指向可创建和删除临时 schema 的专用数据库。测试使用合成账号、临时 schema 和临时媒体目录，不连接真实客户数据。

## 当前配置边界

当前支持已实现的 OpenAI 兼容适配器、人工收款和易支付（MD5 / RSA）结算。退款需先预留积分，再通过原收款渠道办理和核实，最后显式确认；未配置收款方式时不要开放真实购买。

微信公众号扫码登录与已有账户绑定需要公众号参数二维码权限、安全模式回调和真实联调。开启邮箱验证注册时，微信登录不会跳过邮箱验证。

MFA、支付宝/微信支付/Stripe 直接协议、自动邀请风控、任意可执行技能、视觉聊天、创作对象存储写入和剪映官方格式导出尚未实现。S3 配置检测只验证连接检查，不能代替实际写入验收。

发现安全问题请联系 **siyuesy@gmail.com**，请不要在公开 Issue 中粘贴密钥、用户数据或数据库备份。
