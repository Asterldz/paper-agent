# Paper Agent

**简体中文** · [English](README.en.md)

一个以本地文献为中心的 AI 论文阅读助手：边读边译，追踪参考文献，把阅读结果整理成可回溯的知识笔记。

基于 **TypeScript、React、LangGraph、LangChain、PDF.js 和 Electron**。支持独立桌面窗口，也支持浏览器本地运行；使用者自行配置模型服务。

> 持续开发中。macOS arm64 已完成本地打包与启动检查；Windows、Linux 安装包尚未实机验证。项目不附带模型、API Key 或免费模型额度。

## 核心功能

- **阅读与翻译**：PDF 浏览、划选翻译、解释、总结、术语延伸，独立缩放和可调分栏。
- **文献助手**：可拖动的动画猫与可调整大小的对话窗口，支持当前论文及多文献问答。
- **参考文献追踪**：查找本地参考论文，按需调用外部检索、原文读取工具，区分全文、摘要、题录并展示来源位置。
- **文献管理**：本地文献库、用户文件夹、阅读历史及恢复阅读；属于应用内整理，不是任意移动系统文件。
- **阅读知识库**：论文、概念、对比笔记草稿，经用户审核保存；支持检索、来源核对、版本记录和 Markdown 导出。
- **受控偏好适配**：阅读 Skill 执行核心任务，进化 Skill 根据反馈提出策略调整，支持审核、版本检查和回滚。
- **缓存与转换**：翻译/解释缓存、术语记忆；提取 PDF 文字并导出 TXT 或 Markdown。

## Agent 如何工作

划选翻译使用独立的快速流式通道；复杂问题才进入文献助手的工具调用流程。

```text
用户提问
   ↓
LangGraph 规划 ←─────────────────┐
   ↓                            │
选择工具 → 校验参数 → 执行工具 ────┘ 按需继续检索
   ↓
基于证据生成回答 → 检查引用来源位置 → 展示回答与执行记录
```

LangGraph 管理流程和停止条件，LangChain 适配模型工具调用，Zod 校验工具参数。工具覆盖当前论文、文献库、参考文献、外部文献及知识笔记。规划轮数、工具次数和总运行时间均有限制，避免无限循环。

**当前 RAG 使用关键词/词频检索，不是向量数据库检索。** 引用检查核对证据身份与位置，不能保证每一句回答正确；重要结论仍需对照原文。

两个 Skill 调整的是受限阅读策略，不训练模型权重，也不会自行修改项目源码。明确的表达偏好可按用户设置自动采用；其他调整通过候选审核处理。

## 快速开始

需要 **Node.js 22.13 或更新版本及 npm**。下载并解压本仓库，或克隆后进入包含 `package.json` 的项目目录。首次安装依赖需要联网。

### Electron 桌面窗口

```bash
npm ci
npm run desktop:dev
```

这是源码开发启动方式，会打开独立应用窗口，不需要外部浏览器。开发启动仍需要 Node.js 和项目源码。

制作包含本地服务的应用包：

```bash
npm run desktop:pack  # 本机测试用应用目录
npm run desktop:dist  # 当前平台分发包
```

产物位于 `release/`。打包后的应用包含运行环境，最终用户无需另装 Node.js；在线模型与外部文献检索仍需网络。macOS 公共分发的开发者签名、公证及其他平台兼容性仍需验证。

### 浏览器本地运行

不使用 Electron 时，可以跳过它的二进制下载。

macOS / Linux：

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run local:build
npm run local:start
```

Windows PowerShell：

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
npm ci
npm run local:build
npm run local:start
```

