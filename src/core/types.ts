import { L } from './i18n';
export type ApiStyle = 'openai' | 'anthropic';
export type Mode = 'plan' | 'act';
export type CliKind = 'codex' | 'claude' | 'grok';
export interface CliModel { id: string; label: string; efforts: string[]; defaultEffort?: string; isDefault: boolean }
export interface Endpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiStyle: ApiStyle;
  model: string;
  models: string[];
  encryptedKey: string;
  effort: string;
  kind?: 'api' | CliKind;
  binaryPath?: string;
  proxy?: string;
  cliModels?: CliModel[];
  /** Anthropic Messages output ceiling; empty uses DEFAULT_MAX_TOKENS. */
  maxTokens?: number;
}
export interface ItemRef { libraryID: number; key: string }
export interface Source {
  id: string;
  item: ItemRef;
  title: string;
  kind: 'metadata' | 'selection' | 'annotation' | 'fulltext' | 'note';
  text: string;
  attachmentKey?: string;
  annotationKey?: string;
  pageIndex?: number;
  pageLabel?: string;
}
export interface ContextSnapshot {
  items: ItemRef[];
  titles: string[];
  sources: Source[];
  warnings: string[];
}
export interface Selection {
  attachment: ItemRef;
  text: string;
  pageIndex?: number;
  pageLabel?: string;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** What the user typed (e.g. a slash command) when `text` holds the expanded prompt. */
  display?: string;
  /** The model's visible thinking, shown separately and never sent back as context. */
  reasoning?: string;
  sources: Source[];
  status: 'complete' | 'streaming' | 'stopped' | 'error';
  createdAt: number;
  model?: string;
  noteRef?: ItemRef;
  warning?: string;
}
export interface Conversation {
  id: string;
  title: string;
  folderID: string;
  items: ItemRef[];
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}
export interface Folder { id: string; name: string }
export interface State {
  version: 1;
  settings: { endpoints: Endpoint[]; endpointID: string; language: string; includeFulltext: boolean; transport?: 'api' | 'cli'; runMode?: Mode; apiEndpointID?: string; cliEndpointID?: string; openMode?: 'sidebar' | 'window'; autoTranslate?: boolean; translationEndpointID?: string;
    /** Show the current PDF selection above the composer (default on). */ attachSelection?: boolean;
    /** Interface language; 'auto' follows Zotero. */ uiLanguage?: 'auto' | 'zh' | 'en' };
  folders: Folder[];
  conversations: Conversation[];
}
export interface StoragePort { read(): Promise<string | null>; write(value: string): Promise<void> }
export interface ResearchHost {
  snapshot(items: ItemRef[], selection: Selection | undefined, fulltext: boolean, signal: AbortSignal): Promise<ContextSnapshot>;
  openSource(source: Source): Promise<void>;
  saveNote(target: ItemRef, html: string): Promise<ItemRef>;
  sourceURL(source: Source): string;
  decrypt(value: string): Promise<string>;
  encrypt(value: string): Promise<string>;
  controller(): AbortController;
  copyText?(text: string): void;
  exportFile?(name: string, text: string): Promise<void>;
  importFile?(): Promise<string | null>;
  pickItems?(): Promise<{ item: ItemRef; title: string }[]>;
  showItem?(target: ItemRef): Promise<void>;
}
export const isCli = (endpoint: Endpoint): boolean => !!endpoint.kind && endpoint.kind !== 'api';
export const CLI_TOOLS: readonly { kind: CliKind; name: string }[] = [
  { kind: 'codex', name: 'Codex' }, { kind: 'claude', name: 'Claude Code' }, { kind: 'grok', name: 'Grok' },
];
/** Local CLIs need no setup beyond installation, so every supported tool is always listed. */
export function ensureCliEndpoints(settings: State['settings']): boolean {
  let added = false;
  for (const { kind, name } of CLI_TOOLS) if (!settings.endpoints.some(e => e.kind === kind)) {
    settings.endpoints.push({ id: uid(), name, kind, baseUrl: '', apiStyle: 'openai', model: '', models: [], encryptedKey: '', effort: '' });
    added = true;
  }
  return added;
}
export const uid = (): string => crypto.randomUUID();
export const emptyState = (): State => ({
  version: 1,
  settings: { endpoints: [], endpointID: '', language: '', includeFulltext: true },
  folders: [], conversations: [],
});
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function str(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function itemRef(value: unknown): ItemRef {
  const r = record(value);
  if (!Number.isSafeInteger(r.libraryID) || Number(r.libraryID) < 1 || !/^[A-Z0-9]{8}$/.test(str(r.key))) {
    throw new Error(L('文献标识无效', 'Invalid item reference'));
  }
  return { libraryID: Number(r.libraryID), key: str(r.key) };
}
export function sameItem(a: ItemRef, b: ItemRef): boolean { return a.libraryID === b.libraryID && a.key === b.key; }
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : L('操作失败，请重试', 'Something went wrong. Please try again.');
}
