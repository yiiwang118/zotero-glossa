export interface ListItem { text: string; ordered: boolean; children: ListItem[] }
export type Block = { kind: 'paragraph' | 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'math'; tex: string }
  | { kind: 'rule' };
export type Inline = { kind: 'text' | 'code' | 'cite' | 'strong' | 'em'; text: string } | { kind: 'math'; tex: string; display: boolean };

/** Code first, so `$` and `*` inside code stay literal. Inline `$…$` follows Pandoc (no space inside the delimiters, no digit right
 * after the closing one) and may not contain backticks or CJK text, so "$5 and $10" or "价格 $5 和 $10" stay text. */
const INLINE = /(`[^`\n]+`|\$\$(?:[^$\\]|\\[\s\S])+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=[^\s$])(?:[^$\\\n`　-鿿＀-￯]|\\.)+?(?<=[^\s\\])\$(?!\d)|\[S\d+\]|\*\*(?=\S)[^*\n]+?(?<=\S)\*\*|\*(?=[^\s*])[^*\n]+?(?<=[^\s*])\*)/;
function token(value: string): Inline {
  if (value.startsWith('`')) return { kind: 'code', text: value.slice(1, -1) };
  if (value.startsWith('$$')) return { kind: 'math', tex: value.slice(2, -2).trim(), display: true };
  if (value.startsWith('\\[')) return { kind: 'math', tex: value.slice(2, -2).trim(), display: true };
  if (value.startsWith('\\(')) return { kind: 'math', tex: value.slice(2, -2).trim(), display: false };
  if (value.startsWith('$')) return { kind: 'math', tex: value.slice(1, -1), display: false };
  if (value.startsWith('[S')) return { kind: 'cite', text: value };
  if (value.startsWith('**')) return { kind: 'strong', text: value.slice(2, -2) };
  return { kind: 'em', text: value.slice(1, -1) };
}
/** Splits a line into text and recognised spans; captured separators sit at odd indices, so plain text is never re-classified. */
export function inlineParts(text: string): Inline[] {
  return text.split(new RegExp(INLINE.source, 'g')).flatMap((part, index): Inline[] =>
    index % 2 ? [token(part)] : part ? [{ kind: 'text', text: part.replace(/\\\$/g, '$') }] : []);
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
const LIST = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const indent = (spaces: string): number => spaces.replace(/\t/g, '    ').length;

/** Excludes HTML, images and arbitrary links from generated research content. */
export function markdownBlocks(text: string): Block[] {
  const blocks: Block[] = []; const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const trimmed = line.trim();
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n') }); continue;
    }
    if (!trimmed) continue;
    // Display math on its own lines: $$ … $$ or \[ … \]. Unclosed (still streaming) math stays visible as source.
    const open = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\[' : '';
    if (open) {
      const close = open === '$$' ? '$$' : '\\]';
      const first = trimmed.slice(2);
      if (first.trimEnd().endsWith(close) && first.trim().length > 2) {
        const body = first.trimEnd().slice(0, -2);
        if (!body.includes(close)) { blocks.push({ kind: 'math', tex: body.trim() }); continue; }
      } else if (!first.includes(close)) {
        // A display formula has no blank lines; stopping there keeps one unclosed $$ from swallowing the rest of the answer.
        const body = [first]; let j = i; let closed = false;
        while (++j < lines.length && lines[j].trim()) {
          if (lines[j].trimEnd().endsWith(close)) { body.push(lines[j].trimEnd().slice(0, -2)); closed = true; break; }
          body.push(lines[j]);
        }
        if (closed) { i = j; blocks.push({ kind: 'math', tex: body.join('\n').trim() }); continue; }
        blocks.push({ kind: 'code', text: lines.slice(i, j).join('\n') }); i = j - 1; continue;
      }
    }
    if (RULE.test(line)) { blocks.push({ kind: 'rule' }); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); continue; }
    const divider = lines[i + 1];
    if (line.includes('|') && divider?.includes('|') && cells(divider).every(c => /^:?-{3,}:?$/.test(c))) {
      const rows = [cells(line)]; i++;
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes('|')) rows.push(cells(lines[++i]));
      blocks.push({ kind: 'table', rows }); continue;
    }
    const first = LIST.exec(line);
    if (first) {
      // Deeper indentation nests under the previous item; a different marker at the top level starts a new list.
      const ordered = !!first[3];
      const block: Block = { kind: 'list', ordered, start: ordered ? Number(first[3]) || 1 : 1, items: [] };
      const stack: { indent: number; items: ListItem[] }[] = [{ indent: indent(first[1]), items: block.items }];
      for (let j = i; j < lines.length; j++) {
        const match = LIST.exec(lines[j]);
        if (!match || RULE.test(lines[j])) break;
        const depth = indent(match[1]); const isOrdered = !!match[3];
        while (stack.length > 1 && depth < stack[stack.length - 1].indent) stack.pop();
        let level = stack[stack.length - 1];
        if (depth > level.indent && level.items.length) {
          level = { indent: depth, items: level.items[level.items.length - 1].children }; stack.push(level);
        } else if (stack.length === 1 && isOrdered !== ordered) break;
        level.items.push({ text: match[4], ordered: isOrdered, children: [] });
        i = j;
      }
      blocks.push(block); continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      i--; blocks.push({ kind: 'quote', lines: quote.filter(l => l.trim()) }); continue;
    }
    blocks.push({ kind: 'paragraph', text: line });
  }
  return blocks;
}
