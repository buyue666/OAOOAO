<div align="center">

![OAOOAO — Open Creative Workspace](docs/assets/repository-banner.svg)

**把想法变成画面、镜头与故事。**

一个连接 AI 生成、自由画布、创作项目与运营管理的开源工作台。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-168c82?style=flat-square)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-171717?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-087ea4?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

[访问 OAOOAO](https://oao.lunapi.xyz) · [独立后端](https://github.com/buyue666/OAOOAO-backend) · [部署指南](DEPLOYMENT.md) · [反馈问题](https://github.com/buyue666/OAOOAO/issues)

</div>

---

## 从灵感到作品

不必在一组互不相通的生成工具之间搬运素材。OAOOAO 将描述、参考、生成结果与镜头组织在同一套创作流程里：先探索一张图，再把它接入画布，或发展成一个持续迭代的项目。

| 创作空间 | 可以做什么 |
| --- | --- |
| **图片与视频** | 输入描述、上传参考、选择已配置模型，查看费用、任务进度与生成记录，再复用结果。 |
| **自由画布** | 连接素材与生成节点，使用小地图、整理布局、编组、撤销重做与版本化保存；将节点交给创作助手。 |
| **镜头项目** | 管理创作提纲、分集、主体参考与镜头候选，采用满意版本，组织视频与交付文件。 |
| **创作助手** | 携带当前项目或画布上下文规划步骤，确认费用后执行，跟踪任务并将结果写回创作空间。 |
| **技能与资产** | 保存可复用的提示词指令，选择技能参与生成，管理图片、视频、音频及历史素材。 |
| **账户与运营** | 套餐、独立积分超市、签到规则、积分流水、订单、公告横幅和弹窗、品牌与页脚配置。 |

### 让规则和使用体验保持一致

- **按身份签到**：普通用户与有效套餐可以分别设置赠送数量、永久或限时有效期；领取结果记录当时规则，之后调整配置不追溯修改已领积分。
- **看得懂的积分**：区分永久、每日与限时积分，展示有效期和流水；生成扣费、退款与到期处理由后端事务执行。
- **可配置的品牌**：前台与管理后台共享站点品牌，公告支持颜色、动效、跳转和预览；页脚固定提供开源入口。
- **导出偏好**：用户可以在了解说明后设置 AI 显式水印偏好；实际导出仍取决于媒体类型与服务端支持。

> 当前技能是可复用的文本指令，不是任意代码插件。生成能力取决于已实现的模型适配器与实际渠道配置；没有可用模型时，界面会明确提示。

## 前后端

| 仓库 | 职责 | 技术 |
| --- | --- | --- |
| [OAOOAO](https://github.com/buyue666/OAOOAO) | 创作界面、管理后台、同源 API 代理 | Next.js · React · TypeScript · React Flow |
| [OAOOAO-backend](https://github.com/buyue666/OAOOAO-backend) | 账户、钱包、订单、任务、素材与项目持久化 | Node.js · Fastify · PostgreSQL · FFmpeg |

```text
浏览器 ──→ OAOOAO / Next.js ──→ 独立后端 / Fastify
                  同源 API              ├─ PostgreSQL：账户、积分、任务、项目
                                        ├─ 持久化媒体目录
                                        └─ 配置好的模型与邮件服务
```

本仓库是前端；完整使用需要同时运行后端。渠道密钥由后端保存和使用，不放入浏览器环境变量。

## 本地运行

需要 **Node.js 22+** 和 **pnpm 12.3.4**。先按[后端快速开始](https://github.com/buyue666/OAOOAO-backend#快速开始)准备 PostgreSQL、迁移数据库并启动后端。

```sh
git clone https://github.com/buyue666/OAOOAO.git
cd OAOOAO
pnpm install --frozen-lockfile
```

将 `.env.example` 复制为 `.env.local`，填入本地地址：

```dotenv
OAOAO_BACKEND_URL=http://127.0.0.1:3001
OAOAO_PUBLIC_URL=http://localhost:3000
```

```sh
pnpm dev
```

打开 `http://localhost:3000`。后端的 `PUBLIC_ORIGIN` 应匹配浏览器访问源；`ALLOWED_ORIGINS` 还应包含前端代理使用的精确后端地址。生产环境的 HTTPS、Cookie、代理信任和环境变量说明见[部署指南](DEPLOYMENT.md)。

## 管理与配置

首次管理员通过后端显式初始化命令创建，仓库不附带默认管理员密码。

| 配置入口 | 内容 |
| --- | --- |
| 系统设置 → 站点与品牌 | 品牌图标、名称、页脚、独立服务条款与隐私政策。 |
| 系统设置 → 注册与积分 | 注册策略、签到开关、普通用户及各套餐的签到积分和有效期。 |
| 系统设置 → 运营与支付 | 运营模式、购买政策及当前支持的人工收款配置。 |
| 商品与套餐 | 套餐权益、展示颜色、价格与单独出售的积分包。 |
| 模型与渠道 | 实际模型、渠道绑定、计费与可用能力。 |
| 内容与公告 | 顶部横幅、文字或图片弹窗、跳转链接、展示时段及预览。 |

**配置商品不等于启用收款。** 当前独立后端支持人工收款与人工退款记录，需要管理员核实外部到账；支付宝、微信支付、Stripe 自动支付尚未实现。微信登录、MFA、创作对象存储写入、任意可执行技能和剪映官方格式导出也不属于当前已实现能力。

## 开发与验证

```sh
pnpm exec tsc --noEmit --pretty false
pnpm test:acceptance
pnpm build
```

验收测试覆盖主要状态、权限、交互与接口契约；后端另有使用临时 PostgreSQL schema 的集成测试。真实模型消费、邮件投递与实际收退款需要在已配置的隔离环境单独验收。请不要把测试脚本指向生产数据库或真实客户账号。

```text
app/                   页面路由与同源 API 代理
components/studio/     创作工作台与管理界面
components/oao-canvas/ 画布编辑器
lib/studio/            数据契约、客户端状态与业务工具
public/media/brand/    OAOOAO 品牌资源
tests/                 回归与验收测试
docs/                  设计记录与验收范围
```

欢迎提交问题与改进。提交时说明复现步骤、预期结果和验证方式；请移除密钥、会话、数据库导出和用户素材。安全问题请发送至 **siyuesy@gmail.com**，不要在公开 Issue 中附带凭据。

## 开源许可

OAOOAO 前端与独立后端采用 **GNU Affero General Public License v3.0**（`AGPL-3.0-only`）。完整条文见 [LICENSE](LICENSE)。

可以按许可证使用、修改和分发，包括商业用途；对修改版本提供网络服务时，应按 AGPL 第 13 条向交互用户提供该版本的对应源码。保留许可证、版权与第三方声明；部署时应让页脚的源码入口能找到实际运行版本及其前后端源码。

第三方材料仍适用各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。仓库许可不授予第三方商标、用户素材或外部模型服务的使用权。独立后端的实现来源与历史审查边界记录在其文档中。

<div align="center">

**OAOOAO · 为下一次灵感，留一片自由的空间。**

</div>
