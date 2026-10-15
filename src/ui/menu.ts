import { button, el, input } from './dom';
import { icon } from './icons';

export interface MenuItem {
  label: string;
  detail?: string;
  glyph?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Accessible name when the visible label is ambiguous (e.g. a model ID listed under several services). */
  ariaLabel?: string;
  /** Return true to keep the popover open, e.g. for two-step confirmations. */
  action(item: HTMLButtonElement): boolean | void;
}
interface PopoverOptions { label: string; placement?: 'above' | 'below'; align?: 'start' | 'end' | 'stretch'; width?: number; within?: HTMLElement }

/** Small anchored menu rendered inside the panel. Gecko chrome documents cannot open <datalist> suggestions, so
 * every picker in the panel uses this instead. */
export class Popover {
  readonly root: HTMLElement;
  private anchor?: HTMLElement;
  private render?: (root: HTMLElement) => void;
  private options?: PopoverOptions;
  private outside = (event: Event): void => {
    const target = event.target as Node | null;
    if (!target || this.root.contains(target) || this.anchor?.contains(target)) return;
    this.close(false);
  };

  constructor(private host: HTMLElement) {
    this.root = el(host.ownerDocument, 'div', 'glossa-popover'); this.root.hidden = true;
    this.root.setAttribute('role', 'menu');
    this.root.addEventListener('keydown', event => this.keydown(event));
    host.append(this.root);
  }
  get open(): boolean { return !this.root.hidden; }
  isFor(anchor: HTMLElement): boolean { return this.open && this.anchor === anchor; }
  show(anchor: HTMLElement, render: (root: HTMLElement) => void, options: PopoverOptions): void {
    this.close(false);
    this.anchor = anchor; this.render = render; this.options = options;
    anchor.setAttribute('aria-expanded', 'true');
    this.root.setAttribute('aria-label', options.label);
    this.root.hidden = false; this.refresh();
    this.host.ownerDocument.addEventListener('pointerdown', this.outside, true);
    (this.root.querySelector?.<HTMLElement>('input, [aria-checked="true"], button:not(:disabled)'))?.focus();
  }
  /** Re-render in place, e.g. after an asynchronous model catalog arrives. */
  refresh(): void {
    if (!this.open || !this.render || !this.anchor || !this.options) return;
    const focused = this.root.ownerDocument.activeElement;
    const query = focused?.tagName === 'input' || focused?.tagName === 'INPUT' ? (focused as HTMLInputElement) : undefined;
    this.root.replaceChildren(); this.render(this.root); this.position();
    if (query && !query.isConnected) {
      const next = this.root.querySelector?.<HTMLInputElement>('input');
      if (next) { next.focus(); next.setSelectionRange?.(next.value.length, next.value.length); }
    }
  }
  close(focusAnchor = true): void {
    if (!this.open && !this.anchor) return;
    this.host.ownerDocument.removeEventListener('pointerdown', this.outside, true);
    this.root.hidden = true; this.root.replaceChildren();
    const anchor = this.anchor; this.anchor = undefined; this.render = undefined; this.options = undefined;
    anchor?.setAttribute('aria-expanded', 'false');
    if (focusAnchor && anchor?.isConnected) anchor.focus();
  }
  private position(): void {
    const { anchor, options } = this; if (!anchor || !options) return;
    const host = this.host.getBoundingClientRect(); const target = anchor.getBoundingClientRect();
    const within = options.within?.getBoundingClientRect();
    const style = this.root.style;
    style.top = style.bottom = style.left = style.right = style.width = '';
    if (options.align === 'stretch' && within) {
      style.left = `${within.left - host.left}px`; style.width = `${within.width}px`;
    } else {
      const width = Math.min(options.width || 240, host.width - 16); style.width = `${width}px`;
      const start = options.align === 'end' ? target.right - host.left - width : target.left - host.left;
      style.left = `${Math.max(8, Math.min(start, host.width - width - 8))}px`;
    }
    if ((options.placement || 'below') === 'above') style.bottom = `${host.bottom - (within || target).top + 6}px`;
    else style.top = `${target.bottom - host.top + 4}px`;
  }
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key === 'Tab') { this.close(false); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...this.root.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(this.root.ownerDocument.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  }
}

export function menuSection(doc: Document, title: string, extra?: HTMLElement): HTMLElement {
  const row = el(doc, 'div', 'glossa-menu-heading'); row.append(el(doc, 'span', '', title));
  if (extra) row.append(extra);
  return row;
}
export function menuItem(doc: Document, item: MenuItem, close: () => void): HTMLButtonElement {
  const node = button(doc, '', () => { if (!node.disabled && item.action(node) !== true) close(); },
    `glossa-menu-item${item.danger ? ' glossa-danger' : ''}`);
  node.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
  if (item.checked !== undefined) node.setAttribute('aria-checked', String(item.checked));
  if (item.ariaLabel) node.setAttribute('aria-label', item.ariaLabel);
  node.title = item.detail ? `${item.label}\n${item.detail}` : item.label;
  node.disabled = !!item.disabled;
  const text = el(doc, 'span', 'glossa-menu-text'); text.append(el(doc, 'span', 'glossa-menu-label', item.label));
  if (item.detail) text.append(el(doc, 'span', 'glossa-menu-detail', item.detail));
  node.append(item.glyph ? icon(doc, item.glyph) : el(doc, 'span', 'glossa-menu-spacer'), text);
  if (item.checked) node.append(icon(doc, 'check'));
  return node;
}
/** A free-text row inside a menu, submitted with Enter. */
export function menuInput(doc: Document, placeholder: string, value: string, submit: (value: string) => void, onInput?: (value: string) => void): HTMLInputElement {
  const field = input(doc, placeholder, value); field.className = 'glossa-menu-input';
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && field.value.trim()) { event.preventDefault(); submit(field.value.trim()); }
  });
  if (onInput) field.addEventListener('input', () => onInput(field.value));
  return field;
}
