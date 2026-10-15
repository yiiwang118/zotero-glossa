import { L } from '../core/i18n';
import type { Conversation } from '../core/types';
import { uid } from '../core/types';
import { conversationMarkdown, exportHistory, importHistory } from '../core/history';
import { button, el, iconButton, input, labelButton, select } from './dom';
import { icon } from './icons';
import { menuItem, menuSection } from './menu';
import type { SheetHost } from './sheet';

export interface HistoryHost extends SheetHost {
  current(): Conversation | undefined;
  openConversation(conversation: Conversation): void;
  /** The open conversation was deleted. */
  forget(conversation: Conversation): void;
  notify(text: string): void;
  action(task: () => Promise<void>): Promise<void>;
  /** Receives the sheet's renderer so live run status can update badges in place. */
  watch(render: () => void): void;
}
/** Paper titles a conversation used, taken from the metadata sources it cited. */
export function conversationPapers(conversation: Conversation): string[] {
  const titles: string[] = [];
  for (const message of conversation.messages) for (const source of message.sources) {
    if (source.kind === 'metadata' && source.title && !titles.includes(source.title)) titles.push(source.title);
  }
  return titles;
}
function dayGroup(time: number, now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= start) return L('今天', 'Today');
  if (time >= start - 86_400_000) return L('昨天', 'Yesterday');
  if (time >= start - 6 * 86_400_000) return L('最近 7 天', 'Last 7 days');
  return L('更早', 'Earlier');
}
const shortTime = (time: number): string => {
  const date = new Date(time); const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
};

