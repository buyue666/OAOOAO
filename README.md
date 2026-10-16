<div align="center">

![OAOOAO — Open Creative Workspace](docs/assets/repository-banner.svg)

**把想法变成画面、镜头与故事。**

一个连接 AI 生成、自由画布、创作项目与运营管理的开源创作工作台。

[![Next.js](https://img.shields.io/badge/Next.js-16-171717?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-087ea4?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

[访问 OAOOAO](https://oao.lunapi.xyz) · [后端说明](backend/README.md) · [部署指南](DEPLOYMENT.md) · [提交问题](https://github.com/buyue666/OAOOAO/issues)

</div>

---

## 产品能力

OAOOAO 把灵感、参考素材、生成任务、画布和项目交付放在同一个工作区。创作者可以从一段描述开始，逐步整理素材、调整结果并继续扩展为镜头和故事。

| 模块 | 能力 |
| --- | --- |
| **图片、视频与音频** | 输入描述、上传参考、选择已配置模型，查看任务进度、费用和生成记录。 |
| **自由画布** | 连接素材与生成节点，使用小地图、整理布局、编组、撤销重做和版本保存。 |
| **图片编辑** | 对生成结果进行画笔标注、涂抹、擦除、扩图、高清、分图层和转视频等后续处理。 |
| **3D 导演台** | 在画布中添加角色与机位，切换画幅、网格和姿态，导出预演截图。 |
| **镜头项目** | 管理创作提纲、分集、主体参考、镜头候选和交付文件。 |
| **创作助手** | 携带项目或画布上下文规划步骤，确认费用后执行并把结果写回工作区。 |
| **技能与资产** | 保存可复用的提示词指令，管理图片、视频、音频和历史素材。 |
| **账户与运营** | 套餐、积分超市、签到、积分流水、订单、公告、弹窗、品牌和页脚配置。 |

## 技术结构

```text
浏览器 ──→ OAOOAO / Next.js ──→ 独立后端 / Fastify
                  同源 API              ├─ PostgreSQL：账户、积分、任务、项目
                                        ├─ 持久化媒体目录
                                        └─ 已配置的模型、支付与邮件服务
```

| 目录 | 职责 | 技术 |
| --- | --- | --- |
| 根目录 | 创作界面、管理后台和同源 API 代理 | Next.js · React · TypeScript · React Flow |
| [backend/](backend/README.md) | 账户、钱包、订单、任务、素材与项目持久化 | Node.js · Fastify · PostgreSQL · FFmpeg |

前端和后端位于同一个仓库，使用同一个提交版本发布。根目录使用 pnpm，`backend/` 使用 npm；渠道密钥只在后端保存和使用。

## 本地运行

需要 **Node.js 22+**、**pnpm 12.3.4**、npm 和 PostgreSQL。媒体导出还需要 FFmpeg 与 FFprobe。

```sh
git clone https://github.com/buyue666/OAOOAO.git
cd OAOOAO
pnpm install --frozen-lockfile
```

在 `backend/` 中安装依赖并按[后端快速开始](backend/README.md#快速开始)准备数据库：

```sh
cd backend
npm ci
# 复制 .env.example 为 .env，填写数据库和运行配置
npm run typecheck
npm run build
node --env-file=.env dist/src/migrate.js
node --env-file=.env dist/src/server.js
```

另开终端回到仓库根目录，创建 `.env.local`：

```dotenv
OAOAO_BACKEND_URL=http://127.0.0.1:3001
OAOAO_PUBLIC_URL=http://localhost:3000
```

启动前端：

```sh
pnpm dev
```

打开 `http://localhost:3000`。生产环境的 HTTPS、Cookie、代理信任和环境变量配置见[部署指南](DEPLOYMENT.md)。

## 管理后台

首次管理员通过后端初始化命令创建，仓库不提供默认密码。登录后台后可以配置：

- **站点与品牌**：名称、图标、页脚、服务条款和隐私政策。
- **注册与积分**：注册策略、签到开关，以及普通用户和不同套餐的签到积分与有效期。
- **运营与支付**：运营模式、购买政策、人工收款和易支付设置。
- **微信登录**：公众号扫码登录、回调地址和注册策略。
- **计费与权益**：套餐、积分包、价格、展示颜色、每日额度和可用创作能力。
- **模型与渠道**：模型、渠道、计费和能力绑定。
- **内容与公告**：横幅、文字或图片弹窗、跳转链接、展示时间和预览。

商品配置与支付启用分开管理。易支付支持 V1 MD5 和 V2 RSA；正式启用前请完成网关配置、签名回调和退款流程验证。微信公众号扫码登录需要公众号接口权限及有效回调配置。

## 开发与验证

```sh
pnpm exec tsc --noEmit --pretty false
pnpm test:acceptance
pnpm build
```

后端验证在 `backend/` 中运行：

```sh
npm run typecheck
npm run build
npm test
```

集成测试使用专用测试数据库、合成账号和临时媒体目录。不要把测试指向生产数据库，也不要提交密钥、会话、数据库导出或用户素材。

## 项目结构

```text
app/                   页面路由与同源 API 代理
components/studio/     创作工作台、画布编辑器和管理界面
components/membership/ 套餐展示与购买流程
lib/studio/            数据契约、客户端状态和业务工具
public/media/brand/    OAOOAO 品牌资源
tests/                 回归与验收测试
docs/                  运行、部署和依赖文档
backend/               Fastify 后端、SQL 迁移和后端文档
```

安全问题请联系 **siyuesy@gmail.com**，请不要在公开 Issue 中粘贴凭据、用户数据或数据库备份。

<div align="center">

**OAOOAO · 为下一次灵感，留一片自由的空间。**

</div>
