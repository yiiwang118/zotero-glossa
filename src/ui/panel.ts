import { L } from '../core/i18n';
import type { Conversation, Endpoint, ItemRef, Message, Mode, Selection } from '../core/types';
import { ensureCliEndpoints, errorMessage, isCli, sameItem } from '../core/types';
import { effortLabel, effortOptions, validateEndpoint } from '../core/provider';
import type { FetchPort } from '../core/provider';
import { Research } from '../core/research';
import { validateCli } from '../core/cli';
import { button, el, iconButton, input, labelButton, option, setClass, status } from './dom';
import { icon } from './icons';
import { COMMANDS, expandCommand, findCommand } from './commands';
import { renderAnswer } from './markdown';
import { Popover, menuInput, menuItem, menuSection } from './menu';
import type { SheetHost } from './sheet';
import { cliGlyph, showSettings } from './settings';
import type { SettingsHost } from './settings';
import { showHistory } from './history';
import type { HistoryHost } from './history';

interface PanelOptions {
  workspace?: boolean;
  /** Rebuild every open panel after the interface language changed; `origin` reopens its settings. */
  relocalize?(origin: Panel): void;
  openWorkspace(items: ItemRef[], selection?: Selection, session?: PanelSession): void;
  openSidebar?(items: ItemRef[], selection?: Selection, session?: PanelSession): void;
}
export interface PanelSession { context: ItemRef[]; titles: string[]; selection?: Selection; conversation?: Conversation; draft: string }
interface MessageView {
  root: HTMLElement; body: HTMLElement; text: string; state: string;
  notice?: HTMLElement; actions?: HTMLElement; sources?: HTMLElement;
  /** Collapsible thinking card; opened automatically while the model thinks, unless the user toggled it. */
  reasoning?: HTMLDetailsElement; reasoningBody?: HTMLElement; reasoningLabel?: HTMLElement; reasoningText?: string;
  reasoningAuto?: boolean; reasoningPinned?: boolean;
  activity?: HTMLElement; activityLabel?: HTMLElement; activityTime?: HTMLElement;
}
const MAX_CONTEXT = 6;
/** When each CLI's model list was last read in this Zotero session. CLIs gain models over time (a Grok update added grok-4.7),
 * so a saved list is refreshed in the background when the model menu opens, at most every 30 minutes. */
const catalogReadAt = new Map<string, number>();
const CATALOG_TTL = 30 * 60_000;
/** Accessible name of a model entry: “Service：model”. */
const modelLabel = (service: string, model: string): string => `${service}${L('：', ': ')}${model}`;

export class Panel {
  readonly root: HTMLElement;
  readonly popover: Popover;
  readonly workspace: boolean;
  private doc: Document;
  private context: ItemRef[] = [];
  private titles: string[] = [];
  private selection?: Selection;
  /** Title of the paper a live selection came from, when it was offered by the reader. */
  private selectionPaper?: string;
  private selectionCard: HTMLElement;
  private conversation?: Conversation;
  private mode: Mode = 'plan';
  private disposed = false;
  private unsubscribe: () => void;
  private hostContextKey = '';
  private contextEpoch = 0;
  private attaching = false;
  private plan: HTMLButtonElement;
  private act: HTMLButtonElement;
  private overlay: HTMLElement;
  private overlayError?: HTMLElement;
  private messages: HTMLElement;
  private empty: HTMLElement;
  private recent: HTMLElement;
  private messageViews = new Map<string, MessageView>();
  private feedback: HTMLElement;
  private compose: HTMLElement;
  private contextRow: HTMLElement;
  private composer: HTMLTextAreaElement;
  private commandMenu: HTMLElement;
  private commandIndex = 0;
  private fulltext: HTMLButtonElement;
  private modelButton: HTMLButtonElement;
  private effortButton: HTMLButtonElement;
  private send: HTMLButtonElement;
  private refreshHistory?: () => void;
  private showingRun = '';
  private controllers = new Set<AbortController>();
  private catalogs = new Map<string, AbortController>();
  private catalogAttempts = new Set<string>();
  private overlayVersion = 0;
  private settingsSignature = '';
  private overlayFocus: HTMLElement | null = null;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private ticker?: ReturnType<typeof setInterval>;
  private modelQuery = '';

  constructor(body: HTMLElement, private research: Research, private fetcher: FetchPort, private options: PanelOptions) {
    const d = this.doc = body.ownerDocument;
    this.workspace = !!options.workspace;
    this.root = el(d, 'section', 'glossa-panel');
    this.root.setAttribute('aria-label', L('Glossa 文献助手', 'Glossa research assistant'));
    this.root.setAttribute('data-surface', options.workspace ? 'workspace' : 'sidebar');
    if (research.processes) ensureCliEndpoints(research.store.state.settings);

    const toolbar = el(d, 'div', 'glossa-toolbar');
    const modes = el(d, 'div', 'glossa-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', L('工作模式', 'Mode'));
    this.plan = button(d, 'Plan', () => this.setMode('plan', true));
    this.act = button(d, 'Act', () => this.setMode('act', true));
    this.plan.title = L('Plan：只读分析与解释，不写入 Zotero', 'Plan: read-only analysis and explanation; never writes to Zotero'); this.act.title = L('Act：生成可保存的成稿，确认后可创建子笔记', 'Act: produces finished output that can be saved as a child note after confirmation');
    modes.append(this.plan, this.act);
    const actions = el(d, 'div', 'glossa-actions');
    actions.append(iconButton(d, L('新建对话', 'New chat'), 'plus', () => this.newChat()),
      iconButton(d, L('历史', 'History'), 'history', () => this.toggleOverlay(L('对话历史', 'History'), () => this.showHistory())),
      iconButton(d, L('设置', 'Settings'), 'cog', () => this.toggleOverlay(L('设置', 'Settings'), () => this.showSettings())));
    if (!options.workspace) actions.append(iconButton(d, L('在独立窗口中打开', 'Open in a separate window'), 'window', () => options.openWorkspace(this.context, this.selection, this.session())));
    else if (options.openSidebar) actions.append(iconButton(d, L('移回侧栏', 'Move to sidebar'), 'sidebar', () => options.openSidebar?.(this.context, this.selection, this.session())));
    toolbar.append(modes, actions);

    this.overlay = el(d, 'section', 'glossa-overlay'); this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.popover.open) { event.preventDefault(); this.closeOverlay(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...this.overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]), select, textarea, summary')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && this.doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && this.doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    });

