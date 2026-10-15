import { L, resolveLocale, setLocale } from './core/i18n';
import { Store } from './core/store';
import { Research } from './core/research';
import { ensureCliEndpoints, errorMessage, sameItem } from './core/types';
import type { ItemRef, Selection } from './core/types';
import { parent, ref, resolve, titleOf, ZoteroHost, ZoteroStorage } from './host/zotero';
import { Panel } from './ui/panel';
import type { PanelSession } from './ui/panel';
import { SelectionTranslation } from './ui/translation';
import styles from '../addon/glossa.css';
import { GeckoProcessPort } from './host/process';
import { el } from './ui/dom';
import { icon } from './ui/icons';

let rootURI = '';
let pluginID = '';
let research: Research | undefined;
let sectionID: string | false = false;
let startupError = '';
let stopped = false;
const menus: string[] = [];
const panels = new Map<HTMLElement, Panel>();
const windows = new Set<ZoteroWindow>();
const styledDocuments = new Set<Document>();
const selectionElements = new Set<HTMLElement>();
const sectionItems = new Map<HTMLElement, ItemRef>();
const translations = new Map<Document, SelectionTranslation>();
const autoTimers = new Map<Document, ReturnType<typeof setTimeout>>();
let workspaceReady: Promise<Panel | undefined> | undefined;
let startedAt = 0;
/** Each instance registers its own chrome package, so a predecessor that is still shutting down cannot remove it. */
let chromePackage = 'glossa-zotero';
let chromeHandle: { destruct(): void } | undefined;
let addonListener: AddonListener | undefined;
const selectionWatchers = new Set<ReturnType<typeof setInterval>>();
let shareGeneration = 0;
/** Bootstrap reasons Zotero passes to startup/shutdown. */
const REASON = { APP_SHUTDOWN: 2, ADDON_UPGRADE: 7, ADDON_DOWNGRADE: 8 } as const;
const fetcher = (url: string, init: RequestInit): Promise<Response> => fetch(url, init);

