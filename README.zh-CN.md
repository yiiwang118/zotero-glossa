# Glossa for Zotero

[English](README.md) · **简体中文**

Zotero 里的文献助手：与文献对话、翻译 PDF 选区、把回答整理成 Zotero 笔记。来源可以点击回溯，公式正常渲染。

Glossa 使用你自己的模型服务：OpenAI 兼容或 Anthropic 的 API Key、本机模型（Ollama、LM Studio），或你已登录的 Codex、Claude Code、Grok 命令行工具。

| 首页与 PDF 选区 | 思考中 | 思考过程与回答（深色） | 选区翻译 |
| --- | --- | --- | --- |
| ![首页](docs/home-light.png) | ![思考中](docs/sidebar-light.png) | ![回答](docs/sidebar-dark.png) | ![选区翻译](docs/translation.png) |

截图来自 Zotero 10（独立测试配置，合成文献与本机模拟服务）。

## 安装

1. 从 [最新发布](https://github.com/yiiwang118/zotero-glossa/releases/latest) 下载 `glossa-zotero-x.y.z.xpi`。
2. 在 Zotero 中打开 **工具 → 插件**，把文件拖进窗口（或在齿轮菜单中选 **从文件安装插件…**）。
3. 选中一篇文献，点击条目面板右侧导航栏中的 Glossa 图标。

需要 **Zotero 10.0.6 及以后的 10.x 版本**。安装后会从本仓库的发布自动更新。已在 macOS 上验证；Windows 与 Linux 预期可用但尚未测试，遇到问题请 [提交 issue](https://github.com/yiiwang118/zotero-glossa/issues)。

**从本地测试版（0.1.x）升级**：测试版的更新地址指向另一个仓库，请手动安装一次 0.2.0，之后即可自动更新。0.1.0 在升级时存在竞态，若装的是 0.1.0，请先在插件管理器中移除它并重启 Zotero，再安装新版。对话历史与设置保存在数据目录的 `glossa-zotero/state.json`，移除插件不会删除它们。

## 使用

1. 点击输入框下方的模型名称 → **添加 API 服务**，选择预设或手动填写地址、粘贴 API Key，点 **获取模型列表** 选好模型后保存。使用本机 CLI 时，直接在同一菜单的“本机 CLI”中选择 Codex、Claude Code 或 Grok，无须 API Key。
2. 输入问题后回车发送，或使用命令 `/summarize`、`/translate`、`/explain`、`/compare`；输入 `@` 添加更多文献。
3. 在 PDF 中选中文字，可以翻译、提问，或让它随下一个问题一起发送。
4. 切换到 **Act** 后点 **保存为笔记**，把回答保存为该文献的子笔记。

## 功能

- **读取你正在读的内容**：条目元数据、摘要、批注、当前 PDF 选区；开启“全文”时附带 PDF 前 40 页（EPUB 与网页快照读取 Zotero 的全文索引）。每轮最多六篇文献，可对比阅读。
- **可核对的回答**：流式 Markdown（标题、多级列表、表格、引用、代码、分隔线），`[S1]` 引用可跳回文献、页码或批注，“N 个来源”展开查看发送的摘录。
- **公式**：要求模型用 LaTeX 书写（`$…$`、`$$…$$`、`\(…\)`、`\[…\]`），由 [Temml](https://temml.org) 渲染为 MathML，保存笔记时转为 Zotero 原生公式；“$5 和 $10”这类金额不会被误判，无法解析的公式保留源码并提示原因。
- **思考过程可见**：DeepSeek、Qwen、Kimi、OpenRouter、Anthropic、本地 `<think>` 模型与各 CLI 的思考内容显示在可折叠卡片中，状态胶囊实时显示“正在连接 / 服务排队中 / 思考中 / 正在回答”和用时。
- **快速翻译**：Zotero 选区浮层中的“翻译 / 提问”按钮；译文在小浮层中流式显示，可单独选用更快的翻译服务，可开启“划词后自动翻译”。
- **本机 CLI**：Codex（经 `codex app-server`）、Claude Code、Grok 流式回答，自动读取并定期刷新模型与推理强度列表；出错时显示具体原因（去掉密钥、邮箱与本机路径）并附可能的解决办法。
- **笔记**：保存标题、段落、列表、表格、公式与可点击的 `zotero://` 来源链接；只创建新的子笔记，不修改已有笔记。
- **历史**：按日期分组，可搜索、建目录、导出 Markdown、JSON 备份与合并导入；切换文献时已发送的对话在后台继续生成。
- **侧栏或独立窗口**：可在条目面板或独立窗口中使用，并在两者之间移动当前对话。
- **中英文界面**：默认跟随 Zotero 的语言，也可在设置中选择；回答语言默认跟随界面语言，也可指定其他语言。

## 数据、网络与边界

- 点击发送（或翻译、开启自动翻译）之前不会发送任何内容。提问时会把问题、最近六组完整问答，以及所选文献的元数据、摘要、摘录与批注交给所选服务，不会收集文献库中的其他文件；快速翻译只发送选中文字。模型列表只请求能力元数据。
- 普通回答最长 10 分钟；快速翻译每次最多 12,000 字符，3 分钟超时。每篇最多提取前 40 页 PDF、前 30 条批注，总上下文正文最多 60,000 字符。
- API Key 经 Zotero 的系统密钥存储加密后保存，加密失败不会降级为明文，也不随历史导出。对话与摘录以明文保存在 Zotero 数据目录的 `glossa-zotero/state.json`，写入为原子替换并保留 `.bak`；文件损坏时停止读写，不覆盖原文件。
- API 使用 Zotero 的网络配置。CLI 的代理依次取：设置中为该 CLI 填写的地址 → Zotero 启动环境中已有的代理变量 → Zotero 的网络代理设置（默认即系统代理）。从 Dock 启动的 Zotero 读不到终端配置文件中的 `https_proxy`；CLI 设置页会显示当前实际使用的代理。
- CLI 通过 Gecko `Subprocess` 调用，不经过 shell、以只读参数运行、使用独立的私有临时目录，不读取登录凭据文件、不安装软件。CLI 自己的账户与隐私策略由该 CLI 管理。
- 保存笔记使用 Zotero 原生接口，保存前再次检查目标是否存在且可编辑。来源是上下文出处，模型仍可能误引；笔记中是可点击链接，不是结构化引文。
- 对话不随 Zotero 同步（保存的笔记按你的 Zotero 同步设置同步）。插件对 Zotero 和电脑有完整访问权限，请只从本仓库的发布安装。
- 暂不支持 OCR 与图表视觉分析。

## 开发

需要 Node.js 22+、npm 和 Python 3。

```sh
npm ci
npm run check            # 发布元数据、TypeScript、ESLint、自动测试、构建与安装包校验
npm run test:browser     # 可选的界面测试，需要 Playwright（见 TESTING.md）
```

构建产物为 `dist/glossa-zotero-<版本>.xpi`、SHA-256 校验文件和 `dist/updates.json`。唯一的运行时依赖是 Temml（MIT），连同许可证一起打包进 XPI。

### 发布

1. 修改 `package.json`、`addon/manifest.json` 与 `src/core/cli.ts` 中 `CLIENT_INFO` 的版本号，并在 [CHANGELOG.md](CHANGELOG.md) 中添加对应章节。
2. 运行 `npm run release:check -- <版本>` 后提交。
3. `git tag <版本> && git push origin main <版本>`（标签不带 `v`）。

发布工作流会运行全部检查，并把 XPI、校验文件和 `updates.json` 发布到 GitHub Release。插件的 `update_url` 读取最新发布中的 `updates.json`，已安装的副本会自动更新。若只需支持更新的 Zotero 版本而无代码改动，提高 `strict_max_version` 后发布即可。

## 许可证

[MIT](LICENSE)。包含 [Temml](https://github.com/ronkok/Temml)（MIT，许可证见 XPI 中的 `THIRD-PARTY-temml-LICENSE.txt`）。详细验证记录见 [TESTING.md](TESTING.md)。