    this.messages = el(d, 'div', 'glossa-messages'); this.messages.setAttribute('aria-label', L('对话消息', 'Messages'));
    this.empty = el(d, 'div', 'glossa-empty');
    const hero = el(d, 'div', 'glossa-hero'); hero.append(icon(d, 'orb'));
    const quick = el(d, 'div', 'glossa-quick');
    for (const command of COMMANDS) {
      const tile = button(d, '', () => this.chooseCommand(command.command), 'glossa-quick-command');
      tile.setAttribute('aria-label', `${command.label}${L('（', ' (')}${command.command}${L('）', ')')}`);
      tile.append(icon(d, command.glyph), el(d, 'span', 'glossa-command-label', command.label), el(d, 'span', 'glossa-command-name', command.command));
      quick.append(tile);
    }
    const attach = button(d, '', () => void this.attachItems(), 'glossa-quick-command');
    attach.setAttribute('aria-label', L('添加更多文献（@）', 'Add more papers (@)'));
    attach.append(icon(d, 'at'), el(d, 'span', 'glossa-command-label', L('添加更多文献', 'Add more papers')), el(d, 'span', 'glossa-command-name', '@'));
    quick.append(attach);
    this.recent = el(d, 'div', 'glossa-recent');
    this.empty.append(hero, el(d, 'h2', 'glossa-wordmark', 'Glossa'), el(d, 'p', 'glossa-tagline', L('与文献对话 · 翻译 · 整理成笔记', 'Chat with papers · translate · save notes')), quick, this.recent,
      el(d, 'p', 'glossa-privacy', L('发送时，所选文献的元数据、摘录与你的问题会提交给当前模型服务。', 'When you send, the selected papers’ metadata, excerpts and your question go to the current model service.')));
    this.messages.append(this.empty);

