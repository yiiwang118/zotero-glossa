import { L } from '../core/i18n';
import type { Research } from '../core/research';
import type { Selection } from '../core/types';
import { errorMessage, isCli } from '../core/types';
import { button, el, iconButton, input, labelButton, option, setClass, status } from './dom';
import { icon } from './icons';
import { renderAnswer } from './markdown';

interface TranslationOptions {
  configure(): void;
  openChat(selection: Selection): void;
  closed(): void;
}

/** Lives beside the reader's native selection popup without resizing its selection or toolbar. */
export class SelectionTranslation {
  readonly root: HTMLElement;
  private output: HTMLElement;
  private feedback: HTMLElement;
  private provider: HTMLSelectElement;
  private stop: HTMLButtonElement;
  private copy: HTMLButtonElement;
  private retry: HTMLButtonElement;
  private automatic: HTMLInputElement;
  private controller?: AbortController;
  private text = '';
  private disposed = false;
  private unsubscribe: () => void;
  private keydown = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); this.close(); } };
  private unload = (): void => this.close();

  constructor(private doc: Document, private research: Research, private selection: Selection,
    anchor: { left: number; top: number; bottom: number }, private options: TranslationOptions) {
    const root = this.root = el(doc, 'section', 'glossa-panel glossa-translation');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', L('Glossa 快速翻译', 'Glossa quick translation'));
    root.tabIndex = -1;
    for (const event of ['pointerdown', 'mousedown', 'click']) root.addEventListener(event, e => e.stopPropagation());
    const head = el(doc, 'div', 'glossa-translation-head');
    const brand = el(doc, 'div', 'glossa-translation-brand'); brand.append(icon(doc, 'mark'), el(doc, 'strong', '', L('Glossa 翻译', 'Glossa Translate')));
    const automatic = el(doc, 'label', 'glossa-auto-translate'); automatic.title = L('开启后，每次在 PDF 中选中文字都会自动翻译', 'When on, every selection in the PDF is translated automatically');
    this.automatic = input(doc, L('划词后自动翻译', 'Translate selections automatically'), '', 'checkbox'); this.automatic.className = 'glossa-switch'; this.automatic.setAttribute('role', 'switch');
    this.automatic.addEventListener('change', () => {
      research.store.state.settings.autoTranslate = this.automatic.checked;
      void research.store.save().catch(error => { if (!this.disposed) this.feedback.textContent = errorMessage(error); });
    });
    automatic.append(el(doc, 'span', '', L('自动', 'Auto')), this.automatic);
    head.append(brand, automatic, iconButton(doc, L('翻译设置', 'Translation settings'), 'cog', () => options.configure()), iconButton(doc, L('关闭翻译', 'Close translation'), 'x', () => this.close()));
    const quote = el(doc, 'details', 'glossa-translation-source');
    const characters = [...selection.text].length;
    quote.append(el(doc, 'summary', '', L(`原文 · ${characters} 字符${selection.pageLabel ? ` · 第 ${selection.pageLabel} 页` : ''}`, `Original · ${characters} characters${selection.pageLabel ? ` · p. ${selection.pageLabel}` : ''}`)), el(doc, 'p', '', selection.text));
    this.output = el(doc, 'div', 'glossa-translation-output'); this.output.setAttribute('aria-label', L('译文', 'Translation')); this.output.setAttribute('aria-live', 'polite');
    this.feedback = status(doc);
    this.provider = el(doc, 'select'); this.provider.setAttribute('aria-label', L('翻译模型服务', 'Translation service'));
    this.provider.addEventListener('change', () => {
      research.store.state.settings.translationEndpointID = this.provider.value;
      void research.store.save().catch(error => { if (!this.disposed) this.feedback.textContent = errorMessage(error); });
      void this.run();
    });
    this.stop = iconButton(doc, L('停止翻译', 'Stop translating'), 'stop', () => this.controller?.abort());
    this.copy = iconButton(doc, L('复制译文', 'Copy translation'), 'copy', () => {
      research.host.copyText?.(this.text); this.feedback.textContent = L('译文已复制', 'Translation copied');
    });
    this.retry = button(doc, L('重试', 'Retry'), () => { void this.run(); }, 'glossa-ghost');
    const ask = labelButton(doc, L('询问', 'Ask'), 'message', () => { options.openChat(selection); this.close(); }, 'glossa-translation-ask');
    ask.title = L('携带这段原文进入 Glossa 对话继续提问', 'Continue in a Glossa chat with this passage');
    const tools = el(doc, 'div', 'glossa-translation-footer');
    tools.append(this.provider, this.stop, this.retry, this.copy, ask);
    root.append(head, quote, this.output, this.feedback, tools);
    const view = doc.defaultView;
    const viewWidth = view?.innerWidth || 600; const viewHeight = view?.innerHeight || 700;
    const width = Math.min(420, Math.max(260, viewWidth - 24));
    root.style.width = `${width}px`;
    root.style.left = `${Math.max(12, Math.min(anchor.left, viewWidth - width - 12))}px`;
    // Open below the selection popup when there is room; otherwise anchor the bottom edge above it so streamed text
    // grows upward. Either way the height is capped to the space available, so it never leaves the page.
    const below = viewHeight - anchor.bottom - 20; const above = anchor.top - 20;
    if (below >= 220 || below >= above) {
      root.style.top = `${Math.min(anchor.bottom + 8, viewHeight - 12 - Math.min(160, below))}px`;
      root.style.maxHeight = `${Math.max(140, Math.min(420, below))}px`;
    } else {
      root.style.bottom = `${viewHeight - anchor.top + 8}px`;
      root.style.maxHeight = `${Math.min(420, above)}px`;
    }
    (doc.body || doc.documentElement).append(root);
    doc.addEventListener('keydown', this.keydown, true); view?.addEventListener('unload', this.unload, { once: true });
    this.unsubscribe = research.store.subscribe(() => this.refreshProviders()); this.refreshProviders();
    void this.run();
  }
  private refreshProviders(): void {
    const settings = this.research.store.state.settings;
    this.automatic.checked = settings.autoTranslate === true;
    // CLIs are always listed in settings, but only ones the user detected or chose are ready to translate.
    const usable = settings.endpoints.filter(e => !isCli(e) || (this.research.processes
      && (e.cliModels?.length || e.model || (settings.transport === 'cli' && e.id === settings.endpointID) || e.id === settings.translationEndpointID)));
    const selected = this.provider.value || settings.translationEndpointID || settings.endpointID;
    this.provider.replaceChildren(...usable.map(e => option(this.doc, `${e.name} · ${e.model || L('默认模型', 'default model')}`, e.id)));
    if (!usable.length) this.provider.append(option(this.doc, L('尚未配置模型服务', 'No model service configured'), ''));
    this.provider.value = usable.some(e => e.id === selected) ? selected : usable.find(e => e.id === settings.endpointID)?.id || usable[0]?.id || '';
  }
  private busy(running: boolean): void {
    this.stop.hidden = !running; this.retry.hidden = running; setClass(this.root, 'glossa-running', running);
  }
  private async run(): Promise<void> {
    this.controller?.abort();
    const controller = this.research.host.controller(); this.controller = controller;
    const endpoint = this.research.store.state.settings.endpoints.find(e => e.id === this.provider.value);
    this.text = ''; this.output.replaceChildren(); this.copy.disabled = true; this.busy(false);
    if (!endpoint || (!isCli(endpoint) && !endpoint.model.trim())) {
      this.feedback.textContent = L('先配置 API 或选择已登录的本机 CLI，再点“重试”即可翻译。', 'Set up an API, or choose a signed-in local CLI, then press Retry.');
      this.output.append(button(this.doc, L('配置模型服务', 'Set up a model service'), () => this.options.configure(), 'glossa-primary')); return;
    }
    this.feedback.textContent = ''; this.busy(true);
    const phase = el(this.doc, 'span', '', isCli(endpoint) ? L(`正在启动 ${endpoint.name}…`, `Starting ${endpoint.name}…`) : L(`正在连接 ${endpoint.name}…`, `Connecting to ${endpoint.name}…`));
    const thinking = el(this.doc, 'span', 'glossa-thinking'); thinking.append(icon(this.doc, 'loader'), phase);
    this.output.append(thinking);
    const phases = { connected: L('已连接，等待译文…', 'Connected, waiting for the translation…'), queued: L('服务排队中，保持连接等待…', 'Queued by the service, keeping the connection…'), thinking: L('模型正在思考…', 'The model is thinking…'), retrying: L('连接不稳定，正在重试…', 'Connection unstable, retrying…') };
    let lastRender = 0;
    const render = (): void => { if (this.text) this.output.replaceChildren(renderAnswer(this.doc, this.text, [], () => undefined)); };
    try {
      await this.research.translate(this.selection, endpoint, controller.signal, chunk => {
        if (this.disposed || this.controller !== controller) return;
        this.text += chunk;
        if (Date.now() - lastRender > 60) { render(); lastRender = Date.now(); }
      }, next => { if (!this.disposed && this.controller === controller && !this.text) phase.textContent = phases[next]; });
      if (!this.disposed && this.controller === controller) this.feedback.textContent = `${L('已翻译', 'Translated')} · ${endpoint.model || endpoint.name}`;
    } catch (error) {
      if (!this.disposed && this.controller === controller) this.feedback.textContent = controller.signal.aborted ? L('已停止，可点“重试”重新翻译', 'Stopped; press Retry to translate again') : errorMessage(error);
    } finally {
      if (!this.disposed && this.controller === controller) {
        if (this.text) render(); else this.output.replaceChildren();
        this.busy(false); this.copy.disabled = !this.text;
      }
    }
  }
  close(): void {
    if (this.disposed) return;
    this.disposed = true; this.controller?.abort(); this.unsubscribe();
    this.doc.removeEventListener('keydown', this.keydown, true); this.doc.defaultView?.removeEventListener('unload', this.unload);
    this.root.remove(); this.options.closed();
  }
}