function inject(doc: Document): void {
  // Reader frames come and go; forget documents whose window has closed.
  for (const known of styledDocuments) if (known.defaultView?.closed) styledDocuments.delete(known);
  if (styledDocuments.has(doc)) return;
  // Bundle styles with the JS so same-version development updates cannot reuse stale CSS.
  if (!doc.getElementById('glossa-zotero-style')) {
    const style = el(doc, 'style', '', styles); style.id = 'glossa-zotero-style';
    doc.documentElement.append(style);
  }
  const win = doc.defaultView as ZoteroWindow | null;
  if (win?.MozXULElement) win.MozXULElement.insertFTLIfNeeded('glossa-zotero.ftl');
  styledDocuments.add(doc);
}
function mount(body: HTMLElement, workspace = false): Panel | undefined {
  inject(body.ownerDocument);
  if (startupError || !research) {
    body.replaceChildren(el(body.ownerDocument, 'p', 'glossa-startup-error', L(`Glossa 无法读取本地数据：${startupError}。原文件未被覆盖，请备份 Zotero 数据目录中的 glossa-zotero/state.json 后检查。`, `Glossa could not read its local data: ${startupError}. The file was not overwritten; back up glossa-zotero/state.json in the Zotero data directory and check it.`)));
    return undefined;
  }
  let panel = panels.get(body);
  if (!panel) {
    if (workspace) body.ownerDocument.title = L('Glossa · 研究工作台', 'Glossa · Research workspace');
    panel = new Panel(body, research, fetcher, { workspace, relocalize,
      openWorkspace: (items, selection, session) => {
        if (research) { research.store.state.settings.openMode = 'window'; void research.store.save().catch(() => undefined); }
        void openWorkspace(items, selection, undefined, session).catch(error => Zotero.debug(`Glossa: ${errorMessage(error)}`));
      },
      openSidebar: (items, selection, session) => {
        void openSidebar(items, selection, undefined, session).then(target => {
          if (!target) return;
          if (research) { research.store.state.settings.openMode = 'sidebar'; void research.store.save().catch(() => undefined); }
          if (workspace) (body.ownerDocument.defaultView as ZoteroWindow | null)?.close();
        }).catch(error => Zotero.debug(`Glossa: ${errorMessage(error)}`));
      } });
    panels.set(body, panel);
  }
  return panel;
}
/** Applies the interface language: rebuilds open panels in place, keeping each one's chat, context and draft. */
function relocalize(origin?: Panel): void {
  if (!research) return;
  setLocale(resolveLocale(research.store.state.settings.uiLanguage, Zotero.locale));
  translations.forEach(popup => popup.close()); translations.clear();
  for (const [body, panel] of [...panels]) {
    const session = panel.session(); const reopen = panel === origin;
    panel.dispose(); panels.delete(body);
    const next = mount(body, panel.workspace);
    if (!next) continue;
    next.restoreSession(session);
    if (reopen) next.showSettings('general');
  }
}
const workspaceURL = (): string => `chrome://${chromePackage}/content/workspace.xhtml`;
/** The mount point once the workspace document (not the initial about:blank) has finished loading. */
function workspaceMount(win: ZoteroWindow): HTMLElement | null {
  try { return win.location.href === workspaceURL() && win.document.readyState === 'complete' ? win.document.getElementById('glossa-mount') : null; }
  catch { return null; }
}
async function openWorkspace(items: ItemRef[], selection?: Selection, prompt?: string, session?: PanelSession): Promise<Panel | undefined> {
  if (stopped) return undefined;
  let win = [...windows].find(w => !w.closed);
  if (!win) {
    // A normal top-level window, as Zotero opens its own reader windows. A dialog owned by the main window could stay
    // unpainted on macOS (notably over a full-screen Zotero window) and could not be minimized.
    const created = Services.ww.openWindow(null, workspaceURL(), '_blank', 'chrome,dialog=no,resizable,centerscreen,width=980,height=780', null) as ZoteroWindow;
    win = created; windows.add(created);
    workspaceReady = new Promise(done => {
      let settled = false;
      const started = Date.now();
      const finish = (): void => {
        if (settled) return;
        const body = workspaceMount(created);
        if (!body) {
          if (created.closed || Date.now() - started > 15_000) { settled = true; clearInterval(poll); done(undefined); }
          return;
        }
        settled = true; clearInterval(poll); created.removeEventListener('load', finish);
        if (stopped) { created.close(); done(undefined); return; }
        created.addEventListener('unload', () => { windows.delete(created); workspaceReady = undefined; onMainWindowUnload(created); }, { once: true });
        try { done(mount(body, true)); }
        catch (error) {
          // Never leave an empty window: say what failed where the user is looking.
          Zotero.debug(`Glossa: workspace failed to mount: ${errorMessage(error)}`);
          inject(body.ownerDocument);
          body.replaceChildren(el(body.ownerDocument, 'p', 'glossa-startup-error', L(`Glossa 窗口加载失败：${errorMessage(error)}。可关闭此窗口改用右侧栏。`, `The Glossa window failed to load: ${errorMessage(error)}. Close it and use the sidebar instead.`)));
          done(undefined);
        }
      };
      // The load event can be missed while Gecko replaces the initial about:blank document, so poll as well.
      created.addEventListener('load', finish);
      const poll = setInterval(finish, 100);
    });
  }
  const panel = await workspaceReady;
  if (!panel || stopped || win.closed) return undefined;
  if (session) panel.restoreSession(session);
  else {
    panel.openContext(items, items.map(i => i.key), selection);
    if (prompt) panel.setSelectionPrompt(prompt);
    void Promise.all(items.map(async r => titleOf(await resolve(r)))).then(titles => {
      if (!stopped && !win?.closed) panel.refreshTitles(items, titles);
    }).catch(() => undefined);
  }
  win.focus?.(); return panel;
}

async function openSidebar(items: ItemRef[], selection?: Selection, prompt?: string, session?: PanelSession,
  reader?: ReaderEvent['reader']): Promise<Panel | undefined> {
  if (stopped) return undefined;
  const doc = reader?._window?.document || Zotero.getMainWindow().document;
  await reader?.setContextPaneOpen?.(true);
  const roots = await Promise.all(items.map(async item => ref(await parent(await resolve(item))))).catch(() => items);
  if (stopped) return undefined;
  const locate = (): [HTMLElement, Panel] | undefined => [...panels].find(([body]) => {
    const target = sectionItems.get(body);
    const details = body.closest?.<ZoteroItemDetails>('item-details');
    return body.ownerDocument === doc && target && roots.some(item => sameItem(item, target))
      && (!details?.sidenav || details.sidenav.container === details);
  });
  let entry = locate();
  if (!entry && !reader && roots[0]) {
    await Zotero.getActiveZoteroPane().selectItem((await resolve(roots[0])).id);
    entry = locate();
  }
  if (!entry || stopped) return undefined;
  const [body, panel] = entry;
  const details = body.closest?.<ZoteroItemDetails>('item-details');
  if (details) {
    details._collapsed = false;
    if (details.sidenav) details.sidenav._contextNotesPaneVisible = false;
    const section = body.closest<HTMLElement & { open: boolean }>('collapsible-section');
    if (section) section.open = true;
    if (sectionID) await details.scrollToPane(sectionID, 'instant');
  }
  if (session) panel.restoreSession(session);
  else {
    panel.openContext(roots, roots.map(i => i.key), selection);
    if (prompt) panel.setSelectionPrompt(prompt);
    void Promise.all(roots.map(async item => titleOf(await resolve(item)))).then(titles => panel.refreshTitles(roots, titles)).catch(() => undefined);
  }
  doc.defaultView?.focus?.(); return panel;
}
async function openPreferred(items: ItemRef[], selection?: Selection, prompt?: string, reader?: ReaderEvent['reader']): Promise<Panel | undefined> {
  try {
    if (research?.store.state.settings.openMode !== 'window') {
      const panel = await openSidebar(items, selection, prompt, undefined, reader);
      if (panel) return panel;
    }
    return await openWorkspace(items, selection, prompt);
  } catch (error) { Zotero.debug(`Glossa: ${errorMessage(error)}`); return undefined; }
}

