import { L } from '../core/i18n';
import type { Endpoint } from '../core/types';
import { CLI_TOOLS, errorMessage, isCli, uid } from '../core/types';
import { DEFAULT_MAX_TOKENS, discoverModels, effortLabel, effortOptions, validateEndpoint } from '../core/provider';
import { validateCli } from '../core/cli';
import { abortable } from '../core/abort';
import { button, el, field, input, labelButton, segmented, select, status, toggle } from './dom';
import { icon } from './icons';
import type { SheetHost } from './sheet';

export interface SettingsHost extends SheetHost {
  /** Moves the current conversation to the other surface (sidebar ⇄ window). */
  move?: { label: string; run(): void };
  /** Applies a new interface language by rebuilding every open Glossa panel. */
  relocalize?(): void;
}
export const LANGUAGES = ['简体中文', '繁體中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español'];
const preset = (id: string, name: () => string, apiStyle: Endpoint['apiStyle'], baseUrl: string) => ({ id, apiStyle, baseUrl, get name() { return name(); } });
/** Well-known endpoints; base URLs are the providers' documented OpenAI-compatible or Anthropic roots. */
export const PRESETS: { id: string; name: string; apiStyle: Endpoint['apiStyle']; baseUrl: string }[] = [
  { id: 'openai', name: 'OpenAI', apiStyle: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', apiStyle: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'gemini', name: 'Google Gemini', apiStyle: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'deepseek', name: 'DeepSeek', apiStyle: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', apiStyle: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'moonshot', name: 'Moonshot · Kimi', apiStyle: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
  preset('dashscope', () => L('阿里云百炼 · 通义', 'Alibaba Bailian · Qwen'), 'openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  preset('zhipu', () => L('智谱 GLM', 'Zhipu GLM'), 'openai', 'https://open.bigmodel.cn/api/paas/v4'),
  preset('siliconflow', () => L('硅基流动 SiliconFlow', 'SiliconFlow'), 'openai', 'https://api.siliconflow.cn/v1'),
  { id: 'xai', name: 'xAI', apiStyle: 'openai', baseUrl: 'https://api.x.ai/v1' },
  preset('ollama', () => L('Ollama（本机）', 'Ollama (local)'), 'openai', 'http://localhost:11434/v1'),
  preset('lmstudio', () => L('LM Studio（本机）', 'LM Studio (local)'), 'openai', 'http://localhost:1234/v1'),
];
const protocolName = (endpoint: Endpoint): string => endpoint.apiStyle === 'anthropic' ? 'Anthropic' : L('OpenAI 兼容', 'OpenAI-compatible');
export const cliGlyph = (endpoint: Endpoint): string => isCli(endpoint) ? endpoint.kind || 'terminal' : 'cloud';

/** Views: 'general', 'services', 'new' (a new API service) or an endpoint ID. */
export function showSettings(host: SettingsHost, view = 'general'): void {
  const settings = host.research.store.state.settings;
  if (view === 'general' || view === 'services') { (view === 'general' ? general : services)(host); return; }
  const saved = settings.endpoints.find(e => e.id === view);
  if (saved && isCli(saved)) cliEditor(host, saved); else apiEditor(host, saved);
}
function tabs(host: SettingsHost, area: HTMLElement, current: 'general' | 'services'): void {
  const control = segmented(host.doc, L('设置分类', 'Settings section'), [[L('常规', 'General'), 'general'], [L('模型服务', 'Model services'), 'services']], current, value => showSettings(host, value));
  control.className += ' glossa-tabs'; area.append(control);
}
function section(doc: Document, title: string, extra?: HTMLElement): HTMLElement {
  const node = el(doc, 'div', 'glossa-section-title'); node.append(el(doc, 'span', '', title));
  if (extra) node.append(extra);
  return node;
}

function general(host: SettingsHost): void {
  const { doc } = host; const settings = host.research.store.state.settings;
  const area = host.open(L('设置', 'Settings')); tabs(host, area, 'general');
  const placement = segmented(doc, L('对话打开位置', 'Open chats in'), [[L('右侧栏', 'Sidebar'), 'sidebar'], [L('独立窗口', 'Separate window'), 'window']], settings.openMode || 'sidebar', value => {
    settings.openMode = value === 'window' ? 'window' : 'sidebar'; host.persist();
  });
  area.append(section(doc, L('对话', 'Chat')), field(doc, L('对话打开位置', 'Open chats in'), placement, L('从工具菜单、条目右键菜单或选区“提问”打开时使用。', 'Used when opening from the Tools menu, the item context menu or “Ask” on a selection.')));
  if (host.move) area.append(labelButton(doc, host.move.label, settings.openMode === 'window' ? 'sidebar' : 'window', () => host.move?.run(), 'glossa-secondary'));
  const interfaceLanguage = select(doc, L('界面语言', 'Interface language'),
    [[L('跟随 Zotero', 'Follow Zotero'), 'auto'], ['简体中文', 'zh'], ['English', 'en']], settings.uiLanguage || 'auto', value => {
      settings.uiLanguage = value === 'zh' || value === 'en' ? value : 'auto'; host.persist(); host.relocalize?.();
    });
  area.append(field(doc, L('界面语言', 'Interface language'), interfaceLanguage, L('Zotero 菜单的文字跟随 Zotero 自身的语言。', 'Zotero menu labels follow Zotero’s own language.')));
  const known = !settings.language || LANGUAGES.includes(settings.language);
  const custom = input(doc, L('输入语言名称，如 Italiano', 'Language name, e.g. Italiano'), known ? '' : settings.language);
  custom.hidden = known;
  const saveLanguage = (value: string): void => { settings.language = value.trim().slice(0, 40); host.persist(); };
  custom.addEventListener('change', () => saveLanguage(custom.value));
  const language = select(doc, L('回答与翻译语言', 'Answer and translation language'),
    [[L('跟随界面语言', 'Same as interface'), ''], ...LANGUAGES.map(l => [l, l] as [string, string]), [L('其他…', 'Other…'), '*']],
    known ? settings.language : '*', value => {
      custom.hidden = value !== '*';
      if (value === '*') custom.focus(); else saveLanguage(value);
    });
  const languageRow = el(doc, 'div', 'glossa-inline'); languageRow.append(language, custom);
  area.append(field(doc, L('回答与翻译语言', 'Answer and translation language'), languageRow),
    toggle(doc, L('默认附带全文', 'Include full text by default'), settings.includeFulltext, checked => { settings.includeFulltext = checked; host.persist(); host.refresh(); },
      L('发送时附带 PDF / EPUB 正文（最多 40 页）。也可在输入框下方临时切换。', 'Send PDF / EPUB text with questions (up to 40 pages). You can also toggle it below the input.')));
  area.append(toggle(doc, L('选中文字时附到对话框', 'Show PDF selections in the chat'), settings.attachSelection !== false, checked => { settings.attachSelection = checked; host.persist(); },
    L('在 PDF 中选中文字后，侧栏和独立窗口的输入框上方会显示这段选区，提问时一并发送；不选择发送就不会提交。', 'Text you select in a PDF appears above the input in the sidebar and window and is sent with your next question; nothing is sent until you ask.')));
  area.append(section(doc, L('快速翻译', 'Quick translation')),
    toggle(doc, L('选中文字后自动翻译', 'Translate selections automatically'), settings.autoTranslate === true, checked => { settings.autoTranslate = checked; host.persist(); },
      L('在 PDF 中每次选中新文字都会调用翻译服务；关闭时点击“翻译”按钮才会发送。', 'Every new selection in a PDF calls the translation service; when off, nothing is sent until you press Translate.')),
    field(doc, L('快速翻译服务', 'Quick translation service'), select(doc, L('快速翻译服务', 'Quick translation service'), [[L('跟随当前对话服务', 'Same as the chat service'), ''],
      ...settings.endpoints.filter(e => !isCli(e) || e.cliModels?.length || e.model).map(e => [`${e.name} · ${e.model || L('默认模型', 'default model')}`, e.id] as [string, string])],
    settings.translationEndpointID || '', value => { settings.translationEndpointID = value; host.persist(); })));
  area.append(section(doc, L('数据与隐私', 'Data and privacy')), el(doc, 'p', 'glossa-muted',
    L('对话保存在 Zotero 数据目录的 glossa-zotero/state.json；API Key 经系统密钥存储加密后保存。发送时，所选文献的元数据、摘录、批注与问题会提交给当前模型服务；快速翻译只发送选中文字。', 'Chats are stored in glossa-zotero/state.json in the Zotero data directory; API keys are encrypted with the system keychain. When you send, the selected papers’ metadata, excerpts, annotations and your question go to the current model service; quick translation sends only the selected text.')));
}

function services(host: SettingsHost): void {
  const { doc } = host; const settings = host.research.store.state.settings;
  const area = host.open(L('设置', 'Settings')); tabs(host, area, 'services');
  const current = settings.endpoints.find(e => e.id === settings.endpointID);
  const row = (endpoint: Endpoint, detail: string): HTMLButtonElement => {
    const node = button(doc, '', () => showSettings(host, endpoint.id), 'glossa-list-row');
    node.setAttribute('aria-label', `${L('编辑', 'Edit')} ${endpoint.name}`);
    const text = el(doc, 'span', 'glossa-list-text'); text.append(el(doc, 'span', 'glossa-list-title', endpoint.name), el(doc, 'span', 'glossa-list-detail', detail));
    node.append(icon(doc, cliGlyph(endpoint)), text);
    if (endpoint === current) node.append(el(doc, 'span', 'glossa-badge', L('使用中', 'In use')));
    node.append(icon(doc, 'chevronRight'));
    return node;
  };
  area.append(section(doc, L('API 服务', 'API services'), labelButton(doc, L('添加', 'Add'), 'plus', () => showSettings(host, 'new'), 'glossa-ghost')));
  const apis = settings.endpoints.filter(e => !isCli(e));
  for (const endpoint of apis) area.append(row(endpoint, `${protocolName(endpoint)} · ${endpoint.model || L('未填写模型', 'no model')}${endpoint.encryptedKey ? L(' · 已保存密钥', ' · key saved') : ''}`));
  if (!apis.length) area.append(el(doc, 'p', 'glossa-muted', L('尚未添加 API 服务。点击“添加”，可从 OpenAI、Anthropic、DeepSeek 等预设快速填写。', 'No API services yet. Press Add to fill one in from presets such as OpenAI, Anthropic or DeepSeek.')));
  if (host.research.processes) {
    area.append(section(doc, L('本机 CLI', 'Local CLI')));
    for (const endpoint of settings.endpoints.filter(isCli)) {
      area.append(row(endpoint, endpoint.cliModels?.length ? L(`已检测 ${endpoint.cliModels.length} 个模型 · ${endpoint.model || '默认模型'}`, `${endpoint.cliModels.length} models detected · ${endpoint.model || 'default model'}`) : L('使用本机已登录的 CLI · 尚未检测', 'Uses your signed-in local CLI · not detected yet')));
    }
    area.append(el(doc, 'p', 'glossa-muted', L('CLI 使用其自身的登录状态，在独立临时目录中以只读参数运行，不读取凭据文件。', 'CLIs use their own sign-in, run read-only in a private temporary folder, and their credential files are never read.')));
  }
}

/** Effort picker shared by both editors; an empty value lets the service decide. */
function effortField(doc: Document, value: string, options: () => string[]): { node: HTMLElement; value(): string; refresh(): void } {
  const wrap = el(doc, 'div', 'glossa-inline');
  const custom = input(doc, L('自定义 effort', 'Custom effort'), ''); custom.hidden = true;
  const picker = el(doc, 'select'); picker.setAttribute('aria-label', L('推理强度', 'Reasoning effort'));
  let chosen = value;
  const refresh = (): void => {
    const values = options();
    picker.replaceChildren(...[[L('自动（由服务决定）', 'Auto (service decides)'), ''], ...values.map(v => [effortLabel(v), v]), [L('自定义…', 'Custom…'), '*']].map(([text, key]) => {
      const node = el(doc, 'option', '', text); node.value = key; return node;
    }));
    const known = !chosen || values.includes(chosen);
    picker.value = known ? chosen : '*'; custom.hidden = known; custom.value = known ? '' : chosen;
  };
  picker.addEventListener('change', () => {
    custom.hidden = picker.value !== '*';
    chosen = picker.value === '*' ? custom.value.trim() : picker.value;
    if (picker.value === '*') custom.focus();
  });
  custom.addEventListener('input', () => { chosen = custom.value.trim(); });
  refresh(); wrap.append(picker, custom);
  return { node: wrap, value: () => chosen, refresh };
}
/** Discovered model IDs shown as quick picks under a model input. */
function modelChoices(doc: Document, target: HTMLInputElement, models: () => { id: string; label?: string }[], onPick?: () => void): { node: HTMLElement; render(): void } {
  const list = el(doc, 'div', 'glossa-chip-list');
  const render = (): void => {
    list.replaceChildren(...models().slice(0, 60).map(m => {
      const chip = button(doc, m.label && m.label !== m.id ? `${m.label}` : m.id, () => { target.value = m.id; render(); onPick?.(); }, 'glossa-choice');
      chip.title = m.id; chip.setAttribute('aria-pressed', String(target.value.trim() === m.id));
      return chip;
    }));
    list.hidden = !list.childElementCount;
  };
  target.addEventListener('input', render); render();
  return { node: list, render };
}

function apiEditor(host: SettingsHost, saved?: Endpoint): void {
  const { doc } = host; const settings = host.research.store.state.settings;
  const area = host.open(saved ? saved.name : L('添加 API 服务', 'Add API service'), () => showSettings(host, 'services'));
  const version = host.version();
  const endpoint: Endpoint = saved ? { ...saved, models: [...saved.models] }
    : { id: uid(), name: '', baseUrl: '', apiStyle: 'openai', model: '', models: [], encryptedKey: '', effort: '' };
  let apiStyle = endpoint.apiStyle; let clearKey = false;
  const name = input(doc, L('服务名称', 'Service name'), endpoint.name);
  const base = input(doc, 'https://api.example.com/v1', endpoint.baseUrl); base.spellcheck = false;
  const protocol = segmented(doc, L('协议', 'Protocol'), [[L('OpenAI 兼容', 'OpenAI-compatible'), 'openai'], ['Anthropic', 'anthropic']], apiStyle, value => {
    apiStyle = value === 'anthropic' ? 'anthropic' : 'openai'; tokensField.hidden = apiStyle !== 'anthropic'; effort.refresh();
  });
  const preset = select(doc, L('服务预设', 'Preset'), [[L('自定义', 'Custom'), ''], ...PRESETS.map(p => [p.name, p.id] as [string, string])],
    PRESETS.find(p => p.baseUrl === endpoint.baseUrl)?.id || '', value => {
      const chosen = PRESETS.find(p => p.id === value); if (!chosen) return;
      if (!name.value.trim() || PRESETS.some(p => p.name === name.value.trim())) name.value = chosen.name;
      base.value = chosen.baseUrl; apiStyle = chosen.apiStyle;
      protocol.querySelectorAll?.('button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === apiStyle)));
      tokensField.hidden = apiStyle !== 'anthropic'; endpoint.models = []; choices.render(); effort.refresh();
    });
  const key = input(doc, saved?.encryptedKey ? L('已保存，留空则保持不变', 'Saved; leave empty to keep it') : L('API Key（本机服务可留空）', 'API key (optional for local services)'), '', 'password'); key.autocomplete = 'off';
  key.setAttribute('aria-label', 'API Key');
  // Zotero's password fields already have a native show/hide button.
  const keyRow = el(doc, 'div', 'glossa-inline'); keyRow.append(key);
  const clear = button(doc, L('清除已保存的密钥', 'Clear saved key'), () => {
    clearKey = !clearKey; clear.textContent = clearKey ? L('撤销清除（保存后生效）', 'Undo clear (applies on save)') : L('清除已保存的密钥', 'Clear saved key');
    key.placeholder = clearKey ? L('保存后将清除密钥', 'The key will be cleared on save') : L('已保存，留空则保持不变', 'Saved; leave empty to keep it');
  }, 'glossa-link');
  clear.hidden = !saved?.encryptedKey;
  const model = input(doc, L('如 gpt-4.1、claude-sonnet-4-6、deepseek-chat', 'e.g. gpt-4.1, claude-sonnet-4-6, deepseek-chat'), endpoint.model); model.setAttribute('aria-label', L('模型 ID', 'Model ID')); model.spellcheck = false;
  const choices = modelChoices(doc, model, () => endpoint.models.map(id => ({ id })));
  // Options depend on the address being edited (DeepSeek has its own thinking switch), not the saved one.
  const effort = effortField(doc, endpoint.effort, () => effortOptions({ ...endpoint, apiStyle, baseUrl: base.value.trim(), kind: 'api' }));
  base.addEventListener('change', () => effort.refresh());
  const tokens = input(doc, String(DEFAULT_MAX_TOKENS), endpoint.maxTokens ? String(endpoint.maxTokens) : '', 'number');
  tokens.setAttribute('aria-label', L('最大输出 tokens', 'Max output tokens')); tokens.min = '256'; tokens.step = '256';
  const tokensField = field(doc, L('最大输出 tokens', 'Max output tokens'), tokens, L('仅 Anthropic 协议需要；服务上限较低时可调小。', 'Anthropic protocol only; lower it for services with smaller limits.'));
  tokensField.hidden = apiStyle !== 'anthropic';
  const result = status(doc); const found = status(doc);
  const draft = (): Endpoint => {
    const limit = Number(tokens.value);
    return { ...endpoint, kind: 'api', name: name.value.trim() || 'API', baseUrl: base.value.trim(), apiStyle, model: model.value.trim(), effort: effort.value(),
      maxTokens: apiStyle === 'anthropic' && Number.isSafeInteger(limit) && limit >= 256 ? limit : undefined };
  };
  const retainedKey = (): string => {
    if (clearKey) return '';
    if (endpoint.encryptedKey && new URL(base.value.trim()).origin !== new URL(endpoint.baseUrl).origin) {
      throw new Error(L('服务域名已改变，请重新填写 API Key 或清除已保存的密钥', 'The service domain changed; enter the API key again or clear the saved one'));
    }
    return endpoint.encryptedKey;
  };
  const stale = (): boolean => version !== host.version();
  const discover = labelButton(doc, L('获取模型列表', 'Fetch models'), 'download', () => {
    const controller = host.research.host.controller(); const untrack = host.track(controller); discover.disabled = true;
    const timeout = setTimeout(() => controller.abort(), 20_000); found.textContent = L('正在获取模型列表…', 'Fetching models…');
    void (async () => {
      try {
        const value = draft();
        const apiKey = key.value || await abortable(host.research.host.decrypt(retainedKey()), controller.signal);
        const models = await discoverModels(value, apiKey, controller.signal, host.fetcher);
        if (stale()) return;
        endpoint.models = models; choices.render();
        found.textContent = L(`已获取 ${models.length} 个模型，点击即可填入。`, `Found ${models.length} models; click one to use it.`);
      } catch (error) { if (!stale()) found.textContent = controller.signal.aborted ? L('获取模型超时或已取消', 'Fetching models timed out or was cancelled') : errorMessage(error); }
      finally { clearTimeout(timeout); untrack(); if (!stale()) discover.disabled = false; }
    })();
  }, 'glossa-secondary');
  const save = button(doc, L('保存配置', 'Save'), () => {
    save.disabled = true;
    void (async () => {
      try {
        const value = draft(); validateEndpoint(value);
        value.encryptedKey = key.value ? await host.research.host.encrypt(key.value) : retainedKey();
        if (stale()) return;
        const index = settings.endpoints.findIndex(e => e.id === value.id);
        if (index >= 0) settings.endpoints[index] = value; else settings.endpoints.push(value);
        settings.transport = 'api'; settings.endpointID = settings.apiEndpointID = value.id;
        await host.research.store.save(); host.refresh();
        if (stale()) return;
        Object.assign(endpoint, value); key.value = ''; clearKey = false; clear.hidden = !value.encryptedKey;
        clear.textContent = L('清除已保存的密钥', 'Clear saved key'); key.placeholder = value.encryptedKey ? L('已保存，留空则保持不变', 'Saved; leave empty to keep it') : L('API Key（本机服务可留空）', 'API key (optional for local services)');
        result.textContent = L('配置已保存，已切换到此服务。', 'Saved and switched to this service.');
      } catch (error) { if (!stale()) result.textContent = errorMessage(error); }
      finally { if (!stale()) save.disabled = false; }
    })();
  }, 'glossa-primary');
  const actions = el(doc, 'div', 'glossa-actions-row'); actions.append(save);
  if (saved) {
    const remove = button(doc, L('删除此服务', 'Delete this service'), () => {
      if (remove.getAttribute('data-confirm') !== 'true') { remove.setAttribute('data-confirm', 'true'); remove.textContent = L('确认删除', 'Confirm delete'); return; }
      settings.endpoints = settings.endpoints.filter(e => e.id !== saved.id);
      if (settings.endpointID === saved.id) settings.endpointID = '';
      if (settings.apiEndpointID === saved.id) settings.apiEndpointID = '';
      if (settings.translationEndpointID === saved.id) settings.translationEndpointID = '';
      host.persist(); host.refresh(); showSettings(host, 'services');
    }, 'glossa-danger');
    actions.append(remove);
  }
  const modelRow = el(doc, 'div', 'glossa-inline'); modelRow.append(model, discover);
  area.append(field(doc, L('服务预设', 'Preset'), preset, L('选择后自动填写名称、协议和地址。', 'Fills in the name, protocol and address.')), field(doc, L('服务名称', 'Service name'), name), field(doc, L('协议', 'Protocol'), protocol),
    field(doc, L('API 基础地址', 'API base URL'), base, L('OpenAI 兼容服务通常以 /v1 结尾；Anthropic 可填根地址。本机服务可用 http://localhost。', 'OpenAI-compatible services usually end in /v1; Anthropic accepts the root URL. Local services may use http://localhost.')),
    field(doc, 'API Key', keyRow), clear, field(doc, L('模型', 'Model'), modelRow), found, choices.node, field(doc, L('推理强度', 'Reasoning effort'), effort.node, L('留空由服务决定；不支持时会被服务拒绝。', 'Leave it to the service; unsupported values are rejected by the service.')),
    tokensField, el(doc, 'p', 'glossa-muted', L('密钥经 Zotero 的系统密钥存储加密后保存，不随历史备份导出。', 'Keys are encrypted with Zotero’s system keychain and never included in history backups.')), result, actions);
  (saved ? model : name).focus();
}

function cliEditor(host: SettingsHost, saved: Endpoint): void {
  const { doc } = host; const settings = host.research.store.state.settings;
  const area = host.open(saved.name, () => showSettings(host, 'services'));
  const version = host.version(); const stale = (): boolean => version !== host.version();
  const endpoint: Endpoint = { ...saved, models: [...saved.models] };
  const path = input(doc, L('留空自动查找，或填写可执行文件的绝对路径', 'Leave empty to find it automatically, or enter the absolute path'), endpoint.binaryPath || ''); path.setAttribute('aria-label', L('CLI 路径', 'CLI path')); path.spellcheck = false;
  const proxy = input(doc, L('留空则跟随 Zotero 的网络代理', 'Leave empty to follow Zotero’s network proxy'), endpoint.proxy || ''); proxy.setAttribute('aria-label', L('代理地址', 'Proxy')); proxy.spellcheck = false;
  const model = input(doc, L('留空使用 CLI 默认模型', 'Leave empty for the CLI’s default model'), endpoint.model); model.setAttribute('aria-label', L('模型 ID', 'Model ID')); model.spellcheck = false;
  const efforts = (): string[] => effortOptions({ ...endpoint, model: model.value.trim() });
  const effort = effortField(doc, endpoint.effort, efforts);
  const choices = modelChoices(doc, model, () => (endpoint.cliModels || []).map(m => ({ id: m.id, label: m.label })), () => effort.refresh());
  model.addEventListener('change', () => effort.refresh());
  const result = status(doc); const found = status(doc);
  const draft = (): Endpoint => ({ ...endpoint, binaryPath: path.value.trim(), proxy: proxy.value.trim(), model: model.value.trim(), effort: effort.value() });
  const detect = labelButton(doc, endpoint.cliModels?.length ? L('重新检测', 'Detect again') : L('检测并获取模型', 'Detect and list models'), 'retry', () => {
    const controller = host.research.host.controller(); const untrack = host.track(controller); detect.disabled = true;
    const timeout = setTimeout(() => controller.abort(), 20_000); found.textContent = L(`正在启动 ${saved.name} 并读取模型与推理强度…`, `Starting ${saved.name} to read its models and efforts…`);
    void (async () => {
      try {
        const value = draft(); await host.research.discoverCli(value, controller.signal);
        if (stale()) return;
        endpoint.models = value.models; endpoint.cliModels = value.cliModels;
        if (!model.value.trim()) model.value = value.model;
        choices.render(); effort.refresh();
        found.textContent = L(`连接成功，发现 ${value.models.length} 个模型；选好后点击“保存配置”。`, `Connected; found ${value.models.length} models. Pick one, then press Save.`);
      } catch (error) { if (!stale()) found.textContent = controller.signal.aborted ? L('检测超时或已取消；也可直接填写模型 ID 使用', 'Detection timed out or was cancelled; you can still enter a model ID') : errorMessage(error); }
      finally { clearTimeout(timeout); untrack(); if (!stale()) detect.disabled = false; }
    })();
  }, 'glossa-secondary');
  const save = button(doc, L('保存配置', 'Save'), () => {
    try {
      const value = draft(); validateCli(value);
      settings.endpoints = settings.endpoints.map(e => e.id === value.id ? value : e);
      settings.transport = 'cli'; settings.endpointID = settings.cliEndpointID = value.id;
      host.persist(); host.refresh(); Object.assign(endpoint, value);
      result.textContent = L('配置已保存，已切换到此 CLI。', 'Saved and switched to this CLI.');
    } catch (error) { result.textContent = errorMessage(error); }
  }, 'glossa-primary');
  const actions = el(doc, 'div', 'glossa-actions-row'); actions.append(save);
  const label = CLI_TOOLS.find(t => t.kind === saved.kind)?.name || saved.name;
  // Show which proxy the CLI will actually get; Zotero started from the Dock does not see a terminal's proxy variables.
  const proxyNow = el(doc, 'span', 'glossa-field-hint');
  const showProxy = (): void => {
    const port = host.research.processes; if (!port?.proxy) return;
    const value = draft();
    void port.proxy(value).then(choice => {
      if (stale() || proxy.value.trim() !== (value.proxy || '')) return;
      proxyNow.textContent = choice.source === 'setting' ? L(`当前使用：${choice.url}`, `Using: ${choice.url}`)
        : choice.source === 'environment' ? L(`当前使用 Zotero 启动环境中的代理：${choice.url}`, `Using the proxy from Zotero’s environment: ${choice.url}`)
          : choice.source === 'zotero' ? L(`当前使用 Zotero / 系统代理：${choice.url}`, `Using Zotero’s / the system proxy: ${choice.url}`)
            : L('当前直连，不使用代理', 'Connecting directly, without a proxy');
    }).catch(() => undefined);
  };
  proxy.addEventListener('change', showProxy); showProxy();
  const proxyField = field(doc, L('代理地址（可选）', 'Proxy (optional)'), proxy, L('留空时使用 Zotero 的网络代理设置（默认即系统代理）；也可在此指定 HTTP(S) 或 SOCKS5 地址。', 'When empty, Zotero’s network proxy settings are used (the system proxy by default); you can also enter an HTTP(S) or SOCKS5 address.'));
  proxyField.append(proxyNow);
  area.append(el(doc, 'p', 'glossa-muted', L(`使用本机已安装并登录的 ${label}。Glossa 不安装软件、不读取凭据文件，每次运行都在独立的临时目录中以只读参数执行。`, `Uses your installed, signed-in ${label}. Glossa installs nothing, never reads credential files, and runs each request read-only in a private temporary folder.`)),
    field(doc, L('CLI 路径', 'CLI path'), path), proxyField,
    detect, found, field(doc, L('模型', 'Model'), model), choices.node, field(doc, L('推理强度', 'Reasoning effort'), effort.node), result, actions);
}
