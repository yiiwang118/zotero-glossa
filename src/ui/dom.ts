import { icon } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
export function button(doc: Document, label: string, action: () => void, className = ''): HTMLButtonElement {
  const node = el(doc, 'button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function iconButton(doc: Document, label: string, glyph: string, action: () => void, className = ''): HTMLButtonElement {
  const node = button(doc, '', action, `glossa-icon-button ${className}`.trim());
  node.setAttribute('aria-label', label); node.title = label;
  node.append(icon(doc, glyph), el(doc, 'span', 'glossa-sr-only', label));
  return node;
}
/** A button with a leading icon and a visible label. */
export function labelButton(doc: Document, label: string, glyph: string, action: () => void, className = ''): HTMLButtonElement {
  const node = button(doc, '', action, `glossa-label-button ${className}`.trim());
  node.append(icon(doc, glyph), el(doc, 'span', '', label));
  return node;
}
export function input(doc: Document, placeholder = '', value = '', type = 'text'): HTMLInputElement {
  const node = el(doc, 'input');
  node.type = type; node.placeholder = placeholder; node.value = value;
  node.setAttribute('aria-label', placeholder);
  return node;
}
export function option(doc: Document, label: string, value: string): HTMLOptionElement {
  const node = el(doc, 'option', '', label); node.value = value; return node;
}
export function select(doc: Document, label: string, options: [string, string][], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const node = el(doc, 'select'); node.setAttribute('aria-label', label);
  node.append(...options.map(([text, key]) => option(doc, text, key)));
  node.value = options.some(([, key]) => key === value) ? value : options[0]?.[1] ?? '';
  node.addEventListener('change', () => onChange(node.value));
  return node;
}
export function field(doc: Document, label: string, control: HTMLElement, hint = ''): HTMLLabelElement {
  const row = el(doc, 'label', 'glossa-field');
  row.append(el(doc, 'span', 'glossa-field-label', label), control);
  if (hint) row.append(el(doc, 'span', 'glossa-field-hint', hint));
  return row;
}
/** Checkbox styled as a switch; keeps native semantics for keyboard and assistive technology. */
export function toggle(doc: Document, label: string, checked: boolean, onChange: (checked: boolean) => void, hint = ''): HTMLLabelElement {
  const row = el(doc, 'label', 'glossa-switch-row');
  const box = input(doc, label, '', 'checkbox'); box.checked = checked; box.className = 'glossa-switch';
  box.setAttribute('role', 'switch');
  box.addEventListener('change', () => onChange(box.checked));
  const text = el(doc, 'span', 'glossa-switch-text'); text.append(el(doc, 'span', 'glossa-field-label', label));
  if (hint) text.append(el(doc, 'span', 'glossa-field-hint', hint));
  row.append(text, box);
  return row;
}
/** Mutually exclusive choice rendered as a segmented control. */
export function segmented(doc: Document, label: string, options: [string, string][], value: string, onChange: (value: string) => void): HTMLDivElement {
  const group = el(doc, 'div', 'glossa-segmented'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
  const buttons = options.map(([text, key]) => {
    const node = button(doc, text, () => {
      if (node.getAttribute('aria-pressed') === 'true') return;
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === node)));
      onChange(key);
    });
    node.setAttribute('aria-pressed', String(key === value)); node.setAttribute('data-value', key);
    return node;
  });
  group.append(...buttons);
  return group;
}
export function status(doc: Document): HTMLDivElement {
  const node = el(doc, 'div', 'glossa-status');
  node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); return node;
}
export function setClass(node: Element, name: string, on: boolean): void {
  const names = node.className.split(/\s+/).filter(n => n && n !== name);
  if (on) names.push(name);
  node.className = names.join(' ');
}
