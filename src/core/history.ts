import { L } from './i18n';
import { emptyState, record } from './types';
import type { Conversation, Source, State } from './types';
import { parseState } from './store';

/** A portable archive contains research content, never provider keys or local CLI configuration. */
export function exportHistory(state: State): string {
  return JSON.stringify({ format: 'glossa-zotero-history', version: 1, exportedAt: new Date().toISOString(),
    folders: state.folders, conversations: state.conversations }, null, 2);
}
export function importHistory(state: State, text: string): number {
  if (text.length > 40_000_000) throw new Error(L('历史备份超过 40 MB，请分批导入', 'The backup is larger than 40 MB; import it in parts'));
  const raw = record(JSON.parse(text));
  if (raw.format !== 'glossa-zotero-history' || raw.version !== 1) throw new Error(L('请选择 Glossa Zotero 导出的历史备份', 'Choose a history backup exported by Glossa for Zotero'));
  const imported = parseState(JSON.stringify({ ...emptyState(), folders: raw.folders, conversations: raw.conversations }));
  let count = 0;
  for (const folder of imported.folders) if (!state.folders.some(f => f.id === folder.id)) state.folders.push(folder);
  for (const conversation of imported.conversations) if (!state.conversations.some(c => c.id === conversation.id)) {
    state.conversations.push(conversation); count++;
  }
  return count;
}
export function conversationMarkdown(conversation: Conversation, sourceURL: (s: Source) => string): string {
  return `# ${conversation.title}\n\n${conversation.messages.map(message => {
    const sources = message.sources.map(s => `[${s.id}] ${s.title}${s.pageLabel ? ` · p. ${s.pageLabel}` : ''}\n${sourceURL(s)}`).join('\n\n');
    const thinking = message.reasoning ? `<details><summary>${L('思考过程', 'Thinking')}</summary>\n\n${message.reasoning}\n\n</details>\n\n` : '';
    return `## ${message.role === 'user' ? L('你', 'You') : `Glossa · ${message.model || ''}`}\n\n${thinking}${message.role === 'user' && message.display ? message.display : message.text}\n\n${message.status !== 'complete' ? `*${L('回答未完成', 'Incomplete answer')}*\n\n` : ''}${message.warning ? `> ${message.warning}\n\n` : ''}${sources ? `### ${L('来源', 'Sources')}\n\n${sources}\n` : ''}`;
  }).join('\n---\n\n')}`;
}
