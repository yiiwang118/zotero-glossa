import { L } from '../core/i18n';
import { itemRef, record, sameItem, str } from '../core/types';
import type { ContextSnapshot, ItemRef, ResearchHost, Selection, Source, StoragePort } from '../core/types';
import { abortable } from '../core/abort';
import { exportFile, importFile } from './files';

export const ref = (item: ZoteroItem): ItemRef => ({ libraryID: item.libraryID, key: item.key });
export async function resolve(reference: ItemRef): Promise<ZoteroItem> {
  itemRef(reference);
  const item = await Zotero.Items.getByLibraryAndKeyAsync(reference.libraryID, reference.key);
  if (!item || item.deleted) throw new Error(L('文献不存在或已移入回收站', 'The item no longer exists or is in the trash'));
  await Zotero.Items.loadDataTypes([item], ['itemData']);
  return item;
}
export async function parent(item: ZoteroItem): Promise<ZoteroItem> {
  if (!item.parentID) return item;
  const p = await Zotero.Items.getAsync(item.parentID);
  if (!p || p.deleted) throw new Error(L('父条目不存在或已移入回收站', 'The parent item no longer exists or is in the trash'));
  return p.isAnnotation() || p.isAttachment() ? parent(p) : p;
}
export const titleOf = (item: ZoteroItem): string => String(item.getField('title') || L('无标题文献', 'Untitled item'));
function plainNote(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
}
const readable = (item: ZoteroItem): boolean => item.isPDFAttachment() || item.isEPUBAttachment() || item.isSnapshotAttachment();
function pageOf(position: string): number | undefined {
  try {
    const p = record(JSON.parse(position)).pageIndex;
    return Number.isSafeInteger(p) && Number(p) >= 0 ? Number(p) : undefined;
  } catch { return undefined; }
}

export class ZoteroStorage implements StoragePort {
  readonly directory = PathUtils.join(Zotero.DataDirectory.dir, 'glossa-zotero');
  readonly path = PathUtils.join(this.directory, 'state.json');
  async read(): Promise<string | null> {
    return await IOUtils.exists(this.path) ? IOUtils.readUTF8(this.path) : null;
  }
  async write(value: string): Promise<void> {
    await IOUtils.makeDirectory(this.directory, { ignoreExisting: true, permissions: 0o700 });
    await IOUtils.writeUTF8(this.path, value, { tmpPath: `${this.path}.tmp`, backupFile: `${this.path}.bak`, flush: true });
    await IOUtils.setPermissions(this.path, 0o600);
  }
}

export class ZoteroHost implements ResearchHost {
  async pickItems(): Promise<{ item: ItemRef; title: string }[]> {
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const io: { dataOut: number[] | null; deferred: { resolve(): void }; itemTreeID: string; onlyRegularItems: boolean } = {
      dataOut: null, deferred: { resolve: finish }, itemTreeID: 'glossa-context-picker', onlyRegularItems: true,
    };
    Zotero.getMainWindow().openDialog('chrome://zotero/content/selectItemsDialog.xhtml', '',
      'chrome,dialog=no,centerscreen,resizable=yes', io);
    await done;
    const selected: { item: ItemRef; title: string }[] = [];
    for (const id of io.dataOut || []) {
      const item = await Zotero.Items.getAsync(id);
      if (!item || item.deleted) continue;
      await Zotero.Items.loadDataTypes([item], ['itemData']);
      selected.push({ item: ref(item), title: titleOf(item) });
    }
    return selected;
  }
  exportFile = exportFile;
  importFile = importFile;
  copyText(text: string): void { Zotero.Utilities.Internal.copyTextToClipboard(text); }
  controller(): AbortController { return new (Zotero.getMainWindow().AbortController)(); }
  async encrypt(value: string): Promise<string> {
    if (!value) return '';
    const result = await Zotero.OSKeyStore.encrypt(value);
    if (!Zotero.OSKeyStore.isEncrypted(result)) throw new Error(L('无法加密 API Key，配置未保存', 'Could not encrypt the API key; settings were not saved'));
    return result;
  }
  async decrypt(value: string): Promise<string> {
    if (!value) return '';
    if (!Zotero.OSKeyStore.isEncrypted(value)) throw new Error(L('API Key 格式无效，请重新保存', 'The stored API key is invalid; save it again'));
    return Zotero.OSKeyStore.decrypt(value);
  }

