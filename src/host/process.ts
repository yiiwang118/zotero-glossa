import { L } from '../core/i18n';
import { uid } from '../core/types';
import type { Endpoint } from '../core/types';
import { validateCli } from '../core/cli';
import type { CliProcess, ProcessPort } from '../core/cli';
import { abortable } from '../core/abort';

interface Pipe { closed: boolean; close(force?: boolean): Promise<unknown> }
interface NativeProcess {
  stdin: Pipe & { write(text: string): Promise<unknown> };
  stdout: Pipe & { readString(): Promise<string> };
  stderr: Pipe & { readString(): Promise<string> };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
}
async function readText(pipe: Pipe & { readString(): Promise<string> }): Promise<string> {
  let value = await pipe.readString();
  while (!value && !pipe.closed) value = await pipe.readString();
  return value;
}
interface SubprocessAPI {
  getEnvironment(): Record<string, string>;
  pathSearch(command: string, environment: Record<string, string>): Promise<string>;
  call(options: { command: string; arguments: string[]; environment: Record<string, string>; workdir: string; stderr: 'pipe' }): Promise<NativeProcess>;
}
function runtime(): SubprocessAPI {
  return ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs').Subprocess as SubprocessAPI;
}
const PROXY_VARIABLES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
/** A service each CLI talks to, so a PAC file or per-host rule picks the same proxy the CLI needs. */
const PROXY_PROBES: Record<string, string> = { codex: 'https://chatgpt.com/', claude: 'https://api.anthropic.com/', grok: 'https://api.x.ai/' };
interface ProxyInfo { type: string; host: string; port: number }
/** Proxy URL for a resolved Gecko proxy; SOCKS uses socks5h so names resolve through the proxy. */
export function proxyURL(info: ProxyInfo | null | undefined): string {
  if (!info?.host || !info.port) return '';
  const scheme = { http: 'http', https: 'https', socks: 'socks5h' }[info.type];
  return scheme ? `${scheme}://${info.host.includes(':') ? `[${info.host}]` : info.host}:${info.port}` : '';
}
/** The proxy Zotero itself would use for the CLI's service: Zotero's network settings, which follow the system proxy by default.
 * Zotero started from the Dock does not inherit a terminal's proxy variables, so CLIs launched from it would otherwise connect directly. */
