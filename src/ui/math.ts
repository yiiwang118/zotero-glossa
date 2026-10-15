import temml from 'temml';
import { el } from './dom';

const MATHML = 'http://www.w3.org/1998/Math/MathML';
/** MathML Core plus the few MathML 3 elements Temml emits. Anything else is flattened into an <mrow>. */
const ELEMENTS = new Set(['math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msub', 'msup', 'msubsup', 'munder', 'mover',
  'munderover', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'mtable', 'mtr', 'mtd', 'mlabeledtr', 'mmultiscripts',
  'mprescripts', 'none', 'merror']);
const ATTRIBUTES = new Set(['display', 'displaystyle', 'scriptlevel', 'mathvariant', 'mathsize', 'mathcolor', 'mathbackground', 'stretchy', 'symmetric',
  'fence', 'separator', 'largeop', 'movablelimits', 'accent', 'accentunder', 'lspace', 'rspace', 'minsize', 'maxsize', 'form', 'linethickness',
  'width', 'height', 'depth', 'voffset', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines', 'frame',
  'framespacing', 'notation', 'columnspan', 'rowspan', 'bevelled']);
const STYLES = new Set(['color', 'backgroundColor', 'display', 'mathDepth', 'mathStyle', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'marginLeft', 'marginRight', 'width', 'height', 'verticalAlign', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'textAlign']);
/** Temml's layout classes (tml-*, ff-*, …); the CSS for them lives in glossa.css. */
const CLASS = /^(?:tml|ff|wbk|chr)-[\w-]+$|^(?:mathscr|menclose)$/;
const SAFE_VALUE = /^[\w#%.,() -]*$/;

interface TemmlNode { type?: string; text?: string; attributes?: Record<string, string>; classes?: string[]; style?: Record<string, string>; children?: TemmlNode[] }
// The tree (not renderToString) lets the DOM be built node by node; the API is pinned with the exact Temml version.
const temmlTree = (tex: string, options: object): TemmlNode => (temml as unknown as { __renderToMathMLTree(tex: string, options: object): TemmlNode }).__renderToMathMLTree(tex, options);
const cache = new Map<string, TemmlNode | Error>();

function parse(tex: string, display: boolean): TemmlNode | Error {
  const key = `${display ? 'D' : 'I'}${tex}`;
  let value = cache.get(key);
  if (!value) {
    // trust:false rejects \href, \url, \includegraphics, \style and friends; maxExpand bounds macro recursion.
    try { value = temmlTree(tex, { displayMode: display, throwOnError: true, trust: false, strict: false, annotate: false, wrap: 'tex', maxExpand: 500 }); }
    catch (error) { value = error instanceof Error ? error : new Error(String(error)); }
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(key, value);
  }
  return value;
}
/** Builds MathML from Temml's tree with createElementNS and an allow-list: model output never passes through an HTML or XML parser. */
function build(doc: Document, node: TemmlNode, parent: Element): void {
  if (node.text !== undefined && !node.type) { parent.append(doc.createTextNode(node.text)); return; }
  if (!node.type) { node.children?.forEach(child => build(doc, child, parent)); return; }
  const element = doc.createElementNS(MATHML, ELEMENTS.has(node.type) ? node.type : 'mrow');
  for (const [name, value] of Object.entries(node.attributes || {})) {
    if (ATTRIBUTES.has(name) && SAFE_VALUE.test(String(value))) element.setAttribute(name, String(value));
  }
  const classes = (node.classes || []).filter(c => CLASS.test(c));
  if (classes.length) element.setAttribute('class', classes.join(' '));
  const style = (element as unknown as { style?: CSSStyleDeclaration }).style;
  for (const [name, value] of Object.entries(node.style || {})) {
    if (STYLES.has(name) && SAFE_VALUE.test(String(value)) && !/url/i.test(String(value))) style?.setProperty?.(name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), String(value));
  }
  node.children?.forEach(child => build(doc, child, element));
  parent.append(element);
}
/** Renders LaTeX as MathML; display formulas get their own scrollable block. Invalid LaTeX stays visible as source. */
export function mathElement(doc: Document, tex: string, display: boolean): HTMLElement {
  const holder = el(doc, display ? 'div' : 'span', display ? 'glossa-math glossa-math-block' : 'glossa-math');
  const tree = parse(tex, display);
  if (tree instanceof Error) {
    holder.className = 'glossa-math-error';
    holder.textContent = display ? `$$${tex}$$` : `$${tex}$`;
    holder.title = tree.message.split('\n')[0];
    return holder;
  }
  build(doc, tree, holder);
  holder.setAttribute('data-tex', tex);
  return holder;
}
