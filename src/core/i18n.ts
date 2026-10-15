/** Interface language. Strings are written inline as L('中文', 'English') so both versions stay side by side. */
export type Locale = 'zh' | 'en';
let current: Locale = 'zh';
export function setLocale(locale: Locale): void { current = locale; }
export const getLocale = (): Locale => current;
export const L = (zh: string, en: string): string => current === 'en' ? en : zh;
/** 'auto' (or unset) follows Zotero's own language; anything that is not Chinese uses English. */
export function resolveLocale(setting: string | undefined, appLocale = ''): Locale {
  if (setting === 'zh' || setting === 'en') return setting;
  return !appLocale || /^zh/i.test(appLocale) ? 'zh' : 'en';
}
/** Answers follow the interface language unless the user picked one. */
export const answerLanguage = (configured: string): string => configured.trim() || L('简体中文', 'English');
