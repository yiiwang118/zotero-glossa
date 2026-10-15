// Deterministic DOM contract fixture; this is not a browser/layout emulator.
const simple = selector => {
  const [, tag = '', cls = ''] = /^([a-z]*)((?:\.[\w-]+)*)/i.exec(selector.trim().replace(/:not\([^)]*\)|\[[^\]]*\]/g, '')) || [];
  const classes = cls.split('.').filter(Boolean);
  return node => !!node.tagName && (!tag || node.tagName.toLowerCase() === tag.toLowerCase())
    && classes.every(c => String(node.className).split(/\s+/).includes(c));
};
const matcher = selector => { const parts = selector.split(',').map(simple); return node => parts.some(p => p(node)); };
class Node {
  constructor(doc, tagName = '', text = '') {
    this.ownerDocument = doc; this.tagName = tagName; this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.listeners = new Map(); this._text = text; this.style = {}; this.className = '';
    this.hidden = false; this.disabled = false; this.checked = false; this._value = undefined;
    this.scrollHeight = 100; this.clientHeight = 100; this.scrollTop = 0;
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = value; }
  get value() { return this._value ?? (this.tagName === 'select' ? this.children[0]?.value || '' : ''); }
  set value(value) { this._value = value; }
  get firstElementChild() { return this.children.find(c => c.tagName) || null; }
  get childElementCount() { return this.children.filter(c => c.tagName).length; }
  get isConnected() { return this === this.ownerDocument.documentElement || !!this.parentNode?.isConnected; }
  getBoundingClientRect() { return { left: 20, top: 100, bottom: 128, right: 240, width: 220, height: 28 }; }
  append(...nodes) { for (let n of nodes) { if (typeof n === 'string') n = this.ownerDocument.createTextNode(n); n.remove(); n.parentNode = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children.forEach(n => { n.parentNode = null; }); this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(fn => fn !== callback)); }
  dispatch(name, details = {}) { if (name === 'click' && this.disabled) return; for (const callback of this.listeners.get(name) || []) callback({ target: this, preventDefault() {}, stopPropagation() {}, ...details }); }
  click() { this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelector(selector) {
    if (selector === 'link[href="glossa-zotero.ftl"]') return findAll(this, n => n.tagName === 'link' && n.href === 'glossa-zotero.ftl')[0] || null;
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) { const match = matcher(selector); return findAll(this, n => n !== this && match(n)); }
}
export class FakeDocument {
  constructor() { this.documentElement = new Node(this, 'html'); this.defaultView = null; }
  createElementNS(namespace, tag) { const node = new Node(this, tag); node.namespaceURI = namespace; return node; }
  createTextNode(text) { return new Node(this, '', text); }
  getElementById(id) { return findAll(this.documentElement, n => n.id === id)[0] || null; }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
  addEventListener(...args) { this.documentElement.addEventListener(...args); }
  removeEventListener(...args) { this.documentElement.removeEventListener(...args); }
}
export function findAll(node, predicate) { return [node, ...node.children.flatMap(n => findAll(n, () => true))].filter(predicate); }
export const click = node => { if (!node) throw new Error('Button not found'); node.dispatch('click'); };
export const change = (node, value) => { if (!node) throw new Error('Control not found'); node.value = value; node.dispatch('change'); };
/** Finds a control by visible text or accessible name. */
export const control = (root, label) => findAll(root, n => !!n.tagName && (n.getAttribute('aria-label') === label || (n.tagName === 'button' && n.textContent === label)))[0];