export function showHistory(host: HistoryHost, folderID = '*', query = ''): void {
  const { doc, research } = host; const state = research.store.state;
  const area = host.open(L('对话历史', 'History'));
  const search = input(doc, L('搜索标题、问题或回答', 'Search titles, questions or answers'), query);
  const searchRow = el(doc, 'div', 'glossa-search'); searchRow.append(icon(doc, 'search'), search);
  const tools = el(doc, 'div', 'glossa-history-tools'); tools.hidden = true;
  const more = iconButton(doc, L('更多历史操作', 'More history actions'), 'more', () => { tools.hidden = !tools.hidden; more.setAttribute('aria-expanded', String(!tools.hidden)); });
  more.setAttribute('aria-expanded', 'false'); searchRow.append(more);
  const folders = select(doc, L('筛选目录', 'Filter by folder'), [[L('全部对话', 'All chats'), '*'], [L('未归类', 'Unfiled'), ''], ...state.folders.map(f => [f.name, f.id] as [string, string])], folderID, () => render());
  const list = el(doc, 'div', 'glossa-history-list');
  let signature = '';
  const rows = new Map<string, { running: HTMLElement; time: HTMLElement }>();
  const render = (): void => {
    const needle = search.value.trim().toLowerCase();
    const matches = state.conversations.filter(c => (folders.value === '*' || c.folderID === folders.value)
      && (!needle || `${c.title}\n${conversationPapers(c).join('\n')}\n${c.messages.map(m => m.display || m.text).join('\n')}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    // Streaming updates only touch status badges, preserving focus, inline rename and open menus.
    const next = JSON.stringify([needle, folders.value, matches.map(c => [c.id, c.title, c.folderID])]);
    if (next !== signature) {
      signature = next; list.replaceChildren(); rows.clear();
      let group = '';
      for (const c of matches) {
        const label = dayGroup(c.updatedAt);
        if (label !== group) { group = label; list.append(el(doc, 'div', 'glossa-history-group', label)); }
        list.append(historyRow(host, c, rows, () => { signature = ''; render(); }));
      }
      if (!matches.length) list.append(el(doc, 'p', 'glossa-empty-note', needle ? L('没有匹配的对话。', 'No matching chats.') : L('还没有对话。发送第一个问题后会保存在这里。', 'No chats yet. Your first question will be saved here.')));
    }
    for (const c of matches) {
      const view = rows.get(c.id); if (!view) continue;
      view.running.hidden = !research.busy(c.id);
      view.running.title = research.status(c.id) || L('运行中', 'Running');
      view.time.textContent = shortTime(c.updatedAt); view.time.title = new Date(c.updatedAt).toLocaleString();
    }
  };
  search.addEventListener('input', render);
  // Folder management and transfers live behind the ⋯ button so the list stays the focus.
  const name = input(doc, L('新目录名称', 'New folder name'));
  name.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); create.click(); } });
  const create = button(doc, L('创建目录', 'Create folder'), () => {
    const value = name.value.trim().replace(/\s+/g, ' ').slice(0, 60); if (!value) return;
    const f = { id: uid(), name: value }; state.folders.push(f); host.persist(); showHistory(host, f.id);
  }, 'glossa-secondary');
  const createRow = el(doc, 'div', 'glossa-inline'); createRow.append(name, create);
  tools.append(el(doc, 'div', 'glossa-section-title', L('目录', 'Folders')), createRow);
  for (const f of state.folders) {
    const row = el(doc, 'div', 'glossa-inline glossa-folder-row'); const rename = input(doc, L('目录名称', 'Folder name'), f.name);
    row.append(icon(doc, 'folder'), rename,
      button(doc, L('改名', 'Rename'), () => { if (rename.value.trim()) { f.name = rename.value.trim().slice(0, 60); host.persist(); showHistory(host, f.id); } }, 'glossa-ghost'),
      button(doc, L('移除目录', 'Remove folder'), () => { research.store.removeFolder(f.id); host.persist(); showHistory(host); }, 'glossa-ghost glossa-danger'));
    tools.append(row);
  }
  if (state.folders.length) tools.append(el(doc, 'p', 'glossa-muted', L('移除目录不会删除其中的对话，它们会回到“未归类”。', 'Removing a folder keeps its chats; they move to Unfiled.')));
  const transfers = el(doc, 'div', 'glossa-inline');
  if (research.host.exportFile) transfers.append(labelButton(doc, L('备份全部历史', 'Back up all history'), 'download', () => void host.action(async () => {
    await research.host.exportFile?.('glossa-history.json', exportHistory(state));
  }), 'glossa-secondary'));
  if (research.host.importFile) transfers.append(labelButton(doc, L('导入历史', 'Import history'), 'upload', () => void host.action(async () => {
    const raw = await research.host.importFile?.();
    if (!raw) return;
    const count = importHistory(state, raw); await research.store.save();
    showHistory(host); host.notify(L(`已导入 ${count} 个对话；已有对话保持不变。`, `Imported ${count} chats; existing chats are unchanged.`));
  }), 'glossa-secondary'));
  if (transfers.childElementCount) tools.append(el(doc, 'div', 'glossa-section-title', L('备份', 'Backup')), transfers,
    el(doc, 'p', 'glossa-muted', L('备份只包含目录和对话，不含 API Key 与 CLI 配置；导入会合并，不会覆盖已有对话。', 'Backups contain folders and chats only — no API keys or CLI settings. Importing merges and never overwrites existing chats.')));
  area.append(searchRow, folders, tools, list); render(); search.focus();
  host.watch(render);
}

function historyRow(host: HistoryHost, c: Conversation, rows: Map<string, { running: HTMLElement; time: HTMLElement }>, rerender: () => void): HTMLElement {
  const { doc, research } = host; const state = research.store.state;
  const row = el(doc, 'div', `glossa-history-row${host.current() === c ? ' glossa-current' : ''}`);
  const open = button(doc, '', () => host.openConversation(c), 'glossa-history-open');
  open.setAttribute('aria-label', c.title);
  const text = el(doc, 'span', 'glossa-list-text');
  const title = el(doc, 'span', 'glossa-list-title', c.title);
  const papers = conversationPapers(c);
  const folder = state.folders.find(f => f.id === c.folderID)?.name;
  const detail = [papers.length > 1 ? L(`${papers[0]} 等 ${papers.length} 篇`, `${papers[0]} and ${papers.length - 1} more`) : papers[0] || '', folder ? `${L('目录', 'Folder')}${L('：', ': ')}${folder}` : ''].filter(Boolean).join(' · ');
  text.append(title, el(doc, 'span', 'glossa-list-detail', detail || L(`${c.messages.filter(m => m.role === 'user').length} 轮问答`, `${c.messages.filter(m => m.role === 'user').length} questions`)));
  open.append(text);
  const running = el(doc, 'span', 'glossa-history-running'); running.setAttribute('role', 'img'); running.setAttribute('aria-label', `${c.title}${L('：运行中', ': running')}`);
  running.append(icon(doc, 'loader'), el(doc, 'span', '', L('运行中', 'Running')));
  const time = el(doc, 'span', 'glossa-history-time');
  rows.set(c.id, { running, time });
  const menu = iconButton(doc, `${L('对话操作：', 'Chat actions: ')}${c.title}`, 'more', () => {
    if (host.popover.isFor(menu)) { host.popover.close(); return; }
    host.popover.show(menu, root => {
      const close = (): void => host.popover.close();
      root.append(menuItem(doc, { label: L('重命名', 'Rename'), glyph: 'pencil', action: () => rename(host, row, c, rerender) }, close));
      if (research.busy(c.id)) root.append(menuItem(doc, { label: L('停止生成', 'Stop generating'), glyph: 'stop', action: () => research.stop(c.id) }, close));
      if (research.host.exportFile) root.append(menuItem(doc, { label: L('导出 Markdown', 'Export Markdown'), glyph: 'download', action: () => void host.action(async () => {
        await research.host.exportFile?.(`${c.title.replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60) || 'glossa-conversation'}.md`,
          conversationMarkdown(c, s => research.host.sourceURL(s)));
      }) }, close));
      root.append(menuSection(doc, L('移动到', 'Move to')));
      for (const [label, id] of [[L('未归类', 'Unfiled'), ''], ...state.folders.map(f => [f.name, f.id])]) {
        root.append(menuItem(doc, { label, glyph: 'folder', checked: c.folderID === id, ariaLabel: L(`移动「${c.title}」到 ${label}`, `Move “${c.title}” to ${label}`),
          action: () => { c.folderID = id; host.persist(); rerender(); } }, close));
      }
      root.append(menuItem(doc, { label: L('删除', 'Delete'), glyph: 'trash', danger: true, action: node => {
        if (research.busy(c.id)) { host.error(L('请先停止生成，再删除这个对话。', 'Stop generating before deleting this chat.')); return; }
        if (node.getAttribute('data-confirm') !== 'true') {
          node.setAttribute('data-confirm', 'true'); const label = node.querySelector?.('.glossa-menu-label'); if (label) label.textContent = L('再次点击确认删除', 'Click again to delete');
          node.setAttribute('aria-label', L('确认删除此对话', 'Confirm deleting this chat')); return true;
        }
        state.conversations = state.conversations.filter(x => x.id !== c.id);
        if (host.current() === c) host.forget(c);
        host.persist(); rerender();
      } }, close));
    }, { label: L('对话操作', 'Chat actions'), align: 'end', width: 220 });
  });
  row.append(open, running, time, menu);
  return row;
}
function rename(host: HistoryHost, row: HTMLElement, c: Conversation, rerender: () => void): void {
  const { doc } = host;
  const edit = input(doc, L('对话名称', 'Chat name'), c.title); edit.className = 'glossa-rename';
  const finish = (save: boolean): void => {
    if (save && edit.value.trim()) { c.title = edit.value.trim().replace(/\s+/g, ' ').slice(0, 100); host.persist(); }
    rerender();
  };
  edit.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  });
  const save = button(doc, L('保存名称', 'Save name'), () => finish(true), 'glossa-secondary');
  row.replaceChildren(edit, save); edit.focus(); edit.select?.();
}
