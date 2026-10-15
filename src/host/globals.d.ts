interface ZoteroItem {
  id: number; key: string; libraryID: number; parentID: number | false; parentKey: string | false;
  deleted: boolean; attachmentContentType: string;
  annotationText: string; annotationComment: string; annotationPageLabel: string; annotationPosition: string;
  isRegularItem(): boolean; isAttachment(): boolean; isNote(): boolean; isAnnotation(): boolean; isPDFAttachment(): boolean;
  isEPUBAttachment(): boolean; isSnapshotAttachment(): boolean;
  readonly attachmentText: Promise<string>;
  getBestAttachments(): Promise<ZoteroItem[]>;
  isEditable(): boolean;
  getField(name: string): string | number;
  getCreators(): { firstName?: string; lastName?: string }[];
  getAttachments(): number[];
  getAnnotations(includeTrashed: boolean, asIDs: true): number[];
  getNotes(): number[];
  getNote(): string; setNote(html: string): void;
  getFilePathAsync(): Promise<string | false>;
  saveTx(): Promise<number>;
}
interface ZoteroPane {
  getSelectedItems(): ZoteroItem[];
  selectItem(id: number): Promise<unknown>;
}
interface ZoteroWindow extends Window {
  ZoteroPane: ZoteroPane;
  Zotero_Tabs?: { select(id: string): void };
  AbortController: typeof AbortController;
  MozXULElement: { insertFTLIfNeeded(name: string): void };
  openDialog(url: string, name: string, features: string, args?: unknown): ZoteroWindow;
}
interface SectionArgs {
  body: HTMLElement; doc: Document; item: ZoteroItem | null; editable: boolean; tabType: string;
  setEnabled(enabled: boolean): void;
}
interface ReaderEvent {
  reader: { itemID: number; _window?: ZoteroWindow; setContextPaneOpen?(open: boolean): Promise<void> }; doc: Document;
  params: { annotation?: { text?: string; pageLabel?: string; position?: { pageIndex?: number } } };
  append(element: HTMLElement): void;
}
interface ZoteroItemDetails extends HTMLElement {
  _collapsed: boolean;
  sidenav?: { container: ZoteroItemDetails; _contextNotesPaneVisible: boolean };
  scrollToPane(id: string, behavior: string): Promise<unknown>;
}
declare const Zotero: {
  isWin: boolean;
  locale?: string;
  /** Cross-scope handle to the running Glossa instance, so a newer instance can stop an orphaned one. */
  __glossaZoteroRuntime?: { startedAt: number; stop(): void };
  /** When the running instance stopped itself for an in-place upgrade. */
  __glossaZoteroUpgradeAt?: number;
  Utilities: { Internal: { copyTextToClipboard(text: string): void } };
  initializationPromise: Promise<void>; uiReadyPromise: Promise<void>;
  DataDirectory: { dir: string };
  getMainWindows(): ZoteroWindow[]; getMainWindow(): ZoteroWindow;
  getActiveZoteroPane(): ZoteroPane;
  Item: new (type: 'note') => ZoteroItem;
  Items: {
    get(id: number): ZoteroItem | false;
    getAsync(id: number): Promise<ZoteroItem | false>;
    getByLibraryAndKeyAsync(libraryID: number, key: string): Promise<ZoteroItem | false>;
    loadDataTypes(items: ZoteroItem[], types: string[]): Promise<void>;
  };
  Libraries: { get(id: number): { libraryType: string; libraryID: number; editable: boolean } };
  Groups: { getByLibraryID(id: number): { groupID: number } | false };
  Reader: {
    registerEventListener(type: string, handler: (event: ReaderEvent) => void, pluginID: string): void;
    unregisterEventListener(type: string, handler: (event: ReaderEvent) => void): void;
    open(id: number, location?: { pageIndex?: number; annotationID?: string }): Promise<unknown>;
  };
  ItemPaneManager: {
    registerSection(options: {
      paneID: string; pluginID: string; header: { l10nID: string; icon: string; darkIcon?: string }; sidenav: { l10nID: string; icon: string; darkIcon?: string };
      onRender(props: SectionArgs): void; onItemChange(props: SectionArgs): void; onDestroy(props: { body: HTMLElement }): void;
    }): string | false;
    unregisterSection(id: string): boolean;
  };
  MenuManager: {
    registerMenu(options: { menuID: string; pluginID: string; target: string; menus: {
      menuType: 'menuitem'; l10nID: string; icon: string; darkIcon?: string;
      onShowing?(event: Event, context: { items?: ZoteroItem[]; setVisible(visible: boolean): void }): void;
      onCommand(event: Event, context: { items?: ZoteroItem[] }): void;
    }[] }): string | false;
    unregisterMenu(id: string): boolean;
  };
  PDFWorker: { getFullText(id: number, maxPages?: number): Promise<{ text: string; extractedPages: number; totalPages: number }> };
  OSKeyStore: { encrypt(text: string): Promise<string>; decrypt(text: string): Promise<string>; isEncrypted(text: string): boolean };
  debug(message: string): void;
};
declare const IOUtils: {
  exists(path: string): Promise<boolean>;
  makeDirectory(path: string, options?: { ignoreExisting?: boolean; permissions?: number }): Promise<void>;
  readUTF8(path: string): Promise<string>;
  writeUTF8(path: string, value: string, options?: { tmpPath?: string; backupFile?: string; flush?: boolean }): Promise<number>;
  setPermissions(path: string, mode: number): Promise<void>;
  remove(path: string, options?: { recursive?: boolean; ignoreAbsent?: boolean }): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
};
declare const PathUtils: { join(...parts: string[]): string; tempDir: string };
declare const ChromeUtils: { importESModule(uri: string): Record<string, unknown> };
declare const Services: {
  ww: { openWindow(parent: Window | null, url: string, name: string, features: string, args: unknown): Window };
  io: { newURI(spec: string): unknown };
};
declare const Cc: Record<string, { getService(iface: unknown): unknown }>;
declare const Ci: Record<string, unknown>;
