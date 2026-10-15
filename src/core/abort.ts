import { L } from './i18n';
/** Stop waiting even when a native host operation (e.g. PDF extraction) has no cancellation API. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const reason = (): Error => signal.reason instanceof Error ? signal.reason : new Error(L('操作已取消', 'Cancelled'));
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(reason());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(reason());
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
