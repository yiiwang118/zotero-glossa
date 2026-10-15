import { L } from '../core/i18n';
interface FilePicker {
  modeSave: number; modeOpen: number; returnCancel: number; defaultString: string; file: string;
  init(window: ZoteroWindow, title: string, mode: number): void;
  appendFilter(title: string, pattern: string): void;
  show(): Promise<number>;
}
function picker(): FilePicker {
  const FilePicker = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs').FilePicker as new () => FilePicker;
  return new FilePicker();
}
export async function exportFile(name: string, text: string): Promise<void> {
  const dialog = picker();
  dialog.init(Zotero.getMainWindow(), L('导出 Glossa', 'Export from Glossa'), dialog.modeSave); dialog.defaultString = name;
  dialog.appendFilter(name.endsWith('.json') ? L('JSON 备份', 'JSON backup') : L('Markdown 文档', 'Markdown document'), name.endsWith('.json') ? '*.json' : '*.md');
  if (await dialog.show() === dialog.returnCancel || !dialog.file) return;
  await IOUtils.writeUTF8(dialog.file, text, { tmpPath: `${dialog.file}.glossa-tmp`, flush: true });
}
export async function importFile(): Promise<string | null> {
  const dialog = picker();
  dialog.init(Zotero.getMainWindow(), L('导入 Glossa 历史', 'Import Glossa history'), dialog.modeOpen); dialog.appendFilter(L('JSON 备份', 'JSON backup'), '*.json');
  if (await dialog.show() === dialog.returnCancel || !dialog.file) return null;
  if ((await IOUtils.stat(dialog.file)).size > 40_000_000) throw new Error(L('历史备份超过 40 MB', 'The backup is larger than 40 MB'));
  return IOUtils.readUTF8(dialog.file);
}
