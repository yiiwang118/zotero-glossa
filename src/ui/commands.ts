import { L } from '../core/i18n';

const command = (name: string, glyph: string, label: () => string, title: () => string, prompt: () => string, selection = false) =>
  ({ command: name, glyph, selection, get label() { return label(); }, get title() { return title(); }, get prompt() { return prompt(); } });
/** Labels and prompts are read when used, so they follow the interface language. */
export const COMMANDS = [
  command('/summarize', 'summary', () => L('总结这篇文献', 'Summarize this paper'), () => L('总结', 'Summary'),
    () => L('请总结当前文献的研究问题、方法、主要发现和局限，并标注来源。', 'Summarize the research question, methods, main findings and limitations of this paper, with citations.')),
  command('/translate', 'languages', () => L('翻译选中段落', 'Translate the selection'), () => L('翻译', 'Translation'),
    () => L('请翻译所选段落，保留术语和公式，对有歧义的术语简短解释，并标注选区来源。', 'Translate the selected passage, keeping terminology and formulas, briefly explaining ambiguous terms, and cite the selection.'), true),
  command('/explain', 'bulb', () => L('解释选中的概念', 'Explain the selection'), () => L('解释', 'Explanation'),
    () => L('请解释所选内容中的概念及其在文献中的作用，区分原文结论和你的推断，并标注来源。', 'Explain the concepts in the selection and their role in the paper, separating the paper\'s claims from your inferences, with citations.'), true),
  command('/compare', 'columns', () => L('对比多篇文献', 'Compare papers'), () => L('对比', 'Comparison'),
    () => L('请对比所选文献的研究问题、方法与结论，列出共识和分歧，并标注来源。', 'Compare the research questions, methods and conclusions of these papers, listing agreements and disagreements, with citations.')),
];
export type Command = typeof COMMANDS[number];

export const findCommand = (text: string): Command | undefined => COMMANDS.find(c => c.command === /^(\/\S+)/.exec(text.trim())?.[1]);
export function expandCommand(text: string, hasSelection: boolean, contextCount: number): string {
  const match = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return text;
  const item = COMMANDS.find(c => c.command === match[1]);
  if (!item) throw new Error(L('未识别的命令；输入 / 查看可用命令。', 'Unknown command; type / to see the available commands.'));
  const extra = match[2]?.trim();
  if (item.selection && !hasSelection && !extra) throw new Error(L('请先在 PDF 中选择文字，或在命令后输入需要处理的内容。', 'Select text in the PDF first, or type the content after the command.'));
  if (item.command === '/summarize' && !contextCount && !extra) throw new Error(L('请先添加文献（输入框左下角的 + 或输入 @）。', 'Add a paper first (the + at the bottom left, or type @).'));
  if (item.command === '/compare' && contextCount < 2) throw new Error(L('请先添加至少两篇文献（输入框左下角的 + 或输入 @）。', 'Add at least two papers first (the + at the bottom left, or type @).'));
  return `${item.prompt}${extra ? `\n\n${L('补充要求或内容：', 'Additional instructions or content:')}\n${extra}` : ''}`;
}