async function zoteroProxy(kind: string): Promise<string> {
  try {
    const service = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService) as {
      asyncResolve(uri: unknown, flags: number, callback: unknown): unknown };
    const uri = Services.io.newURI(PROXY_PROBES[kind] || 'https://example.com/');
    const info = await new Promise<ProxyInfo | null>(resolve => {
      const timer = setTimeout(() => resolve(null), 3000);
      service.asyncResolve(uri, 0, { onProxyAvailable: (_request: unknown, _channel: unknown, value: ProxyInfo | null) => { clearTimeout(timer); resolve(value); } });
    });
    return proxyURL(info);
  } catch (error) { Zotero.debug(`Glossa: could not resolve the proxy for ${kind}: ${String(error)}`); return ''; }
}
export interface ProxyChoice { url: string; source: 'setting' | 'environment' | 'zotero' | 'none' }
/** Order: the CLI's own setting, proxy variables Zotero inherited, then Zotero's network proxy. */
export async function effectiveProxy(endpoint: Endpoint, inherited: Record<string, string>): Promise<ProxyChoice> {
  if (endpoint.proxy) return { url: endpoint.proxy, source: 'setting' };
  const variable = PROXY_VARIABLES.find(name => inherited[name]);
  if (variable) return { url: inherited[variable], source: 'environment' };
  const url = await zoteroProxy(endpoint.kind || '');
  return { url, source: url ? 'zotero' : 'none' };
}
function baseEnvironment(api: SubprocessAPI): Record<string, string> {
  const env = { ...api.getEnvironment() };
  const home = env.HOME || env.USERPROFILE;
  const separator = Zotero.isWin ? ';' : ':';
  env.PATH = [env.PATH, ...(home ? [PathUtils.join(home, '.local', 'bin'), PathUtils.join(home, '.grok', 'bin'), PathUtils.join(home, '.npm-global', 'bin')] : []),
    ...(!Zotero.isWin ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'] : [])].filter(Boolean).join(separator);
  // Avoid nested-session detection when Zotero was launched from a terminal agent.
  delete env.CLAUDECODE;
  return env;
}
async function environment(api: SubprocessAPI, endpoint: Endpoint): Promise<Record<string, string>> {
  const env = baseEnvironment(api);
  const proxy = await effectiveProxy(endpoint, env);
  if (proxy.source === 'setting' || proxy.source === 'zotero') {
    for (const name of PROXY_VARIABLES) env[name] = proxy.url;
    // Local helpers (login callbacks, local model servers) must not go through the proxy.
    if (!env.NO_PROXY && !env.no_proxy) env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1,::1';
  }
  return env;
}

/** Gecko boundary: argv only, no shell, no credential-file reads, private temporary working directory. */
export class GeckoProcessPort implements ProcessPort {
  async find(endpoint: Endpoint, signal: AbortSignal): Promise<string> {
    validateCli(endpoint); signal.throwIfAborted();
    const api = runtime(); const env = baseEnvironment(api);
    const path = endpoint.binaryPath?.trim();
    if (path) {
      if (!(path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path))) throw new Error(L('请填写 CLI 可执行文件的绝对路径', 'Enter the absolute path of the CLI executable'));
      if (!await IOUtils.exists(path)) throw new Error(L('指定的 CLI 文件不存在', 'The CLI file does not exist'));
      return path;
    }
    try { return await abortable(api.pathSearch(endpoint.kind || '', env), signal); }
    catch { signal.throwIfAborted(); throw new Error(L('没有找到本机 CLI。请先安装并登录，或在设置中填写可执行文件的绝对路径', 'Local CLI not found. Install and sign in first, or enter the absolute path of its executable in Settings.')); }
  }
  /** The proxy a CLI started now would use, for showing in Settings. */
  async proxy(endpoint: Endpoint): Promise<ProxyChoice> {
    return effectiveProxy(endpoint, runtime().getEnvironment());
  }
  async start(endpoint: Endpoint, args: string[], signal: AbortSignal, promptFile?: string): Promise<CliProcess> {
    const command = await this.find(endpoint, signal);
    const api = runtime();
    const directory = PathUtils.join(PathUtils.tempDir, `glossa-zotero-${uid()}`);
    await IOUtils.makeDirectory(directory, { permissions: 0o700 });
    const remove = (): Promise<void> => IOUtils.remove(directory, { recursive: true, ignoreAbsent: true });
    let process: NativeProcess;
    try {
      const argv = [...args];
      if (promptFile !== undefined) {
        const path = PathUtils.join(directory, 'prompt.txt');
        await IOUtils.writeUTF8(path, promptFile); await IOUtils.setPermissions(path, 0o600);
        argv.push('--prompt-file', path);
      }
      signal.throwIfAborted();
      const env = await environment(api, endpoint);
      signal.throwIfAborted();
      process = await api.call({ command, arguments: argv, environment: env, workdir: directory, stderr: 'pipe' });
    } catch (error) { await remove(); throw error; }
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        signal.removeEventListener('abort', cancel);
        await Promise.allSettled([process.kill(300), process.stdin.close(true), process.stdout.close(true), process.stderr.close(true)]);
        await remove();
      })();
      return closing;
    };
    const cancel = (): void => { void close().catch(() => Zotero.debug('Glossa: temporary CLI cleanup failed.')); };
    signal.addEventListener('abort', cancel, { once: true });
    // Drain stderr; only a short tail is kept, and cliDetail() strips paths and tokens before anything is shown.
    let stderr = '';
    void (async () => { let text: string; while ((text = await readText(process.stderr))) stderr = (stderr + text).slice(-4000); })().catch(() => undefined);
    if (signal.aborted) { await close(); signal.throwIfAborted(); }
    return {
      // An incomplete UTF-8 character can decode to an empty string before EOF.
      read: () => readText(process.stdout),
      write: async text => { await process.stdin.write(text); },
      end: async () => { await process.stdin.close(); },
      wait: async () => (await process.wait()).exitCode,
      close,
      diagnostics: () => {
        const lines = stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        return [...lines].reverse().find(line => /error|fail|denied|refused|unauthori[sz]ed|not logged|login/i.test(line)) || lines.at(-1) || '';
      },
    };
  }
}
