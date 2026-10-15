import type { Research } from '../core/research';
import type { FetchPort } from '../core/provider';
import type { Popover } from './menu';

/** What a full-panel sheet (settings, history, note) may do with its host panel. */
export interface SheetHost {
  readonly doc: Document;
  readonly research: Research;
  readonly fetcher: FetchPort;
  readonly popover: Popover;
  /** Replace the sheet with a new page; `back` adds a back button. Returns the scrolling body. */
  open(title: string, back?: () => void): HTMLElement;
  close(): void;
  /** Changes whenever the sheet is replaced or closed, so late async work can tell it is stale. */
  version(): number;
  error(text: string): void;
  persist(): void;
  /** Abort the controller when the sheet closes; returns a function that stops tracking it. */
  track(controller: AbortController): () => void;
  /** Re-read settings into the composer controls. */
  refresh(): void;
}
