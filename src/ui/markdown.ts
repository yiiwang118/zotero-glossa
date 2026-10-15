import type { Source } from '../core/types';
import { inlineParts, markdownBlocks } from '../core/markdown';
import type { ListItem } from '../core/markdown';
import { button, el } from './dom';
import { mathElement } from './math';

/** Small, safe Markdown subset. Model output never enters innerHTML or a URL sink; formulas are built as MathML nodes. */
export function renderAnswer(doc: Document, text: string, sources: Source[], open: (source: Source) => void): HTMLElement {
  const root = el(doc, 'div', 'glossa-answer');
  const inline = (row: HTMLElement, text: string): void => {
    for (const part of inlineParts(text)) {
      if (part.kind === 'math') { row.append(mathElement(doc, part.tex, part.display)); continue; }
      const source = part.kind === 'cite' ? sources.find(s => `[${s.id}]` === part.text) : undefined;
      if (source) {
        const cite = button(doc, part.text, () => open(source), 'glossa-citation');
        cite.title = `${source.title}${source.pageLabel ? ` · p. ${source.pageLabel}` : ''}`;
        row.append(cite);
      } else if (part.kind === 'strong' || part.kind === 'em') {
        const node = el(doc, part.kind); inline(node, part.text); row.append(node);
      } else if (part.kind === 'code') row.append(el(doc, 'code', '', part.text));
      else row.append(doc.createTextNode(part.text));
    }
  };
  const list = (items: ListItem[], ordered: boolean, start = 1): HTMLElement => {
    const node = el(doc, ordered ? 'ol' : 'ul');
    if (ordered && start !== 1) node.setAttribute('start', String(start));
    for (const item of items) {
      const li = el(doc, 'li'); inline(li, item.text);
      if (item.children.length) li.append(list(item.children, item.children[0].ordered));
      node.append(li);
    }
    return node;
  };
  for (const block of markdownBlocks(text)) {
    if (block.kind === 'code') { const pre = el(doc, 'pre'); pre.append(el(doc, 'code', '', block.text)); root.append(pre); }
    else if (block.kind === 'math') root.append(mathElement(doc, block.tex, true));
    else if (block.kind === 'rule') root.append(el(doc, 'hr'));
    else if (block.kind === 'list') root.append(list(block.items, block.ordered, block.start));
    else if (block.kind === 'table') {
      const wrap = el(doc, 'div', 'glossa-table'); const table = el(doc, 'table');
      block.rows.forEach((cells, index) => {
        const row = el(doc, 'tr');
        for (const text of cells) { const cell = el(doc, index ? 'td' : 'th'); inline(cell, text); row.append(cell); }
        table.append(row);
      });
      wrap.append(table); root.append(wrap);
    } else if (block.kind === 'quote') {
      const quote = el(doc, 'blockquote');
      for (const line of block.lines) { const p = el(doc, 'p'); inline(p, line); quote.append(p); }
      root.append(quote);
    } else {
      const row = block.kind === 'heading' ? el(doc, block.level <= 2 ? 'h3' : 'h4') : el(doc, 'p');
      inline(row, block.text); root.append(row);
    }
  }
  return root;
}