  async snapshot(items: ItemRef[], selection: Selection | undefined, fulltext: boolean, signal: AbortSignal): Promise<ContextSnapshot> {
    const snapshot: ContextSnapshot = { items: [], titles: [], sources: [], warnings: [] };
    let budget = 60_000;
    const add = (source: Omit<Source, 'id'>, limit: number): void => {
      if (budget <= 0 || !source.text.trim()) return;
      const text = source.text.slice(0, Math.min(budget, limit));
      if (text.length < source.text.length) snapshot.warnings.push(L(`${source.title}：上下文已截取`, `${source.title}: context was truncated`));
      budget -= text.length;
      snapshot.sources.push({ ...source, id: `S${snapshot.sources.length + 1}`, text });
    };
    const requested = [...items];
    if (selection && !requested.some(r => sameItem(r, selection.attachment))) requested.unshift(selection.attachment);
    if (requested.length > 6) snapshot.warnings.push(L('本次最多读取 6 篇文献', 'At most 6 items are read per question'));
    const roots = new Set<string>();
    for (const reference of requested.slice(0, 6)) {
      signal.throwIfAborted();
      const original = await resolve(reference);
      const item = await parent(original);
      await Zotero.Items.loadDataTypes([item], ['creators', 'itemData', 'childItems']);
      signal.throwIfAborted();
      const rootKey = `${item.libraryID}/${item.key}`;
      if (roots.has(rootKey)) continue;
      roots.add(rootKey);
      const rootRef = ref(item);
      const title = titleOf(item);
      snapshot.items.push(rootRef);
      snapshot.titles.push(title);
      const creators = item.getCreators().map(c => [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean).join('; ');
      const fields: [string, string][] = [[L('日期', 'Date'), 'date'], [L('出版物', 'Publication'), 'publicationTitle'], ['DOI', 'DOI'], ['URL', 'url'], [L('摘要', 'Abstract'), 'abstractNote']];
      add({ item: rootRef, title, kind: 'metadata', text: [`${L('标题', 'Title')}${L('：', ': ')}${title}`, creators ? `${L('作者', 'Authors')}${L('：', ': ')}${creators}` : '',
        ...fields.map(([label, name]) => { const value = String(item.getField(name) || '').trim(); return value ? `${label}${L('：', ': ')}${value}` : ''; }),
      ].filter(Boolean).join('\n') }, 6000);
      let attachment: ZoteroItem | undefined;
      if (selection) {
        const selected = await resolve(selection.attachment);
        if (sameItem(ref(await parent(selected)), rootRef)) {
          attachment = selected;
          add({ item: rootRef, title, kind: 'selection', text: selection.text, attachmentKey: selected.key,
            pageIndex: selection.pageIndex, pageLabel: selection.pageLabel }, 12_000);
        }
      }
      if (!attachment && original.isAttachment() && readable(original)) attachment = original;
      if (!attachment && item.isRegularItem()) attachment = (await item.getBestAttachments()).find(candidate => !candidate.deleted && readable(candidate));
      if (original.isNote()) {
        await Zotero.Items.loadDataTypes([original], ['note']);
        add({ item: rootRef, title, kind: 'note', text: plainNote(original.getNote()) }, 8000);
      }
      if (attachment) {
        await Zotero.Items.loadDataTypes([attachment], ['childItems']);
        for (const id of attachment.getAnnotations(false, true).slice(0, 30)) {
          signal.throwIfAborted();
          const annotation = await Zotero.Items.getAsync(id);
          if (!annotation || annotation.deleted) continue;
          await Zotero.Items.loadDataTypes([annotation], ['annotation', 'annotationDeferred']);
          add({ item: rootRef, title, kind: 'annotation', text: [annotation.annotationText, annotation.annotationComment].filter(Boolean).join('\n'),
            attachmentKey: attachment.key, annotationKey: annotation.key, pageLabel: annotation.annotationPageLabel,
            pageIndex: pageOf(annotation.annotationPosition) }, 2000);
        }
        if (fulltext && budget > 0) {
          const limit = Math.floor(40_000 / Math.max(1, requested.length));
          try {
            if (attachment.isPDFAttachment()) {
              const result = await abortable(Zotero.PDFWorker.getFullText(attachment.id, 40), signal);
              signal.throwIfAborted();
              if (!result.text.trim()) snapshot.warnings.push(L(`${title}：没有可提取的正文，扫描件可能需要 OCR`, `${title}: no extractable text; a scanned PDF may need OCR`));
              else add({ item: rootRef, title, kind: 'fulltext', text: result.text, attachmentKey: attachment.key }, limit);
              if (result.extractedPages < result.totalPages) snapshot.warnings.push(L(`${title}：仅提取前 ${result.extractedPages} / ${result.totalPages} 页`, `${title}: only the first ${result.extractedPages} / ${result.totalPages} pages were read`));
            } else {
              // EPUB and web snapshots are read from Zotero's own full-text index.
              const text = await abortable(attachment.attachmentText, signal);
              signal.throwIfAborted();
              if (!text?.trim()) snapshot.warnings.push(L(`${title}：附件尚未建立全文索引，仅使用其他来源`, `${title}: the attachment is not indexed yet; other sources are used`));
              else add({ item: rootRef, title, kind: 'fulltext', text, attachmentKey: attachment.key }, limit);
            }
          } catch (error) {
            signal.throwIfAborted();
            snapshot.warnings.push(L(`${title}：正文暂不可读（附件未下载、加密或提取失败），仅使用其他来源`, `${title}: full text unavailable (not downloaded, encrypted or failed to extract); other sources are used`));
            void error;
          }
        }
      } else if (fulltext) snapshot.warnings.push(L(`${title}：没有可读取的 PDF、EPUB 或网页快照，本次仅使用元数据、笔记或选区`, `${title}: no readable PDF, EPUB or snapshot; using metadata, notes or the selection`));
    }
    signal.throwIfAborted();
    snapshot.warnings = [...new Set(snapshot.warnings)];
    return snapshot;
  }

  async openSource(source: Source): Promise<void> {
    if (source.attachmentKey) {
      const attachment = await resolve({ libraryID: source.item.libraryID, key: source.attachmentKey });
      await Zotero.Reader.open(attachment.id, { ...(source.pageIndex !== undefined ? { pageIndex: source.pageIndex } : {}),
        ...(source.annotationKey ? { annotationID: source.annotationKey } : {}) });
    } else await Zotero.getActiveZoteroPane().selectItem((await resolve(source.item)).id);
  }
  async showItem(target: ItemRef): Promise<void> {
    const item = await resolve(target);
    const win = Zotero.getMainWindow(); win.Zotero_Tabs?.select('zotero-pane');
    await Zotero.getActiveZoteroPane().selectItem(item.id); win.focus();
  }
  sourceURL(source: Source): string {
    const library = Zotero.Libraries.get(source.item.libraryID);
    const group = library.libraryType === 'group' ? Zotero.Groups.getByLibraryID(source.item.libraryID) : false;
    const libraryPath = group ? `groups/${group.groupID}` : 'library';
    if (!source.attachmentKey) return `zotero://select/${libraryPath}/items/${source.item.key}`;
    const params = new URLSearchParams();
    if (source.pageIndex !== undefined) params.set('page', String(source.pageIndex + 1));
    if (source.annotationKey) params.set('annotation', source.annotationKey);
    return `zotero://open-pdf/${libraryPath}/items/${source.attachmentKey}${params.size ? `?${params}` : ''}`;
  }
  async saveNote(target: ItemRef, html: string): Promise<ItemRef> {
    const item = await resolve(target);
    if (!item.isRegularItem()) throw new Error(L('请将笔记保存到文献条目；独立附件暂不支持子笔记', 'Save notes to a regular item; standalone attachments cannot have child notes'));
    if (!item.isEditable() || !Zotero.Libraries.get(item.libraryID).editable) throw new Error(L('此文献库没有写入权限', 'You do not have write access to this library'));
    if (!str(html).trim()) throw new Error(L('笔记内容为空', 'The note is empty'));
    const note = new Zotero.Item('note');
    note.libraryID = item.libraryID;
    note.parentKey = item.key;
    note.setNote(html);
    await note.saveTx();
    return ref(note);
  }
}