/** Like the Obsidian edition, the current PDF selection appears above the composer of the matching sidebar and of the
 * standalone window, ready to ask about. Nothing is sent until the user asks. */
function shareSelection(selection: Selection, item: ZoteroItem, reader: ReaderEvent['reader'], row: HTMLElement): void {
  if (!research || stopped || research.store.state.settings.attachSelection === false) return;
  // Zotero removes its selection popup (and our buttons in it) when the text is deselected. Withdraw the card then,
  // unless a newer selection replaced it or the user is already working in a Glossa panel.
  const generation = ++shareGeneration;
  const watcher = setInterval(() => {
    if (stopped || generation !== shareGeneration) { clearInterval(watcher); selectionWatchers.delete(watcher); return; }
    if (row.isConnected) return;
    clearInterval(watcher); selectionWatchers.delete(watcher);
    setTimeout(() => {
      if (!stopped && generation === shareGeneration) for (const panel of panels.values()) panel.withdrawSelection(selection);
    }, 250);
  }, 300);
  selectionWatchers.add(watcher);
  const doc = reader._window?.document || Zotero.getMainWindow().document;
  void parent(item).then(root => {
    const rootRef = ref(root); const title = titleOf(root);
    for (const [body, panel] of panels) {
      const target = sectionItems.get(body);
      if (panel.workspace || (body.ownerDocument === doc && target && sameItem(target, rootRef))) panel.offerSelection(selection, title);
    }
  }).catch(error => Zotero.debug(`Glossa: ${errorMessage(error)}`));
}
const selectionListener = (event: ReaderEvent): void => {
  const text = event.params.annotation?.text?.trim();
  if (!text) return;
  const item = Zotero.Items.get(event.reader.itemID);
  if (!item) return;
  const annotation = event.params.annotation;
  const selection: Selection = { attachment: ref(item), text,
    pageIndex: annotation?.position?.pageIndex, pageLabel: annotation?.pageLabel };
  const row = el(event.doc, 'div', 'glossa-reader-actions');
  for (const previous of selectionElements) if (!previous.isConnected) selectionElements.delete(previous);
  selectionElements.add(row);
  // Layout is inline so the row stays usable even before the stylesheet reaches the reader frame.
  row.style.cssText = 'display:flex;gap:6px;align-items:center;';
  const askSelection = (): void => { void openPreferred([ref(item)], selection, L('请解释这段话的含义和它在论文中的作用，并标注来源。', 'Explain what this passage means and its role in the paper, with citations.'), event.reader); };
  const translateSelection = (): void => {
    if (!research || stopped) return;
    clearTimeout(autoTimers.get(event.doc)); autoTimers.delete(event.doc);
    inject(event.doc); translations.get(event.doc)?.close();
    const popup = new SelectionTranslation(event.doc, research, selection, row.getBoundingClientRect(), {
      configure: () => { void openPreferred([ref(item)], selection, undefined, event.reader).then(panel => panel?.showSettings('services')); },
      openChat: askSelection, closed: () => translations.delete(event.doc),
    });
    translations.set(event.doc, popup);
  };
  inject(event.doc);
  const action = (label: string, glyph: string, title: string, run: () => void): HTMLButtonElement => {
    const node = el(event.doc, 'button', 'wide-button glossa-reader-button'); node.type = 'button';
    node.setAttribute('aria-label', title); node.title = title;
    node.style.cssText = 'flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:0;white-space:nowrap;';
    const svg = icon(event.doc, glyph); svg.style.cssText = 'width:14px;height:14px;flex:none;';
    node.append(svg, el(event.doc, 'span', '', label)); node.addEventListener('click', run);
    return node;
  };
  row.append(action(L('翻译', 'Translate'), 'languages', L('Glossa 翻译', 'Glossa Translate'), translateSelection), action(L('提问', 'Ask'), 'message', L('Glossa 提问', 'Ask Glossa'), askSelection));
  event.append(row);
  shareSelection(selection, item, event.reader, row);
  clearTimeout(autoTimers.get(event.doc)); autoTimers.delete(event.doc);
  if (research?.store.state.settings.autoTranslate) autoTimers.set(event.doc, setTimeout(() => {
    autoTimers.delete(event.doc);
    if (row.isConnected && research?.store.state.settings.autoTranslate) translateSelection();
  }, 350));
};

