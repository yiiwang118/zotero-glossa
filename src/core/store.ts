import { L } from './i18n';
import { emptyState, itemRef, record, str, uid } from './types';
import type { CliKind, Conversation, Endpoint, Message, Source, State, StoragePort } from './types';

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(L('历史文件结构不完整', 'The history file is incomplete'));
  return value;
}
function id(value: unknown): string {
  if (!str(value)) throw new Error(L('历史文件缺少标识', 'The history file is missing an ID'));
  return str(value);
}
function sources(value: unknown): Source[] {
  return array(value).map(v => {
    const s = record(v);
    if (!['metadata', 'selection', 'annotation', 'fulltext', 'note'].includes(str(s.kind))) throw new Error(L('来源类型无效', 'Invalid source type'));
    return {
      id: id(s.id), item: itemRef(s.item), title: str(s.title), kind: s.kind as Source['kind'], text: str(s.text),
      ...(s.attachmentKey ? { attachmentKey: itemRef({ libraryID: record(s.item).libraryID, key: s.attachmentKey }).key } : {}),
      ...(s.annotationKey ? { annotationKey: itemRef({ libraryID: record(s.item).libraryID, key: s.annotationKey }).key } : {}),
      ...(Number.isSafeInteger(s.pageIndex) && Number(s.pageIndex) >= 0 ? { pageIndex: Number(s.pageIndex) } : {}),
      ...(s.pageLabel ? { pageLabel: str(s.pageLabel) } : {}),
    };
  });
}
export function parseState(text: string): State {
  const raw = record(JSON.parse(text));
  if (raw.version !== 1) throw new Error(L('不支持此版本的历史文件，请保留文件并升级插件', 'This history file comes from a newer version. Keep the file and update the plugin.'));
  const settings = record(raw.settings);
  const endpoints: Endpoint[] = array(settings.endpoints).map(value => {
    const e = record(value);
    if (e.apiStyle !== 'openai' && e.apiStyle !== 'anthropic') throw new Error(L('API 协议无效', 'Invalid API protocol'));
    return { id: id(e.id), name: str(e.name), baseUrl: str(e.baseUrl), apiStyle: e.apiStyle,
      model: str(e.model), models: array(e.models).map(str).filter(Boolean), encryptedKey: str(e.encryptedKey), effort: str(e.effort),
      kind: ['codex', 'claude', 'grok'].includes(str(e.kind)) ? e.kind as CliKind : 'api', binaryPath: str(e.binaryPath), proxy: str(e.proxy),
      cliModels: Array.isArray(e.cliModels) ? e.cliModels.map(v => { const m = record(v); return {
        id: str(m.id), label: str(m.label), efforts: Array.isArray(m.efforts) ? m.efforts.map(str).filter(Boolean) : [],
        defaultEffort: str(m.defaultEffort), isDefault: m.isDefault === true,
      }; }).filter(m => m.id) : [],
      ...(Number.isSafeInteger(e.maxTokens) && Number(e.maxTokens) >= 256 && Number(e.maxTokens) <= 1_000_000 ? { maxTokens: Number(e.maxTokens) } : {}) };
  });
  const folders = array(raw.folders).map(v => ({ id: id(record(v).id), name: str(record(v).name) }));
  const conversations: Conversation[] = array(raw.conversations).map(v => {
    const c = record(v);
    const messages: Message[] = array(c.messages).map(v => {
      const m = record(v);
      if (m.role !== 'user' && m.role !== 'assistant') throw new Error(L('历史消息角色无效', 'Invalid message role in history'));
      return { id: id(m.id), role: m.role, text: str(m.text), ...(str(m.display) ? { display: str(m.display) } : {}),
        ...(str(m.reasoning) ? { reasoning: str(m.reasoning) } : {}), sources: sources(m.sources),
        status: m.status === 'streaming' ? 'stopped' : m.status === 'complete' ? 'complete' : m.status === 'error' ? 'error' : 'stopped',
        createdAt: Number(m.createdAt) || 0, model: str(m.model), warning: str(m.warning), ...(m.noteRef ? { noteRef: itemRef(m.noteRef) } : {}) };
    });
    if (new Set(messages.map(m => m.id)).size !== messages.length) throw new Error(L('历史消息含重复标识', 'History contains duplicate message IDs'));
    return { id: id(c.id), title: str(c.title), folderID: folders.some(f => f.id === c.folderID) ? str(c.folderID) : '',
      items: array(c.items).map(itemRef), messages, createdAt: Number(c.createdAt) || 0, updatedAt: Number(c.updatedAt) || 0 };
  });
  for (const list of [folders, conversations, endpoints]) {
    if (new Set(list.map(x => x.id)).size !== list.length) throw new Error(L('历史文件含重复标识', 'History contains duplicate IDs'));
  }
  // Before 0.1.1 '简体中文' was stored as the default, so it cannot be told apart from a choice; let it follow the interface.
  const language = settings.uiLanguage === undefined && settings.language === '简体中文' ? '' : str(settings.language);
  return { version: 1, settings: { endpoints, endpointID: str(settings.endpointID), language,
    includeFulltext: settings.includeFulltext === true, transport: settings.transport === 'cli' ? 'cli' : 'api',
    runMode: settings.runMode === 'act' ? 'act' : 'plan', apiEndpointID: str(settings.apiEndpointID), cliEndpointID: str(settings.cliEndpointID),
    openMode: settings.openMode === 'window' ? 'window' : 'sidebar', autoTranslate: settings.autoTranslate === true, attachSelection: settings.attachSelection !== false,
    uiLanguage: settings.uiLanguage === 'zh' || settings.uiLanguage === 'en' ? settings.uiLanguage : 'auto',
    translationEndpointID: str(settings.translationEndpointID) }, folders, conversations };
}

/** One writer for all windows. A failed write does not poison subsequent writes. */
export class Store {
  state = emptyState();
  private tail: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private storage: StoragePort) {}
  async load(): Promise<void> {
    const raw = await this.storage.read();
    if (raw !== null) this.state = parseState(raw); // Never replace an unreadable file with empty history.
  }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  changed(): void { this.listeners.forEach(callback => callback()); }
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.state);
    this.changed();
    const write = this.tail.catch(() => undefined).then(() => this.storage.write(snapshot));
    this.tail = write;
    return write;
  }
  async flush(): Promise<void> { await this.tail; }
  newConversation(items: Conversation['items'] = []): Conversation {
    const c: Conversation = { id: uid(), title: L('新对话', 'New chat'), folderID: '', items: structuredCopy(items), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.state.conversations.unshift(c);
    this.changed();
    return c;
  }
  removeFolder(folderID: string): void {
    this.state.folders = this.state.folders.filter(f => f.id !== folderID);
    this.state.conversations.forEach(c => { if (c.folderID === folderID) c.folderID = ''; });
    this.changed();
  }
}
export function structuredCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