自动打开 [本地阅读器](http://127.0.0.1:43187)。保留终端，按 `Ctrl+C` 停止；关闭网页不会停止服务。不要同时启动占用同一端口的桌面版和浏览器本地服务。

也可使用 `启动本地阅读器.command`（macOS）或 `启动本地阅读器.cmd`（Windows）。它们是需要 Node.js 的源码启动脚本，不是安装包；Windows 入口尚未实机验证。

更新源码后重新安装依赖、运行 `npm run local:build`，停止旧服务再启动。启动脚本不会自动下载项目更新。如果之前跳过 Electron 下载，转用桌面版前需取消该环境变量并执行 `node node_modules/electron/install.js`。

### 配置模型与开始阅读

1. 在设置中填写自己的模型 API 地址、模型名称和 API Key。
2. 测试连接并选择模型；文献助手需要兼容 OpenAI 格式且支持 **Tool Calling** 的模型。连接成功不代表工具调用一定兼容。
3. 导入带文字层的 PDF，划选文字翻译，点击猫打开文献助手。
4. 可以问：“这篇论文的方法与局限是什么？请给来源。”或“请核对参考文献中这个方法的原始描述。”
5. 要整理知识，要求助手生成知识页草稿，在知识库中核对来源后审核保存。

思考参数、输出长度和跨域策略因服务商而异，不兼容配置可能导致请求失败。项目不会自动获得付费接口权限。

## 数据、隐私与费用

- 文献、笔记、历史及缓存主要保存在当前设备的 IndexedDB；设置和模型凭据保存在本地浏览器/Electron 配置数据中。**API Key 不是系统钥匙串加密存储。** 不要在共享设备保存长期密钥。
- 本地优先不等于完全离线：相关论文片段与问题会发送到你配置的模型服务；外部检索会发送必要关键词或文献标识。
- 模型费用由自己的账户承担。缓存可减少部分重复请求，但不保证固定费用或延迟降幅。
- 不同浏览器、Electron 配置和网址拥有独立数据，当前没有自动跨设备同步或完整数据库迁移。
- 清除站点数据可能丢失文献和记录。保留原始 PDF、及时导出重要笔记；不要提交密钥、私人论文或数据库导出文件。

## 当前边界

- PDF 依赖文字层，没有通用 OCR 流程。复杂双栏、公式、页眉和跨页选择仍可能需要人工核对；TXT/Markdown 导出不保证还原版式。
- 外部检索使用 Crossref、Europe PMC；全文读取支持适用的 Europe PMC 开放文章及按编号定位的 arXiv PDF。不绕过付费墙，也不是任意网站爬虫。
- 尚未实现向量检索、无人值守持续进化、后台自主调度或模型训练。
- 自动化测试主要验证模拟模型下的软件机制，不代表真实问答准确率、实际模型兼容性或性能基准。
- 构建仍包含原 Sites/Cloudflare 集成，尚未完全解耦；不要直接删除配置或复用原托管身份发布。

## 开发与测试

```bash
npm run dev          # 浏览器开发服务；地址见终端输出
npm run typecheck
npm run lint
npm run test:agent
npm run test:desktop
npm run test:pet
npm run desktop:build
```

| 目录 | 用途 |
| --- | --- |
| `components/`、`hooks/` | 阅读器、助手、知识库界面和交互 |
| `services/agent/` | LangGraph 流程、工具、检索、Skill 策略 |
| `services/llm/` | 模型调用、流式响应、错误处理 |
| `services/pdf/`、`services/storage/` | PDF 解析、本地持久化 |
| `agent-skills/` | 阅读及反馈进化指令资源 |
| `desktop/`、`scripts/` | Electron 包装、构建、本地启动 |
| `tests/` | Agent、桌面运行时、动画测试 |

更多说明：[Agent 架构](docs/agent-project.md) · [Skill 演进设计](docs/agent-evolution-design.md) · [知识库原理](docs/llm-wiki.md) · [桌面版](docs/desktop-app.md) · [动画](docs/pet-sprite-animation.md) · [开源检查](docs/open-source-readiness.md)。部分设计文档含历史记录，以当前代码及实现边界为准。

## 参与和许可

欢迎提交可复现问题与改进。请提供平台、启动方式、复现步骤及脱敏日志；PDF 选择问题优先提供可公开分享的样例。提交前运行相关测试，不要包含 `node_modules/`、`dist/` 或 `release/`。

安全问题参阅 [SECURITY.md](SECURITY.md)，不要在公开问题中贴密钥或私人文献。

项目代码、文档及项目自有猫角色和动画素材采用 [Paper Agent 非商业许可](LICENSE)：允许个人学习、教学及非商业研究等非商业用途的使用、修改和再分发，须保留版权与许可声明、标明修改，并保留非商业限制。**商业使用须事先取得相应版权所有者的书面授权**，包括收费产品、广告支持服务和营利企业的业务运营。第三方依赖仍遵循各自许可证。

这是源码公开（source-available）项目，不是 MIT 或 OSI 定义的开源许可。猫素材由项目作者提供并确认拥有；完整适用范围与条款见 LICENSE。