interface AddonListener { onInstalling?(addon: { id: string }): void; onDisabling?(addon: { id: string }): void; onUninstalling?(addon: { id: string }): void }
interface AddonManagerAPI { addAddonListener(listener: AddonListener): void; removeAddonListener(listener: AddonListener): void }
function addonManager(): AddonManagerAPI | undefined {
  try { return (ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs') as { AddonManager: AddonManagerAPI }).AddonManager; }
  catch { return undefined; }
}
function registerChromePackage(): void {
  try {
    const startup = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup) as
      { registerChrome(manifest: unknown, entries: string[][]): { destruct(): void } };
    const name = `glossa-zotero-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    chromeHandle = startup.registerChrome(Services.io.newURI(`${rootURI}manifest.json`), [['content', name, './']]);
    chromePackage = name;
  } catch (error) { Zotero.debug(`Glossa: chrome registration failed: ${errorMessage(error)}`); }
}
/** Registration keys are namespaced by Zotero as CSS.escape(`${pluginID}-${id}`). */
const namespaced = (id: string): string => `${pluginID}-${id}`.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
/** Register; if an orphaned earlier instance still holds the key, clear it and try once more. */
function registerOnce(register: () => string | false, key: string, unregister: (id: string) => boolean): string | false {
  const first = register(); if (first) return first;
  unregister(namespaced(key));
  return register();
}

export async function startup(data: { id: string; rootURI: string }, reason?: number): Promise<void> {
  void reason;
  rootURI = data.rootURI; pluginID = data.id; stopped = false; startupError = ''; startedAt = Date.now();
  // An instance that lost its bootstrap scope during an upgrade is stopped here, whichever scope it lives in.
  const previous = Zotero.__glossaZoteroRuntime;
  if (previous && previous.startedAt !== startedAt) previous.stop();
  Zotero.__glossaZoteroRuntime = { startedAt, stop: () => { void teardown(); } };
  registerChromePackage();
  const store = new Store(new ZoteroStorage());
  try {
    await store.load();
    setLocale(resolveLocale(store.state.settings.uiLanguage, Zotero.locale));
    research = new Research(store, new ZoteroHost(), fetcher, new GeckoProcessPort());
    // Listed in memory only; they are saved with the next settings change, so startup never writes.
    ensureCliEndpoints(store.state.settings);
  }
  catch (error) { startupError = errorMessage(error); Zotero.debug('Glossa: local state could not be loaded; write operations disabled.'); }
  if (stopped) return;
  for (const win of Zotero.getMainWindows()) onMainWindowLoad(win);
  sectionID = registerOnce(() => Zotero.ItemPaneManager.registerSection({
    paneID: 'glossa-research', pluginID,
    header: { l10nID: 'glossa-zotero-section', icon: `${rootURI}icon-16.svg` },
    sidenav: { l10nID: 'glossa-zotero-sidenav', icon: `${rootURI}icon-20.svg` },
    onItemChange: props => props.setEnabled(!!props.item && !props.item.deleted),
    onRender: props => {
      if (props.item) sectionItems.set(props.body, ref(props.item));
      const panel = mount(props.body);
      if (panel && props.item) panel.setContext([ref(props.item)], [titleOf(props.item)]);
    },
    onDestroy: ({ body }) => { panels.get(body)?.dispose(); panels.delete(body); sectionItems.delete(body); },
  }), 'glossa-research', id => Zotero.ItemPaneManager.unregisterSection(id));
  if (!sectionID) throw new Error(L('Glossa 阅读侧栏注册失败', 'Glossa could not register its sidebar section'));
  for (const target of ['main/menubar/tools', 'main/library/item']) {
    const menuID = `glossa-${target.replace(/\//g, '-')}`;
    const id = registerOnce(() => Zotero.MenuManager.registerMenu({ menuID, pluginID, target,
      menus: [{ menuType: 'menuitem', l10nID: target === 'main/library/item' ? 'glossa-zotero-items' : 'glossa-zotero-open', icon: `${rootURI}icon-16.svg`,
        // Standalone notes cannot be research context, so the item menu only appears for papers and attachments.
        ...(target === 'main/library/item' ? { onShowing: (_event: Event, context: { items?: ZoteroItem[]; setVisible(visible: boolean): void }) => {
          context.setVisible(!!context.items?.some(i => !i.deleted && !i.isNote() && !i.isAnnotation()));
        } } : {}),
        onCommand: (_event, context) => {
          const items = (context.items || Zotero.getActiveZoteroPane().getSelectedItems()).filter(i => !i.deleted && !i.isNote() && !i.isAnnotation());
          void openPreferred(items.slice(0, 6).map(ref));
        } }],
    }), menuID, id => Zotero.MenuManager.unregisterMenu(id));
    if (id) menus.push(id);
  }
  Zotero.Reader.registerEventListener('renderTextSelectionPopup', selectionListener, pluginID);
  // Stop at the very start of an upgrade, disable or uninstall, before Zotero starts the next version. Zotero's own
  // shutdown call can arrive late and, on a reused scope, would otherwise reach the new instance.
  const manager = addonManager();
  if (manager) {
    const mine = (addon: { id: string }): boolean => addon.id === pluginID;
    addonListener = {
      onInstalling: addon => { if (mine(addon)) { Zotero.__glossaZoteroUpgradeAt = Date.now(); void teardown(); } },
      onDisabling: addon => { if (mine(addon)) void teardown(); },
      onUninstalling: addon => { if (mine(addon)) void teardown(); },
    };
    manager.addAddonListener(addonListener);
  }
}
export function onMainWindowLoad(win: ZoteroWindow): void { if (rootURI && !stopped) inject(win.document); }
export function onMainWindowUnload(win: ZoteroWindow): void {
  for (const [body, panel] of panels) if (body.ownerDocument === win.document) { panel.dispose(); panels.delete(body); sectionItems.delete(body); }
  styledDocuments.delete(win.document);
}
/** Unregisters everything synchronously; returns the pending state flush. Safe to call more than once. */
function teardown(): Promise<void> | undefined {
  if (stopped) return undefined;
  stopped = true;
  if (addonListener) { addonManager()?.removeAddonListener(addonListener); addonListener = undefined; }
  if (Zotero.__glossaZoteroRuntime?.startedAt === startedAt) delete Zotero.__glossaZoteroRuntime;
  selectionWatchers.forEach(watcher => clearInterval(watcher)); selectionWatchers.clear();
  autoTimers.forEach(timer => clearTimeout(timer)); autoTimers.clear();
  translations.forEach(popup => popup.close()); translations.clear();
  Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', selectionListener);
  selectionElements.forEach(node => node.remove()); selectionElements.clear();
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  sectionID = false;
  for (const id of menus.splice(0)) Zotero.MenuManager.unregisterMenu(id);
  panels.forEach(panel => panel.dispose()); panels.clear(); sectionItems.clear();
  windows.forEach(win => { if (!win.closed) win.close(); }); windows.clear();
  for (const doc of styledDocuments) {
    doc.getElementById('glossa-zotero-style')?.remove();
    doc.querySelector('link[href="glossa-zotero.ftl"]')?.remove();
  }
  styledDocuments.clear();
  chromeHandle?.destruct(); chromeHandle = undefined;
  const pending = research; research = undefined;
  return pending?.shutdown().catch(error => Zotero.debug(`Glossa: final save failed: ${errorMessage(error)}`));
}
/**
 * Returns false when the request was meant for a predecessor: an older bootstrap (no reason) or Zotero's late upgrade
 * shutdown reaching the new instance in a reused scope. Otherwise stops now; waits for the last save only on quit.
 */
export function shutdown(reason?: number): Promise<void> | false | undefined {
  const fresh = Date.now() - startedAt < 30_000;
  const upgradeAt = Zotero.__glossaZoteroUpgradeAt || 0;
  const upgrading = reason === REASON.ADDON_UPGRADE || reason === REASON.ADDON_DOWNGRADE;
  if (!stopped && fresh && (reason === undefined || (upgrading && upgradeAt && startedAt > upgradeAt))) {
    Zotero.debug('Glossa: ignoring a shutdown meant for the previous version');
    return false;
  }
  const pending = teardown();
  if (reason === REASON.APP_SHUTDOWN) return pending;
  return undefined;
}