    this.compose = el(d, 'div', 'glossa-compose');
    this.contextRow = el(d, 'div', 'glossa-context'); this.contextRow.setAttribute('aria-label', L('对话上下文', 'Chat context'));
    this.selectionCard = el(d, 'div', 'glossa-selection-card'); this.selectionCard.hidden = true;
    this.selectionCard.setAttribute('aria-label', L('当前选区', 'Current selection'));
    this.composer = el(d, 'textarea'); this.composer.rows = 2;
    this.composer.placeholder = L('询问这篇文献…  / 命令 · @ 添加文献', 'Ask about this paper…  / commands · @ add papers'); this.composer.setAttribute('aria-label', L('输入问题', 'Ask a question'));
    this.composer.addEventListener('input', () => this.composerChanged());
    this.composer.addEventListener('keydown', event => this.composerKey(event));
    this.commandMenu = el(d, 'div', 'glossa-command-menu'); this.commandMenu.hidden = true;
    this.commandMenu.setAttribute('role', 'listbox'); this.commandMenu.setAttribute('aria-label', L('快捷命令', 'Commands'));
    const bottom = el(d, 'div', 'glossa-compose-bottom');
    const attachButton = iconButton(d, L('添加文献', 'Add papers'), 'filePlus', () => void this.attachItems());
    this.fulltext = button(d, '', () => {
      const settings = research.store.state.settings; settings.includeFulltext = !settings.includeFulltext;
      this.updateSelectors(); this.persist();
      this.notify(settings.includeFulltext ? L('将附带 PDF / EPUB 正文', 'PDF / EPUB text will be included') : L('只发送元数据、摘要、选区与批注', 'Only metadata, abstract, selection and annotations will be sent'));
    }, 'glossa-toggle-chip');
    this.fulltext.setAttribute('aria-label', L('附带全文', 'Include full text')); this.fulltext.append(icon(d, 'fileText'), el(d, 'span', '', L('全文', 'Full text')));
    this.modelButton = button(d, '', () => this.openModelMenu(), 'glossa-model-button'); this.modelButton.setAttribute('aria-label', L('选择模型', 'Choose model'));
    this.modelButton.setAttribute('aria-haspopup', 'menu');
    this.effortButton = button(d, '', () => this.openEffortMenu(), 'glossa-effort-button'); this.effortButton.setAttribute('aria-label', L('推理强度', 'Reasoning effort'));
    this.effortButton.setAttribute('aria-haspopup', 'menu');
    this.send = iconButton(d, L('发送', 'Send'), 'arrowUp', () => this.submit(), 'glossa-send');
    bottom.append(attachButton, this.fulltext, el(d, 'span', 'glossa-spacer'), this.modelButton, this.effortButton, this.send);
    this.compose.append(this.selectionCard, this.contextRow, this.composer, this.commandMenu, bottom);
    this.feedback = status(d); this.feedback.className += ' glossa-feedback';
    this.root.append(toolbar, this.overlay, this.messages, this.feedback, this.compose);
    this.popover = new Popover(this.root);
    body.append(this.root);
    this.unsubscribe = research.store.subscribe(() => {
      const signature = JSON.stringify(research.store.state.settings);
      if (signature !== this.settingsSignature) { this.settingsSignature = signature; this.updateSelectors(); }
      this.renderMessages();
      this.refreshHistory?.();
    });
    this.updateSelectors(); this.renderContext(); this.setMode(research.store.state.settings.runMode || 'plan'); this.autoCliCatalog();
  }

  // ── Composer ─────────────────────────────────────────────────────────────
  private toggleOverlay(title: string, open: () => void): void {
    if (!this.overlay.hidden && this.overlay.getAttribute('aria-label') === title) this.closeOverlay();
    else open();
  }
  private chooseCommand(command: string): void {
    this.composer.value = `${command} `; this.commandMenu.hidden = true;
    this.composerChanged(); this.composer.focus();
  }
  private composerKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const menu = !this.commandMenu.hidden;
    if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); const count = this.commandMenu.childElementCount;
      this.commandIndex = (this.commandIndex + (event.key === 'ArrowDown' ? 1 : count - 1)) % count; this.highlightCommand(); return;
    }
    if (menu && event.key === 'Escape') { event.preventDefault(); this.commandMenu.hidden = true; return; }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (menu) { (this.commandMenu.children[this.commandIndex] as HTMLButtonElement | undefined)?.click(); return; }
      this.submit();
    }
  }
  private highlightCommand(): void {
    [...this.commandMenu.children].forEach((node, index) => node.setAttribute('aria-selected', String(index === this.commandIndex)));
  }
  private composerChanged(): void {
    this.composer.style.height = 'auto';
    this.composer.style.height = `${Math.min(200, Math.max(44, this.composer.scrollHeight))}px`;
    this.commandMenu.replaceChildren(); this.commandIndex = 0;
    const query = this.composer.value;
    const commandTrigger = /^\/\w*$/.test(query);
    const contextTrigger = /(?:^|\s)@$/.test(query);
    if (commandTrigger) for (const c of COMMANDS.filter(c => c.command.startsWith(query))) {
      const item = button(this.doc, '', () => this.chooseCommand(c.command), 'glossa-command-option'); item.setAttribute('role', 'option');
      item.append(icon(this.doc, c.glyph), el(this.doc, 'span', 'glossa-command-label', c.label), el(this.doc, 'span', 'glossa-command-name', c.command));
      this.commandMenu.append(item);
    }
    if (contextTrigger) {
      const item = button(this.doc, '', () => void this.attachItems(), 'glossa-command-option'); item.setAttribute('role', 'option');
      item.append(icon(this.doc, 'filePlus'), el(this.doc, 'span', 'glossa-command-label', L('从 Zotero 文献库添加…', 'Add from your Zotero library…')));
      this.commandMenu.append(item);
    }
    this.commandMenu.hidden = !this.commandMenu.childElementCount;
    this.highlightCommand(); this.updateSend();
  }
  private async attachItems(): Promise<void> {
    if (this.attaching) return;
    if (!this.research.host.pickItems) { this.notify(L('请从 Zotero 条目列表选择文献后打开 Glossa。', 'Select items in the Zotero item list, then open Glossa.')); return; }
    this.attaching = true; this.commandMenu.hidden = true;
    const epoch = this.contextEpoch;
    try {
      const items = await this.research.host.pickItems();
      if (this.disposed || epoch !== this.contextEpoch || !items.length) return;
      for (const value of items) if (!this.context.some(r => sameItem(r, value.item))) {
        if (this.context.length >= MAX_CONTEXT) { this.notify(L(`每轮最多 ${MAX_CONTEXT} 篇文献；请先移除不需要的文献。`, `At most ${MAX_CONTEXT} papers per question; remove some first.`)); break; }
        this.context.push({ ...value.item }); this.titles.push(value.title);
      }
      this.composer.value = this.composer.value.replace(/(^|\s)@$/, '$1');
      this.renderContext(); this.composerChanged(); this.composer.focus();
    } catch (error) { this.showError(error); }
    finally { this.attaching = false; }
  }
  private updateSend(): void {
    const busy = !!this.conversation && this.research.busy(this.conversation.id);
    const label = busy ? L('停止', 'Stop') : L('发送', 'Send');
    this.send.setAttribute('aria-label', label); this.send.title = busy ? L('停止生成', 'Stop generating') : L('发送（Enter）· 换行（Shift+Enter）', 'Send (Enter) · new line (Shift+Enter)');
    this.send.replaceChildren(icon(this.doc, busy ? 'stop' : 'arrowUp'), el(this.doc, 'span', 'glossa-sr-only', label));
    this.send.disabled = !busy && !this.composer.value.trim();
    setClass(this.send, 'glossa-busy', busy);
    this.plan.disabled = busy; this.act.disabled = busy;
  }

  // ── Model and effort pickers ─────────────────────────────────────────────
  private endpoint(): Endpoint | undefined {
    const settings = this.research.store.state.settings;
    const available = settings.endpoints.filter(e => isCli(e) === (settings.transport === 'cli') && (!isCli(e) || this.research.processes));
    return available.find(e => e.id === settings.endpointID) || available[0];
  }
  private updateSelectors(): void {
    const settings = this.research.store.state.settings; const selected = this.endpoint();
    const label = selected ? selected.model || (isCli(selected) ? `${selected.name} ${L('默认', 'default')}` : selected.name) : L('选择模型', 'Choose model');
    this.modelButton.replaceChildren(icon(this.doc, selected ? cliGlyph(selected) : 'cloud'), el(this.doc, 'span', 'glossa-model-name', label), icon(this.doc, 'chevronDown'));
    this.modelButton.title = selected ? `${selected.name} · ${selected.model || L('默认模型', 'default model')}` : L('选择或添加模型服务', 'Choose or add a model service');
    setClass(this.modelButton, 'glossa-unset', !selected || (!isCli(selected) && !selected.model));
    this.effortButton.replaceChildren(icon(this.doc, 'gauge'), el(this.doc, 'span', '', effortLabel(selected?.effort || '')));
    this.effortButton.title = `${L('推理强度：', 'Reasoning effort: ')}${selected?.effort ? effortLabel(selected.effort) : L('自动（由服务决定）', 'Auto (service decides)')}`;
    this.fulltext.setAttribute('aria-pressed', String(settings.includeFulltext));
    this.fulltext.title = settings.includeFulltext ? L('附带 PDF / EPUB 正文（已开启）', 'Include PDF / EPUB text (on)') : L('附带 PDF / EPUB 正文（已关闭）', 'Include PDF / EPUB text (off)');
    this.mode = settings.runMode || 'plan';
    this.plan.setAttribute('aria-pressed', String(this.mode === 'plan')); this.act.setAttribute('aria-pressed', String(this.mode === 'act'));
  }
  private selectModel(endpoint: Endpoint, model: string): void {
    const settings = this.research.store.state.settings;
    settings.transport = isCli(endpoint) ? 'cli' : 'api'; settings.endpointID = endpoint.id;
    settings[isCli(endpoint) ? 'cliEndpointID' : 'apiEndpointID'] = endpoint.id;
    endpoint.model = model;
    const capabilities = endpoint.cliModels?.find(m => m.id === model);
    if (capabilities && endpoint.effort && !capabilities.efforts.includes(endpoint.effort)) endpoint.effort = capabilities.defaultEffort || '';
    this.updateSelectors(); this.persist(); this.autoCliCatalog();
  }
  openModelMenu(): void {
    if (this.popover.isFor(this.modelButton)) { this.popover.close(); return; }
    this.modelQuery = '';
    this.popover.show(this.modelButton, root => this.renderModelMenu(root), { label: L('选择模型', 'Choose model'), placement: 'above', align: 'stretch', within: this.compose });
    this.refreshCatalogs();
  }
  private refreshCatalogs(): void {
    if (!this.research.processes) return;
    for (const endpoint of this.research.store.state.settings.endpoints.filter(isCli)) {
      // A CLI that was never detected may not be installed; it keeps its explicit "Detect" entry instead.
      if (!endpoint.cliModels?.length || Date.now() - (catalogReadAt.get(endpoint.id) || 0) < CATALOG_TTL) continue;
      catalogReadAt.set(endpoint.id, Date.now()); void this.loadCatalog(endpoint, true);
    }
  }
  private renderModelMenu(root: HTMLElement): void {
    const d = this.doc; const settings = this.research.store.state.settings; const selected = this.endpoint();
    const close = (): void => this.popover.close();
    const list = el(d, 'div', 'glossa-menu-scroll');
    const settingsAt = (view: string): void => { this.popover.close(false); this.showSettings(view); };
    const editButton = (endpoint: Endpoint): HTMLButtonElement => iconButton(d, `${L('编辑', 'Edit')} ${endpoint.name}`, 'pencil', () => settingsAt(endpoint.id), 'glossa-menu-tool');
    const render = (): void => {
      const query = this.modelQuery.trim().toLowerCase(); const matches = (id: string, label = ''): boolean => !query || `${id} ${label}`.toLowerCase().includes(query);
      list.replaceChildren();
      list.append(menuSection(d, L('API 服务', 'API services'), labelButton(d, L('添加', 'Add'), 'plus', () => settingsAt('new'), 'glossa-menu-tool')));
      const apis = settings.endpoints.filter(e => !isCli(e));
      for (const endpoint of apis) {
        const head = el(d, 'div', 'glossa-menu-group'); head.append(icon(d, 'cloud'), el(d, 'span', '', endpoint.name), editButton(endpoint));
        const ids = [...new Set([endpoint.model, ...endpoint.models].filter(Boolean))].filter(id => matches(id));
        if (!ids.length && query) continue;
        list.append(head);
        for (const id of ids.slice(0, 80)) list.append(menuItem(d, { label: id, ariaLabel: modelLabel(endpoint.name, id), checked: endpoint === selected && endpoint.model === id,
          action: () => this.selectModel(endpoint, id) }, close));
        if (!ids.length) list.append(menuItem(d, { label: L('填写模型 ID…', 'Enter a model ID…'), glyph: 'pencil', action: () => settingsAt(endpoint.id) }, close));
      }
      if (!apis.length) list.append(menuItem(d, { label: L('添加 API 服务…', 'Add an API service…'), detail: L('OpenAI、Anthropic、DeepSeek、Ollama…', 'OpenAI, Anthropic, DeepSeek, Ollama…'), glyph: 'plus', action: () => settingsAt('new') }, close));
      if (this.research.processes) {
        list.append(menuSection(d, L('本机 CLI', 'Local CLI')));
        for (const endpoint of settings.endpoints.filter(isCli)) {
          const loading = this.catalogs.has(endpoint.id);
          const head = el(d, 'div', 'glossa-menu-group'); head.append(icon(d, cliGlyph(endpoint)), el(d, 'span', '', endpoint.name));
          if (loading) head.append(el(d, 'span', 'glossa-menu-detail', L('正在检测…', 'Detecting…')));
          else if (endpoint.cliModels?.length) {
            const refresh = iconButton(d, L(`刷新 ${endpoint.name} 的模型列表`, `Refresh ${endpoint.name} models`), 'retry', () => void this.loadCatalog(endpoint), 'glossa-menu-tool');
            head.append(refresh);
          }
          head.append(editButton(endpoint));
          const catalog = endpoint.cliModels || [];
          // A model typed by hand stays selectable even when the CLI's catalog does not list it.
          const models = [...(endpoint.model && !catalog.some(m => m.id === endpoint.model) ? [{ id: endpoint.model, label: endpoint.model }] : []), ...catalog]
            .filter(m => matches(m.id, m.label));
          if (query && !models.length) continue;
          list.append(head);
          if (!query) list.append(menuItem(d, { label: L('默认模型', 'Default model'), ariaLabel: modelLabel(endpoint.name, L('默认模型', 'Default model')),
            checked: endpoint === selected && !endpoint.model, action: () => this.selectModel(endpoint, '') }, close));
          for (const m of models) list.append(menuItem(d, { label: m.label || m.id, detail: m.label && m.label !== m.id ? m.id : undefined, ariaLabel: modelLabel(endpoint.name, m.id),
            checked: endpoint === selected && endpoint.model === m.id, action: () => this.selectModel(endpoint, m.id) }, close));
          if (!endpoint.cliModels?.length && !query) list.append(menuItem(d, { label: loading ? L('正在读取模型…', 'Reading models…') : L('检测可用模型', 'Detect models'), glyph: 'retry', disabled: loading,
            action: () => { void this.loadCatalog(endpoint); return true; } }, close));
        }
      }
      const current = selected || settings.endpoints.find(e => !isCli(e));
      const exact = settings.endpoints.some(e => e.models.includes(this.modelQuery.trim()) || e.model === this.modelQuery.trim());
      if (query && current && !exact) list.append(menuItem(d, { label: L(`使用「${this.modelQuery.trim()}」`, `Use “${this.modelQuery.trim()}”`), detail: L(`作为 ${current.name} 的模型`, `as the model for ${current.name}`), glyph: 'pencil',
        action: () => this.selectModel(current, this.modelQuery.trim()) }, close));
      if (query && !list.querySelector?.('.glossa-menu-item')) list.append(el(d, 'p', 'glossa-empty-note', L('没有匹配的模型。', 'No matching models.')));
    };
    const search = menuInput(d, L('搜索模型，或输入模型 ID 后回车', 'Search, or type a model ID and press Enter'), this.modelQuery, value => {
      const current = selected || settings.endpoints.find(e => !isCli(e));
      if (current) { this.selectModel(current, value); close(); }
    }, value => { this.modelQuery = value; render(); });
    search.setAttribute('aria-label', L('搜索或输入模型 ID', 'Search or enter a model ID'));
    render();
    root.append(search, list, menuItem(d, { label: L('管理模型服务…', 'Manage model services…'), glyph: 'cog', action: () => settingsAt('services') }, close));
  }
  private openEffortMenu(): void {
    const endpoint = this.endpoint();
    if (!endpoint) { this.openModelMenu(); return; }
    if (this.popover.isFor(this.effortButton)) { this.popover.close(); return; }
    this.popover.show(this.effortButton, root => {
      const d = this.doc; const close = (): void => this.popover.close();
      const choose = (value: string): void => { endpoint.effort = value; this.updateSelectors(); this.persist(); close(); };
      root.append(menuSection(d, L('推理强度', 'Reasoning effort')), menuItem(d, { label: L('自动', 'Auto'), detail: L('由服务或 CLI 决定', 'Decided by the service or CLI'), ariaLabel: L('推理强度：自动', 'Reasoning effort: Auto'), checked: !endpoint.effort, action: () => choose('') }, close));
      const values = effortOptions(endpoint);
      for (const value of values) root.append(menuItem(d, { label: effortLabel(value), detail: value === 'off' ? L('更快，不显示思考过程', 'Faster; no thinking shown') : undefined,
        ariaLabel: `${L('推理强度：', 'Reasoning effort: ')}${value}`, checked: endpoint.effort === value, action: () => choose(value) }, close));
      if (endpoint.effort && !values.includes(endpoint.effort)) root.append(menuItem(d, { label: endpoint.effort, detail: L('自定义', 'Custom'), checked: true, action: () => choose(endpoint.effort) }, close));
      const custom = menuInput(d, L('自定义，回车确认', 'Custom, press Enter'), '', value => {
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(value)) { this.notify(L('推理强度只能包含字母、数字、下划线或短横线', 'Effort may only contain letters, digits, underscores or hyphens')); return; }
        choose(value);
      });
      root.append(custom);
    }, { label: L('推理强度', 'Reasoning effort'), placement: 'above', align: 'end', width: 220, within: undefined });
  }
  /** Reads a CLI's models; `quiet` (background refresh) keeps the saved list without messages when the CLI cannot be reached. */
  private loadCatalog(endpoint: Endpoint, quiet = false): Promise<void> {
    if (this.catalogs.has(endpoint.id) || !this.research.processes) return Promise.resolve();
    const controller = this.research.host.controller(); this.catalogs.set(endpoint.id, controller);
    const timer = setTimeout(() => controller.abort(), 20_000);
    const value = { ...endpoint };
    if (!quiet) this.notify(L(`正在读取 ${endpoint.name} 的模型…`, `Reading ${endpoint.name} models…`), true);
    this.popover.refresh();
    return (async () => {
      try {
        await this.research.discoverCli(value, controller.signal);
        if (this.disposed || controller.signal.aborted || !this.research.store.state.settings.endpoints.includes(endpoint)) return;
        // An empty model keeps meaning "the CLI's own default", so discovery never overrides the user's choice.
        endpoint.models = value.models; endpoint.cliModels = value.cliModels; catalogReadAt.set(endpoint.id, Date.now());
        await this.research.store.save();
        if (!quiet) this.notify(L(`已读取 ${endpoint.name} 的 ${value.models.length} 个模型`, `Read ${value.models.length} models from ${endpoint.name}`));
      } catch (error) {
        // A background refresh that fails keeps the saved list silently.
        if (quiet) return;
        if (!this.disposed && !controller.signal.aborted) this.notify(`${errorMessage(error)}${L('；可在设置中检查 CLI 路径或代理。', '. Check the CLI path or proxy in Settings.')}`, true);
        else if (!this.disposed) this.notify(L(`读取 ${endpoint.name} 的模型超时；可在设置中重新检测。`, `Reading ${endpoint.name} models timed out; you can detect again in Settings.`));
      } finally {
        clearTimeout(timer); this.catalogs.delete(endpoint.id);
        if (!this.disposed) { this.updateSelectors(); this.popover.refresh(); }
      }
    })();
  }
  private autoCliCatalog(): void {
    const selected = this.endpoint();
    if (!selected || !isCli(selected) || selected.cliModels?.length || this.catalogAttempts.has(selected.id)) return;
    this.catalogAttempts.add(selected.id); void this.loadCatalog(selected);
  }

  // ── Context ──────────────────────────────────────────────────────────────
  private persist(): void {
    void this.research.store.save().catch(error => this.showError(error));
  }
  /** Status-line message; transient ones clear themselves so stale notices do not linger. */
  private notify(text: string, sticky = false): void {
    if (this.disposed) return;
    clearTimeout(this.noticeTimer); this.feedback.textContent = text;
    setClass(this.feedback, 'glossa-error', false);
    if (!sticky && text) this.noticeTimer = setTimeout(() => { if (this.feedback.textContent === text) this.feedback.textContent = ''; }, 4000);
  }
  private showError(error: unknown): void {
    if (this.disposed) return;
    if (this.overlayError && !this.overlay.hidden) { this.overlayError.textContent = errorMessage(error); return; }
    this.notify(errorMessage(error), true); setClass(this.feedback, 'glossa-error', true);
  }
  private async action(task: () => Promise<void>): Promise<void> {
    try { await task(); } catch (error) { this.showError(error); }
  }
  /** Called by the host whenever it renders an item. Re-renders of the same item keep user edits to the context. */
  setContext(items: ItemRef[], titles: string[], selection?: Selection): void {
    const key = items.map(r => `${r.libraryID}/${r.key}`).join(',');
    const changed = this.hostContextKey !== key;
    if (changed) {
      this.hostContextKey = key;
      // A conversation about another paper stays in history; the new paper starts from its own page.
      const current = this.conversation;
      if (current && items.length && !items.some(item => current.items.some(c => sameItem(c, item)))) {
        this.conversation = undefined; this.renderMessages();
      }
      this.useContext(items, titles, selection);
    } else if (selection) { this.selection = selection; this.selectionPaper = undefined; this.renderContext(); }
  }
  private useContext(items: ItemRef[], titles: string[], selection?: Selection): void {
    this.contextEpoch++;
    this.context = items.map(r => ({ ...r })); this.titles = [...titles]; this.selection = selection; this.selectionPaper = undefined;
    this.renderContext();
  }
  refreshTitles(items: ItemRef[], titles: string[]): void {
    if (!this.disposed && items.length === this.context.length && items.every((r, i) => sameItem(r, this.context[i]))) {
      this.titles = [...titles]; this.renderContext();
    }
  }
  setSelectionPrompt(prompt: string): void { this.composer.value = prompt; this.composerChanged(); this.composer.focus(); }
  /** A new reading request can start beside a running conversation, without cancelling it. */
  openContext(items: ItemRef[], titles: string[], selection?: Selection): void {
    const changed = items.length !== this.context.length || items.some((item, i) => !sameItem(item, this.context[i]));
    const newSelection = selection && (selection.text !== this.selection?.text || !this.selection || !sameItem(selection.attachment, this.selection.attachment));
    if (this.conversation && (changed || (newSelection && this.research.busy(this.conversation.id)))) this.newChat();
    if (changed) this.useContext(items, titles, selection);
    else if (selection) { this.selection = selection; this.selectionPaper = undefined; this.renderContext(); }
  }
  session(): PanelSession { return { context: [...this.context], titles: [...this.titles], selection: this.selection, conversation: this.conversation, draft: this.composer.value }; }
  restoreSession(session: PanelSession): void {
    this.useContext(session.context, session.titles, session.selection);
    this.conversation = session.conversation; this.setSelectionPrompt(session.draft); this.renderMessages();
  }
  private renderContext(): void {
    const d = this.doc;
    this.contextRow.replaceChildren();
    for (const [index, item] of this.context.entries()) {
      const title = this.titles[index] || item.key;
      const chip = el(d, 'span', 'glossa-chip'); chip.title = title;
      chip.append(icon(d, 'file'), el(d, 'span', 'glossa-chip-text', title),
        iconButton(d, `${L('移除文献：', 'Remove paper: ')}${title}`, 'x', () => {
          this.contextEpoch++; this.context.splice(index, 1); this.titles.splice(index, 1);
          if (this.selection && this.context.length === 0) this.selection = undefined;
          this.renderContext();
        }, 'glossa-chip-remove'));
      this.contextRow.append(chip);
    }
    if (!this.context.length && !this.selection) this.contextRow.append(el(d, 'span', 'glossa-context-empty', L('未添加文献 · 仅根据问题回答', 'No papers attached · answering from the question only')));
    this.contextRow.hidden = !this.context.length && !!this.selection;
    this.renderSelection(); this.renderRecent();
  }
  /** The attached PDF selection, shown above the composer like the Obsidian edition's selection preview. */
  private renderSelection(): void {
    const d = this.doc; const card = this.selectionCard; const selection = this.selection;
    card.replaceChildren(); card.hidden = !selection;
    this.composer.placeholder = selection ? L('询问选中内容…  / 命令 · @ 添加文献', 'Ask about the selection…  / commands · @ add papers') : L('询问这篇文献…  / 命令 · @ 添加文献', 'Ask about this paper…  / commands · @ add papers');
    if (!selection) return;
    const text = selection.text.replace(/\s+/g, ' ').trim();
    const head = el(d, 'div', 'glossa-selection-head');
    head.append(el(d, 'span', 'glossa-selection-tag', L('PDF 选区', 'PDF selection')),
      el(d, 'span', 'glossa-selection-meta', [selection.pageLabel ? L(`第 ${selection.pageLabel} 页`, `p. ${selection.pageLabel}`) : '', L(`${[...selection.text].length} 字符`, `${[...selection.text].length} characters`)].filter(Boolean).join(' · ')));
    const body = el(d, 'div', 'glossa-selection-body');
    body.append(head, el(d, 'div', 'glossa-selection-text', text.slice(0, 600)));
    if (this.selectionPaper && !this.titles.includes(this.selectionPaper)) body.append(el(d, 'div', 'glossa-selection-paper', `${L('来自：', 'From: ')}${this.selectionPaper}`));
    card.title = selection.text.slice(0, 1200);
    card.append(body, iconButton(d, L('移除选区', 'Remove selection'), 'x', () => { this.selection = undefined; this.selectionPaper = undefined; this.renderContext(); }, 'glossa-selection-close'));
  }
  /** The reader selection was cleared. Keep it while the user is working in this panel, as the Obsidian edition does. */
  withdrawSelection(selection: Selection): void {
    if (this.disposed || this.selection !== selection) return;
    const active = this.doc.activeElement;
    if (active && active !== this.doc.body && this.root.contains(active)) return;
    this.selection = undefined; this.selectionPaper = undefined; this.renderContext();
  }
  /** A new selection in the reader; replaces the previous one without sending anything. */
  offerSelection(selection: Selection, paperTitle?: string): void {
    if (this.disposed) return;
    this.selection = selection; this.selectionPaper = paperTitle;
    this.renderContext();
  }
  /** On the start page, offer to continue recent conversations about the current papers. */
  private renderRecent(): void {
    const d = this.doc; this.recent.replaceChildren();
    if (!this.context.length) return;
    const related = this.research.store.state.conversations
      .filter(c => c.messages.length && c.items.some(item => this.context.some(r => sameItem(r, item))))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    if (!related.length) return;
    this.recent.append(el(d, 'div', 'glossa-section-title', L('继续之前的对话', 'Continue a previous chat')));
    for (const c of related) {
      const row = button(d, '', () => this.openConversation(c), 'glossa-recent-row');
      row.setAttribute('aria-label', `${L('继续对话：', 'Continue chat: ')}${c.title}`);
      row.append(icon(d, this.research.busy(c.id) ? 'loader' : 'message'), el(d, 'span', 'glossa-recent-title', c.title),
        el(d, 'span', 'glossa-recent-time', new Date(c.updatedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })));
      this.recent.append(row);
    }
  }
  private openConversation(c: Conversation): void {
    this.conversation = c; this.selection = undefined;
    const papers = c.messages.slice().reverse().find(m => m.sources.some(s => s.kind === 'metadata'))?.sources.filter(s => s.kind === 'metadata') || [];
    this.useContext(c.items, c.items.map(r => papers.find(s => sameItem(s.item, r))?.title || r.key));
    this.closeOverlay(); this.notify(''); this.renderMessages(); this.composer.focus();
  }
  private setMode(mode: Mode, persist = false): void {
    if (this.conversation && this.research.busy(this.conversation.id)) return;
    this.mode = mode;
    this.research.store.state.settings.runMode = mode;
    this.plan.setAttribute('aria-pressed', String(mode === 'plan')); this.act.setAttribute('aria-pressed', String(mode === 'act'));
    this.renderMessages();
    if (persist) { this.persist(); this.notify(mode === 'act' ? L('Act：回答可确认后保存为 Zotero 子笔记', 'Act: answers can be saved as Zotero child notes after confirmation') : L('Plan：只读分析，不写入 Zotero', 'Plan: read-only; nothing is written to Zotero')); }
  }
  private newChat(): void {
    this.conversation = undefined; this.selection = undefined;
    this.contextEpoch++; this.popover.close(false);
    this.composer.value = ''; this.notify(''); this.closeOverlay(); this.renderContext(); this.renderMessages(); this.composerChanged(); this.composer.focus();
  }

  // ── Sending ──────────────────────────────────────────────────────────────
  private submit(): void {
    if (this.conversation && this.research.busy(this.conversation.id)) { this.research.stop(this.conversation.id); return; }
    const draft = this.composer.value.trim(); if (!draft) return;
    if (this.ask(draft)) { this.composer.value = ''; this.composerChanged(); }
  }
  /** Starts a turn; returns false (keeping the draft) when configuration or the command is incomplete. */
  private ask(draft: string, prompt?: string): boolean {
    const endpoint = this.endpoint();
    if (!endpoint) { this.notify(L('请先选择或添加一个模型服务', 'Choose or add a model service first'), true); this.openModelMenu(); return false; }
    try { if (isCli(endpoint)) validateCli(endpoint); else validateEndpoint(endpoint); }
    catch (error) { this.showError(error); if (!isCli(endpoint) && !endpoint.model.trim()) this.openModelMenu(); return false; }
    let text: string;
    try { text = prompt ?? expandCommand(draft, !!this.selection, this.context.length); }
    catch (error) { this.showError(error); return false; }
    const command = findCommand(draft);
    if (!this.conversation) this.conversation = this.research.store.newConversation(this.context);
    const conversation = this.conversation;
    this.closeOverlay(); this.popover.close(false); this.notify('', true);
    const before = conversation.messages.length;
    const task = this.research.run(conversation, text, this.context, this.selection, endpoint, this.mode,
      message => { if (!this.disposed && this.conversation === conversation) this.notify(message, true); },
      { display: draft, title: command ? `${command.title} · ${this.titles[0] || L('文献', 'paper')}` : undefined });
    // A failure after the answer card exists is shown in that card; only earlier failures (e.g. reading the papers) need the notice line.
    void task.catch(error => { if (this.conversation === conversation && conversation.messages.length === before) this.showError(error); })
      .finally(() => {
        if (!this.disposed && this.conversation === conversation && !conversation.messages.length && !this.composer.value) { this.composer.value = draft; this.composerChanged(); }
      });
    this.renderMessages();
    return true;
  }

  // ── Messages ─────────────────────────────────────────────────────────────
  private renderMessages(): void {
    if (this.disposed) return;
    const current = this.conversation;
    const busy = !!current && this.research.busy(current.id);
    if (busy) {
      this.showingRun = current.id;
      const streamingCard = current.messages.at(-1)?.status === 'streaming';
      this.notify(streamingCard ? '' : this.research.status(current.id) || L('正在准备…', 'Preparing…'), true);
    } else if (this.showingRun) {
      if (current?.id === this.showingRun && current.messages.length) {
        // The answer card shows its own error or warning; repeating it under the messages only adds noise.
        if (current.messages.at(-1)?.role === 'assistant') this.notify('');
      }
      this.showingRun = '';
    }
    if (busy && !this.ticker) this.ticker = setInterval(() => this.tick(), 1000);
    if (!busy && this.ticker) { clearInterval(this.ticker); this.ticker = undefined; }
    const messages = current?.messages || [];
    const nearBottom = this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight < 80;
    for (const [id, view] of this.messageViews) {
      if (!messages.some(m => m.id === id)) { view.root.remove(); this.messageViews.delete(id); }
    }
    this.empty.hidden = !!messages.length;
    if (!messages.length) this.renderRecent();
    for (const message of messages) this.renderMessage(message, message === messages.at(-1));
    this.updateSend();
    if (nearBottom || busy) this.messages.scrollTop = this.messages.scrollHeight;
  }
  private renderMessage(message: Message, last: boolean): void {
    const d = this.doc;
    let view = this.messageViews.get(message.id);
    if (!view) {
      const row = el(d, 'article', `glossa-message glossa-${message.role}`);
      const body = el(d, 'div', message.role === 'user' ? 'glossa-bubble' : 'glossa-message-body');
      view = { root: row, body, text: '', state: '' };
      if (message.role === 'assistant') {
        const meta = el(d, 'div', 'glossa-message-meta');
        meta.append(icon(d, 'mark'), el(d, 'span', 'glossa-message-author', 'Glossa'));
        if (message.model) { const model = el(d, 'span', 'glossa-message-model', message.model); model.title = message.model; meta.append(model); }
        const reasoning = el(d, 'details', 'glossa-reasoning'); reasoning.hidden = true;
        const summary = el(d, 'summary', 'glossa-reasoning-summary'); const label = el(d, 'span', '', L('思考过程', 'Thinking'));
        summary.append(label); const reasoningBody = el(d, 'div', 'glossa-reasoning-body');
        reasoning.append(summary, reasoningBody);
        const current = view;
        // Open/close changes we did not make ourselves are the user's choice; respect it from then on.
        reasoning.addEventListener('toggle', () => { if (reasoning.open !== current.reasoningAuto) current.reasoningPinned = true; });
        const activity = el(d, 'div', 'glossa-activity'); const activityLabel = el(d, 'span', 'glossa-activity-label'); const activityTime = el(d, 'span', 'glossa-activity-time');
        activity.append(el(d, 'span', 'glossa-activity-dot'), activityLabel, activityTime);
        Object.assign(view, { reasoning, reasoningBody, reasoningLabel: label, activity, activityLabel, activityTime });
        view.notice = el(d, 'div', 'glossa-message-notice'); view.actions = el(d, 'div', 'glossa-message-actions');
        view.sources = el(d, 'div', 'glossa-sources'); view.sources.hidden = true;
        row.append(meta, reasoning, body, activity, view.notice, view.actions, view.sources);
      } else row.append(body);
      this.messages.append(row); this.messageViews.set(message.id, view);
    }
    const state = `${message.status}/${this.mode}/${message.noteRef?.key || ''}/${message.warning || ''}/${message.sources.length}/${last}`;
    if (message.role === 'user') {
      if (view.text !== (message.display || message.text)) { view.text = message.display || message.text; view.body.textContent = view.text; view.body.title = message.display ? message.text : ''; }
      return;
    }
    const streaming = message.status === 'streaming';
    this.renderReasoning(view, message);
    this.renderActivity(view, message);
    if (view.text !== message.text || view.state !== state) {
      if (message.text) {
        const answer = renderAnswer(d, message.text, message.sources, s => void this.action(() => this.research.host.openSource(s)));
        view.body.replaceChildren(answer);
        if (streaming) {
          // Keep the typing caret at the end of the last line of text, not on a line of its own.
          let tail: Element = answer;
          while (tail.lastElementChild && /^(p|li|h3|h4|blockquote|ul|ol|div|table|tbody|tr|td|th)$/i.test(tail.lastElementChild.tagName)
            && !tail.lastElementChild.className.includes('glossa-math')) tail = tail.lastElementChild;
          tail.append(el(d, 'span', 'glossa-caret'));
        }
      } else if (message.status === 'complete' && !message.reasoning) view.body.replaceChildren(el(d, 'span', 'glossa-muted', L('没有收到正文', 'No answer received')));
      else view.body.replaceChildren();
      view.text = message.text;
    }
    if (view.state === state) return;
    view.state = state;
    const { notice, actions, sources } = view as Required<MessageView>;
    notice.replaceChildren(); actions.replaceChildren();
    const problem = message.status === 'error' || message.status === 'stopped';
    if (!streaming && (message.warning || problem)) {
      notice.append(icon(d, message.status === 'error' ? 'alert' : 'info'),
        el(d, 'span', '', message.status === 'stopped' && !message.warning ? L('回答未完成', 'Incomplete answer') : message.warning || L('回答未完成', 'Incomplete answer')));
    }
    notice.hidden = !notice.childElementCount;
    setClass(notice, 'glossa-error', message.status === 'error');
    if (streaming) { actions.hidden = true; return; }
    actions.hidden = false;
    if (message.text && this.research.host.copyText) actions.append(iconButton(d, L('复制', 'Copy'), 'copy', () => {
      this.research.host.copyText?.(message.text); this.notify(L('已复制回答', 'Answer copied'));
    }));
    if (message.status === 'complete' && message.sources.length) {
      const saved = !!message.noteRef;
      const note = labelButton(d, saved ? L('已保存为笔记', 'Saved as note') : L('保存为笔记', 'Save as note'), saved ? 'check' : 'note', () => {
        if (message.noteRef) void this.action(async () => { await this.research.host.showItem?.(message.noteRef as ItemRef); });
        else this.showNote(message);
      }, 'glossa-ghost');
      note.title = saved ? L('在 Zotero 中查看这条笔记', 'Show this note in Zotero') : L('预览后保存为所选文献的子笔记', 'Preview, then save as a child note of the paper');
      note.disabled = saved && !this.research.host.showItem;
      actions.append(note);
    }
    if (problem && last) actions.append(labelButton(d, L('重试', 'Retry'), 'retry', () => this.retry(message), 'glossa-ghost'));
    if (message.sources.length) {
      const toggle = labelButton(d, L(`${message.sources.length} 个来源`, `${message.sources.length} sources`), 'bookmark', () => {
        sources.hidden = !sources.hidden; toggle.setAttribute('aria-expanded', String(!sources.hidden));
      }, 'glossa-ghost glossa-sources-toggle');
      toggle.setAttribute('aria-expanded', String(!sources.hidden));
      actions.append(toggle);
      sources.replaceChildren(...message.sources.map(source => {
        const entry = el(d, 'div', 'glossa-source');
        const head = button(d, '', () => void this.action(() => this.research.host.openSource(source)), 'glossa-source-link');
        head.title = `${L('打开来源：', 'Open source: ')}${source.title}${source.pageLabel ? ` · p. ${source.pageLabel}` : ''}`;
        head.append(el(d, 'span', 'glossa-source-id', source.id), el(d, 'span', 'glossa-source-title', `${source.title}${source.pageLabel ? ` · p. ${source.pageLabel}` : ''}`),
          el(d, 'span', 'glossa-source-kind', { metadata: L('条目信息', 'Item info'), selection: L('选区', 'Selection'), annotation: L('批注', 'Annotation'), fulltext: L('正文', 'Full text'), note: L('笔记', 'Note') }[source.kind]));
        entry.append(head, el(d, 'p', '', source.text.slice(0, 280) + (source.text.length > 280 ? '…' : '')));
        return entry;
      }));
    }
  }
  /** Visible thinking: open while the model is still thinking, folded once the answer starts. */
  private renderReasoning(view: MessageView, message: Message): void {
    const { reasoning, reasoningBody, reasoningLabel } = view;
    if (!reasoning || !reasoningBody || !reasoningLabel) return;
    const text = message.reasoning || '';
    reasoning.hidden = !text;
    if (!text) return;
    const thinking = message.status === 'streaming' && !message.text;
    if (view.reasoningText !== text) {
      const follow = reasoningBody.scrollHeight - reasoningBody.scrollTop - reasoningBody.clientHeight < 40;
      reasoningBody.textContent = text; view.reasoningText = text;
      if (thinking && follow) reasoningBody.scrollTop = reasoningBody.scrollHeight;
    }
    reasoningLabel.textContent = thinking ? L(`思考中 · ${[...text].length.toLocaleString()} 字`, `Thinking · ${[...text].length.toLocaleString()} chars`)
      : L(`思考过程 · ${[...text].length.toLocaleString()} 字`, `Thought process · ${[...text].length.toLocaleString()} chars`);
    setClass(reasoning, 'glossa-thinking-live', thinking);
    if (!view.reasoningPinned && view.reasoningAuto !== thinking) { view.reasoningAuto = thinking; reasoning.open = thinking; }
  }
  /** The live "still working" line: phase and elapsed time, only while the reply streams. */
  private renderActivity(view: MessageView, message: Message): void {
    const { activity, activityLabel, activityTime } = view;
    if (!activity || !activityLabel || !activityTime) return;
    const streaming = message.status === 'streaming' && !!this.conversation && this.research.busy(this.conversation.id);
    activity.hidden = !streaming;
    if (!streaming) return;
    activityLabel.textContent = this.research.status(this.conversation?.id || '') || (message.text ? L('正在回答…', 'Answering…') : message.reasoning ? L('思考中…', 'Thinking…') : L('等待模型响应…', 'Waiting for the model…'));
    const seconds = Math.max(0, Math.round((Date.now() - message.createdAt) / 1000));
    activityTime.textContent = seconds >= 1 ? `${seconds}s` : '';
  }
  private tick(): void {
    const message = this.conversation?.messages.at(-1);
    const view = message && this.messageViews.get(message.id);
    if (message && view && message.status === 'streaming') this.renderActivity(view, message);
  }
  private retry(message: Message): void {
    const messages = this.conversation?.messages || [];
    const previous = messages[messages.indexOf(message) - 1];
    if (previous?.role !== 'user' || (this.conversation && this.research.busy(this.conversation.id))) return;
    this.ask(previous.display || previous.text, previous.display ? previous.text : undefined);
  }

  // ── Sheets ───────────────────────────────────────────────────────────────
  private openOverlay(title: string, back?: () => void): HTMLElement {
    const wasOpen = !this.overlay.hidden;
    const focus = wasOpen ? this.overlayFocus : this.doc.activeElement as HTMLElement | null;
    this.closeOverlay(false);
    this.overlayFocus = focus;
    this.overlay.hidden = false; this.commandMenu.hidden = true; this.popover.close(false);
    this.overlay.setAttribute('aria-label', title);
    const header = el(this.doc, 'div', 'glossa-overlay-header');
    if (back) header.append(iconButton(this.doc, L('返回', 'Back'), 'arrowLeft', back));
    header.append(el(this.doc, 'h3', '', title), iconButton(this.doc, L('关闭', 'Close'), 'x', () => this.closeOverlay()));
    this.overlayError = status(this.doc); this.overlayError.className += ' glossa-error';
    const body = el(this.doc, 'div', 'glossa-overlay-body');
    this.overlay.append(header, this.overlayError, body);
    (header.querySelector?.<HTMLElement>('button') || header.children[0] as HTMLElement | undefined)?.focus?.();
    return body;
  }
  private closeOverlay(restoreFocus = true): void {
    this.overlayVersion++;
    this.refreshHistory = undefined;
    this.controllers.forEach(c => c.abort()); this.controllers.clear();
    this.overlay.hidden = true; this.overlay.replaceChildren();
    this.overlayError = undefined;
    if (restoreFocus) {
      if (!this.disposed && this.overlayFocus?.isConnected) this.overlayFocus.focus();
      this.overlayFocus = null;
    }
  }
  private sheetHost(): SheetHost {
    return {
      doc: this.doc, research: this.research, fetcher: this.fetcher, popover: this.popover,
      open: (title, back) => this.openOverlay(title, back),
      close: () => this.closeOverlay(),
      version: () => this.overlayVersion,
      error: text => { if (this.overlayError) this.overlayError.textContent = text; },
      persist: () => this.persist(),
      track: controller => { this.controllers.add(controller); return () => this.controllers.delete(controller); },
      refresh: () => { this.updateSelectors(); this.autoCliCatalog(); },
    };
  }
  showSettings(view = 'general'): void {
    const workspace = !!this.options.workspace;
    const move = !workspace ? { label: L('在独立窗口中打开当前对话', 'Open this chat in a separate window'), run: () => this.options.openWorkspace(this.context, this.selection, this.session()) }
      : this.options.openSidebar ? { label: L('把当前对话移回侧栏', 'Move this chat back to the sidebar'), run: () => this.options.openSidebar?.(this.context, this.selection, this.session()) } : undefined;
    const host: SettingsHost = { ...this.sheetHost(), move, relocalize: this.options.relocalize ? () => this.options.relocalize?.(this) : undefined };
    showSettings(host, view);
  }
  private showHistory(): void {
    const host: HistoryHost = { ...this.sheetHost(),
      current: () => this.conversation,
      openConversation: c => this.openConversation(c),
      forget: () => { this.conversation = undefined; this.renderMessages(); },
      notify: text => this.notify(text),
      action: task => this.action(task),
      watch: render => { this.refreshHistory = render; },
    };
    showHistory(host);
  }
  private showNote(message: Message): void {
    const d = this.doc;
    const area = this.openOverlay(L('保存为 Zotero 笔记', 'Save as Zotero note'));
    const title = input(d, L('笔记标题', 'Note title'), this.conversation?.title || L('Glossa 研究笔记', 'Glossa research note'));
    const refs: ItemRef[] = []; const names: string[] = [];
    for (const source of message.sources) if (!refs.some(r => sameItem(r, source.item))) { refs.push(source.item); names.push(source.title); }
    const target = el(d, 'select'); target.setAttribute('aria-label', L('目标文献', 'Target paper'));
    refs.forEach((_, index) => target.append(option(d, names[index], String(index))));
    const preview = el(d, 'div', 'glossa-note-preview');
    preview.append(renderAnswer(d, message.text, message.sources, s => void this.action(() => this.research.host.openSource(s))));
    const result = status(d);
    const view = labelButton(d, L('在 Zotero 中查看', 'Show in Zotero'), 'window', () => void this.action(async () => {
      if (message.noteRef) await this.research.host.showItem?.(message.noteRef);
    }), 'glossa-secondary');
    view.hidden = true;
    const save = button(d, '', () => {
      if (this.mode !== 'act') this.setMode('act', true);
      save.disabled = true; result.textContent = L('正在创建…', 'Creating…');
      void (async () => {
        try {
          await this.research.saveAsNote(message, refs[Number(target.value)], title.value.trim() || L('Glossa 研究笔记', 'Glossa research note'), this.mode);
          result.textContent = L(`已保存为「${names[Number(target.value)]}」的子笔记。`, `Saved as a child note of “${names[Number(target.value)]}”.`);
          save.hidden = true; explain.hidden = true; view.hidden = !this.research.host.showItem;
        } catch (error) { result.textContent = errorMessage(error); save.disabled = !!message.noteRef; }
      })();
    }, 'glossa-primary');
    save.textContent = this.mode === 'act' ? L('确认创建子笔记', 'Create child note') : L('切换到 Act 并创建', 'Switch to Act and create');
    const actions = el(d, 'div', 'glossa-actions-row'); actions.append(save, view);
    const explain = el(d, 'p', 'glossa-muted', this.mode === 'act' ? L('将创建一条新的子笔记并保留可点击的来源链接，不会修改已有笔记。', 'Creates a new child note with clickable source links; existing notes are not changed.')
      : L('当前为 Plan（只读）模式；确认后会切换到 Act 并创建新的子笔记，不会修改已有笔记。', 'You are in Plan (read-only) mode; confirming switches to Act and creates a new child note. Existing notes are not changed.'));
    const targetField = el(d, 'label', 'glossa-field'); targetField.append(el(d, 'span', 'glossa-field-label', L('保存到', 'Save to')), target);
    const titleField = el(d, 'label', 'glossa-field'); titleField.append(el(d, 'span', 'glossa-field-label', L('笔记标题', 'Note title')), title);
    area.append(titleField, targetField, el(d, 'div', 'glossa-field-label', L('预览', 'Preview')), preview, explain, result, actions);
  }
  dispose(): void {
    this.disposed = true; this.unsubscribe(); this.popover.close(false); this.closeOverlay(false);
    clearTimeout(this.noticeTimer); if (this.ticker) clearInterval(this.ticker);
    this.controllers.forEach(c => c.abort()); this.controllers.clear();
    this.catalogs.forEach(c => c.abort()); this.catalogs.clear();
    // Research owns running requests; closing a view must not cancel them.
    this.root.remove();
  }
}

