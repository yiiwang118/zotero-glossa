# Changelog

Versions follow the tags of this repository (`0.2.0`, without a `v`). Each section is also the body of its GitHub release.

## 0.2.0

First public release of Glossa for Zotero, a research assistant that lives in the Zotero item pane, the PDF reader and its own window.

**Highlights**

- Chat with one or more papers using their metadata, abstract, annotations, the current PDF selection and (optionally) the first 40 pages of full text. Answers stream, cite their sources as clickable `[S1]` links and can be saved as Zotero child notes.
- Formulas render properly: models are asked to write LaTeX, which is shown as MathML (via Temml) and saved in Zotero's native note math format.
- Quick translation and “Ask” buttons in the PDF selection popup; selections also appear above the chat input and disappear when you deselect.
- Model services: OpenAI-compatible and Anthropic APIs with presets (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Moonshot, Qwen, Zhipu, SiliconFlow, xAI, Ollama, LM Studio), or your signed-in local Codex, Claude Code and Grok CLIs. Visible reasoning for models that stream it.
- Local CLIs follow Zotero's network proxy (the system proxy by default), stream their answers, refresh their model lists automatically and report specific, credential-free errors.
- Chinese and English interface, following Zotero's language or chosen in Settings.
- History with search, folders, Markdown export and JSON backup; several chats can run in the background.

**Compatibility:** Zotero 10.0.6 and later 10.x releases. Tested on macOS; Windows and Linux are expected to work but have not been tested yet — reports are welcome.

**Upgrading from a local test build (0.1.x):** those builds pointed at a different update address, so install 0.2.0 once by hand. If you used 0.1.0, remove it first and restart Zotero before installing. Chats and settings are kept.

---

首个公开版本。主要功能：与一篇或多篇文献对话（元数据、摘要、批注、PDF 选区，可选附带前 40 页正文），流式回答并以可点击的 `[S1]` 标注来源，可保存为 Zotero 子笔记；公式以 LaTeX 书写并渲染为 MathML，保存为 Zotero 原生笔记公式；PDF 选区浮层中的快速翻译与提问；支持 OpenAI 兼容 / Anthropic API 与本机 Codex、Claude Code、Grok CLI（跟随 Zotero / 系统代理、流式输出、自动刷新模型列表）；中英文界面；历史搜索、目录、导出与备份。兼容 Zotero 10.0.6 及以后的 10.x，已在 macOS 上验证，Windows / Linux 尚未测试。从本地测试版（0.1.x）升级时请手动安装一次 0.2.0；若是 0.1.0，请先移除并重启 Zotero。
