<div align="center">

![OAOOAO — Open Creative Workspace](https://raw.githubusercontent.com/buyue666/OAOOAO/main/docs/assets/repository-banner.svg)

# OAOOAO Backend

**连接创作、数据与任务的独立后端。**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-168c82?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-43853d?style=flat-square&logo=nodedotjs)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5-171717?style=flat-square&logo=fastify)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-persistence-4169e1?style=flat-square&logo=postgresql)](https://www.postgresql.org/)

[前端与项目说明](../README.md) · [运行配置](docs/GETTING-STARTED.md) · [部署与回滚](docs/DEPLOYMENT.md) · [API 覆盖范围](docs/CLIENT-API-COVERAGE.md)

</div>

---

## 能力

| 模块 | 实现 |
| --- | --- |
| 账户与权限 | 用户名与邮箱登录、微信公众号扫码登录与账户绑定、不透明会话、密码校验、管理员职责与操作审计。 |
| 积分钱包 | 永久、每日及限时积分；事务扣费、幂等记账、退款分配和到期处理。 |
| 每日签到 | 按普通身份或有效套餐选择赠送数量和有效期，保留领取快照，防止重复领取。 |
| 商业配置 | 套餐、积分包、易支付签名通知与幂等到账、人工收款和外部退款登记、生成能力权限及购买政策。 |
| 创作任务 | 持久化图片、视频、文本和音频任务；有界 Agent 执行计划、恢复与取消。 |
| 项目与媒体 | 画布、分镜项目、素材及生成记录持久化；本地媒体和 FFmpeg 导出。 |
| 内容与品牌 | 公告横幅、弹窗、展示时间、品牌设置、页脚与公开政策。 |

使用 Node.js、TypeScript、Fastify 与 PostgreSQL；任务队列和业务状态落在数据库中，**不依赖 Redis**。前端通过同源代理访问，后端持有渠道凭据。

## 快速开始

准备 Node.js 22+、npm 和一个**空的开发 PostgreSQL 数据库**。媒体导出还需要 FFmpeg、FFprobe 与 CJK 字体。

```sh
git clone https://github.com/buyue666/OAOOAO.git
cd OAOOAO/backend
npm ci
```

将 `.env.example` 复制为 `.env`，设置 `DATABASE_URL` 与独立的 `ENCRYPTION_KEY`。生成加密密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

本地默认前端访问源为 `http://localhost:3000`；使用 OAOOAO 前端代理时，在 `ALLOWED_ORIGINS` 中加入精确的后端目标地址，例如 `http://127.0.0.1:3001`。

```sh
npm run typecheck
npm run build
node --env-file=.env dist/src/migrate.js
```

首次安装时，临时注入 `BOOTSTRAP_ADMIN_USERNAME` 和你自行生成的 `BOOTSTRAP_ADMIN_PASSWORD`，再运行：

```sh
node --env-file=.env dist/src/bootstrap.js
```

完成后移除初始化变量，启动服务：

```sh
node --env-file=.env dist/src/server.js
```

`.env` 不会自动加载；上述命令通过 Node 显式读取。开发模板默认关闭 worker；准备好模型与隔离验收后，再设置 `WORKER_ENABLED=true` 执行后台任务。已有数据迁移应使用专门的迁移流程，不要先初始化管理员或重复导入。

## 配置与部署

| 配置 | 用途 |
| --- | --- |
| `DATABASE_URL` | 专用 PostgreSQL 数据库连接。 |
| `ENCRYPTION_KEY` | 32 字节随机数据的 base64 编码；保护已保存的集成密钥，备份时必须保留。 |
| `PUBLIC_ORIGIN` | 浏览器实际访问源；生产必须使用 HTTPS。 |
| `ALLOWED_ORIGINS` | 额外受信源，包括前端同源代理使用的精确后端地址。 |
| `TRUSTED_PROXY_CIDRS` | 明确受信的代理 IP/CIDR；默认不信任转发来源。 |
| `MEDIA_ROOT` | 持久化媒体目录；数据库备份不包含媒体文件。 |
| `WORKER_ENABLED` | 后台任务与维护开关；迁移和候选验证期间关闭。 |

前端位于同一仓库根目录，后端位于 `backend/`，两者保留各自的依赖与运行进程。生产可以在 `backend/` 目录使用 Dockerfile：

```sh
docker build -t oaooao-backend:local .
```

发布时固定并记录基础镜像摘要、源码提交与镜像摘要。环境文件和媒体通过运行时注入或挂载，不能写入镜像；数据库迁移作为独立命令执行。完整步骤见[运行配置](docs/GETTING-STARTED.md)和[部署与回滚](docs/DEPLOYMENT.md)。

`/health` 检查进程，`/ready` 检查数据库与完整迁移校验和。健康状态不代表外部模型、收款或邮件已经验收。

## 验证

```sh
npm run typecheck
npm run build
npm test
```

运行集成测试前注入 **`TEST_DATABASE_URL`**，指向可创建并删除临时 schema 的专用测试数据库。测试使用合成账号、临时 schema 和临时媒体目录，不连接真实客户数据。渲染测试需要 FFmpeg/FFprobe；模型、邮件与支付替身测试不能证明真实供应商服务可用。

## 当前边界

当前支持已实现的 OpenAI 兼容适配器、人工收款及易支付（MD5 / RSA）结算。退款需先预留积分，再通过原收款渠道办理和核实，最后显式确认；后台退款记录不会自动转移资金。未配置可用收款方式时，不应开放真实购买。

微信公众号扫码登录与现有账户绑定已实现，需要具备参数二维码接口权限的公众号，使用安全模式回调并完成真实联调。开启邮箱验证注册时，微信只登录已绑定账户，不绕过邮箱验证。扫码取消关注不会删除账户绑定。

MFA、支付宝/微信支付/Stripe 直接协议、自动邀请风控、任意可执行 Agent 技能、视觉聊天、其他生成协议、创作对象存储写入及剪映官方格式导出尚未实现。S3 配置检测只验证 `HeadBucket`，不能作为写入已成功的证明。易支付可聚合支付宝或微信收款，但不等同于接入它们的直接支付协议。

## 来源与许可

应用采用 **GNU AGPL v3.0**（`AGPL-3.0-only`），详见 [LICENSE](LICENSE)。允许按许可证使用、修改与分发；修改版本通过网络服务用户时，应按第 13 条提供对应源码。前后端部署版本都应可以从站点开源入口找到。

本后端根据功能规格、OAOOAO 前端 HTTP 契约与官方依赖文档独立实现。各模块文档中的“未读取上游实现”说明只适用于文档明确记录的原实施者及其对应贡献；后续协调者曾接触上游并参与修正，不能将原实施者的经历扩大为全项目声明。本项目不宣称正式净室认证，也不作零侵权保证。参见[基础模块来源](docs/CORE-PROVENANCE.md)、[创作模块来源](CREATIVE_PROVENANCE.md)、[商业与内容来源](docs/COMMERCE-CONTENT-PROVENANCE.md)、[易支付来源](docs/EPAY-PROVENANCE.md)、[微信来源](docs/WECHAT-PROVENANCE.md)及[许可审查记录](docs/LICENSING_REVIEW.md)。

保留[第三方依赖声明](THIRD_PARTY_DEPENDENCY_NOTICES.txt)与容器内系统包版权文件。Debian FFmpeg 包含 GPL 组件；公开应用源码不自动完成所有二进制或容器再分发义务。模型、商标、用户素材及其他第三方内容的权利需分别核实。

发现安全问题请联系 **siyuesy@gmail.com**，不要在公开 Issue 中粘贴密钥、用户数据或数据库备份。
