import { L } from './i18n';
import { customApiUrl } from './api-url';
import { record, str } from './types';
import type { Endpoint } from './types';

export interface PromptMessage { role: 'user' | 'assistant'; content: string }
export type FetchPort = (url: string, init: RequestInit) => Promise<Response>;
export function headers(endpoint: Endpoint, key: string): Record<string, string> {
  return endpoint.apiStyle === 'anthropic'
    ? { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) }
    : { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
export function validateEndpoint(endpoint: Endpoint): void {
  const url = new URL(customApiUrl(endpoint));
  if (url.username || url.password || url.search) throw new Error(L('API 地址不能包含账户、密码或查询参数', 'The API address must not contain a user name, password or query'));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error(L('远程 API 请使用 HTTPS；HTTP 仅支持本机服务', 'Remote APIs must use HTTPS; plain HTTP is only allowed for local services'));
  }
  if (!endpoint.model.trim()) throw new Error(L('请先填写具体模型', 'Enter a model first'));
}

/** One piece of a streamed reply. Reasoning is the model's visible thinking; status reports connection progress. */
export type StreamChunk = { type: 'text' | 'reasoning'; text: string }
  /** `retrying`: the CLI lost its connection and retries by itself; `detail` is a short progress such as "2/5". */
  | { type: 'status'; status: 'connected' | 'queued' | 'retrying'; detail?: string };
export interface StreamOptions { purpose?: 'chat' | 'translate' }

/** Incremental SSE decoder handles UTF-8/chunk boundaries, CRLF and multiline data. */
export class SSEDecoder {
  private pending = '';
  /** Comment-only blocks (`: keep-alive`) seen so far; services send them while a request waits in a queue. */
  comments = 0;
  push(chunk: string, final = false): string[] {
    this.pending += chunk;
    if (this.pending.length > 2_000_000) throw new Error(L('API 返回的单个事件过大', 'The API sent an event that is too large'));
    const events: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.pending))) {
      const block = this.pending.slice(0, match.index);
      this.pending = this.pending.slice(match.index + match[0].length);
      const value = this.data(block);
      if (value) events.push(value);
    }
    if (final && this.pending.trim()) {
      const value = this.data(this.pending);
      if (value) events.push(value);
      this.pending = '';
    }
    return events;
  }
  private data(block: string): string {
    const lines = block.split(/\r?\n/);
    if (lines.some(line => line.startsWith(':')) && !lines.some(line => line.startsWith('data:'))) this.comments++;
    return lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
  }
}

/** Splits a leading `<think>…</think>` block (used by some open models and local servers) out of the answer text. */
export class ThinkTagSplitter {
  private state: 'start' | 'inside' | 'answer' = 'start';
  private buffer = '';
  push(text: string): StreamChunk[] {
    if (this.state === 'answer') return text ? [{ type: 'text', text }] : [];
    this.buffer += text;
    if (this.state === 'start') {
      const head = this.buffer.trimStart();
      if (head.length < 7 && '<think>'.startsWith(head)) return [];
      if (!head.startsWith('<think>')) { this.state = 'answer'; const all = this.buffer; this.buffer = ''; return [{ type: 'text', text: all }]; }
      this.state = 'inside'; this.buffer = head.slice(7);
    }
    const end = this.buffer.indexOf('</think>');
    if (end >= 0) {
      const thinking = this.buffer.slice(0, end); const rest = this.buffer.slice(end + 8).replace(/^\s+/, '');
      this.state = 'answer'; this.buffer = '';
      return [...(thinking ? [{ type: 'reasoning' as const, text: thinking }] : []), ...(rest ? [{ type: 'text' as const, text: rest }] : [])];
    }
    // Hold back a possible partial closing tag.
    const safe = Math.max(0, this.buffer.length - 7);
    const thinking = this.buffer.slice(0, safe); this.buffer = this.buffer.slice(safe);
    return thinking ? [{ type: 'reasoning', text: thinking }] : [];
  }
  flush(): StreamChunk[] {
    const rest = this.buffer; this.buffer = '';
    if (!rest) return [];
    return [{ type: this.state === 'inside' ? 'reasoning' : 'text', text: rest }];
  }
}

/** Long enough for full summaries and translations; services with lower limits can lower it per endpoint. */
export const DEFAULT_MAX_TOKENS = 16_000;
export const isDeepSeek = (endpoint: Endpoint): boolean => {
  try { return /(^|\.)deepseek\.com$/i.test(new URL(endpoint.baseUrl).hostname); } catch { return false; }
};
/** Effort values each protocol documents; CLI catalogs report their own. Custom values remain allowed. */
export function effortOptions(endpoint: Endpoint): string[] {
  if (endpoint.kind && endpoint.kind !== 'api') {
    const model = endpoint.cliModels?.find(m => m.id === endpoint.model) || endpoint.cliModels?.find(m => m.isDefault);
    return model?.efforts.length ? model.efforts : ['low', 'medium', 'high'];
  }
  // DeepSeek thinks by default; `off` switches thinking mode off for fast answers.
  if (isDeepSeek(endpoint)) return ['off', 'low', 'high', 'max'];
  return endpoint.apiStyle === 'anthropic' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['minimal', 'low', 'medium', 'high'];
}
export const effortLabel = (value: string): string => value === 'off' ? L('关闭思考', 'Thinking off') : value || L('自动', 'Auto');

export function requestBody(endpoint: Endpoint, system: string, messages: PromptMessage[], options: StreamOptions = {}): Record<string, unknown> {
  if (endpoint.apiStyle === 'anthropic') {
    return { model: endpoint.model, system, messages, stream: true, max_tokens: endpoint.maxTokens || DEFAULT_MAX_TOKENS,
      ...(endpoint.effort && endpoint.effort !== 'off' ? { output_config: { effort: endpoint.effort } } : {}) };
  }
  const body: Record<string, unknown> = { model: endpoint.model, messages: [{ role: 'system', content: system }, ...messages], stream: true };
  if (isDeepSeek(endpoint)) {
    // DeepSeek's thinking switch; quick translation skips thinking unless an effort was chosen explicitly.
    const off = endpoint.effort === 'off' || (options.purpose === 'translate' && !endpoint.effort);
    body.thinking = { type: off ? 'disabled' : 'enabled' };
    if (!off && endpoint.effort) body.reasoning_effort = endpoint.effort;
  } else if (endpoint.effort && endpoint.effort !== 'off') body.reasoning_effort = endpoint.effort;
  return body;
}

/** A provider's structured error message helps diagnose model names and quotas. Only JSON error fields are shown —
 * never raw bodies — bounded and with the key masked. */
export function serviceDetail(raw: string, key: string): string {
  let detail = '';
  try {
    const json = record(JSON.parse(raw)); const error = json.error;
    detail = typeof error === 'string' ? error : str(record(error).message) || str(json.message) || str(json.detail);
  } catch { return ''; }
  detail = detail.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (key.length >= 8) detail = detail.split(key).join('***');
  return detail.length > 240 ? `${detail.slice(0, 240)}…` : detail;
}
function httpHint(status: number): string {
  if (status === 401 || status === 403) return L('请检查 API Key 和访问权限', 'Check the API key and access permissions');
  if (status === 402) return L('账户余额不足', 'Insufficient account balance');
  if (status === 404) return L('请检查 API 地址和模型名称', 'Check the API address and model name');
  if (status === 408 || status === 504) return L('服务响应超时，请稍后重试', 'The service timed out; please retry later');
  if (status === 429) return L('请求过于频繁或额度不足，请稍后重试', 'Too many requests or quota exceeded; please retry later');
  if (status >= 500) return L('服务暂时繁忙或不可用，请稍后重试或切换服务', 'The service is busy or unavailable; retry later or switch services');
  return L('请求被拒绝，请检查模型名称和推理强度设置', 'Request rejected; check the model name and reasoning effort');
}
async function httpError(response: Response, key: string): Promise<Error> {
  const detail = serviceDetail(await response.text().then(text => text.slice(0, 4000), () => ''), key);
  return new Error(L(`API 请求失败（HTTP ${response.status}）：${httpHint(response.status)}${detail ? `。服务返回：${detail}` : ''}`,
    `API request failed (HTTP ${response.status}): ${httpHint(response.status)}${detail ? `. Service said: ${detail}` : ''}`));
}
/** OpenAI-compatible services name their reasoning field differently (DeepSeek, Qwen, Kimi: reasoning_content; OpenRouter: reasoning). */
const reasoningOf = (value: Record<string, unknown>): string => str(value.reasoning_content) || str(value.reasoning);

export async function* stream(endpoint: Endpoint, key: string, system: string, messages: PromptMessage[], signal: AbortSignal, fetcher: FetchPort,
  options: StreamOptions = {}): AsyncGenerator<StreamChunk> {
  validateEndpoint(endpoint);
  const response = await fetcher(customApiUrl(endpoint), { method: 'POST', headers: headers(endpoint, key),
    body: JSON.stringify(requestBody(endpoint, system, messages, options)), signal, redirect: 'error', credentials: 'omit' });
  if (!response.ok) throw await httpError(response, key);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error(L('API 响应过大', 'The API response is too large'));
    const json = record(JSON.parse(raw));
    if (json.error) { const detail = serviceDetail(raw, key); throw new Error(detail ? L(`API 返回错误：${detail}`, `API error: ${detail}`) : L('API 返回错误，请检查模型和请求参数', 'API error; check the model and request parameters')); }
    if (endpoint.apiStyle === 'anthropic') {
      if (json.stop_reason && json.stop_reason !== 'end_turn' && json.stop_reason !== 'stop_sequence') throw new Error(L('模型响应未完整结束', 'The model response did not finish'));
      const blocks = Array.isArray(json.content) ? json.content.map(record) : [];
      const thinking = blocks.filter(b => b.type === 'thinking').map(b => str(b.thinking)).join('');
      const text = blocks.filter(b => !b.type || b.type === 'text').map(b => str(b.text)).join('');
      if (!text) throw new Error(L('API 未返回正文', 'The API returned no answer'));
      if (thinking) yield { type: 'reasoning', text: thinking };
      yield { type: 'text', text };
    } else {
      const choice = record(Array.isArray(json.choices) ? json.choices[0] : undefined);
      if (choice.finish_reason && choice.finish_reason !== 'stop') throw new Error(L('模型响应未完整结束', 'The model response did not finish'));
      const message = record(choice.message);
      const split = new ThinkTagSplitter();
      const chunks = [...(reasoningOf(message) ? [{ type: 'reasoning' as const, text: reasoningOf(message) }] : []), ...split.push(str(message.content)), ...split.flush()];
      if (!chunks.some(c => c.type === 'text')) throw new Error(L('API 未返回正文', 'The API returned no answer'));
      yield* chunks;
    }
    return;
  }
  if (!response.body) throw new Error(L('API 未返回数据流', 'The API returned no stream'));
  yield { type: 'status', status: 'connected' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SSEDecoder();
  const split = new ThinkTagSplitter();
  let complete = false;
  let received = false;
  let thought = false;
  let queued = false;
  let finish = '';
  try {
    while (!complete) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      const events = sse.push(decoder.decode(value, { stream: !done }), done);
      if (!queued && sse.comments > 0 && !received && !thought) { queued = true; yield { type: 'status', status: 'queued' }; }
      for (const event of events) {
        if (event === '[DONE]') { complete = true; break; }
        const json = record(JSON.parse(event));
        if (json.error || json.type === 'error') { const detail = serviceDetail(event, key); throw new Error(detail ? L(`API 数据流返回错误：${detail}`, `API stream error: ${detail}`) : L('API 数据流返回错误，请重试', 'API stream error; please retry')); }
        const chunks: StreamChunk[] = [];
        if (endpoint.apiStyle === 'anthropic') {
          const delta = record(json.delta);
          if (json.type === 'content_block_delta' && delta.type === 'text_delta') chunks.push({ type: 'text', text: str(delta.text) });
          if (json.type === 'content_block_delta' && delta.type === 'thinking_delta') chunks.push({ type: 'reasoning', text: str(delta.thinking) });
          if (json.type === 'content_block_start' && record(json.content_block).type === 'text') chunks.push({ type: 'text', text: str(record(json.content_block).text) });
          if (json.type === 'message_delta') finish = str(delta.stop_reason);
          if (json.type === 'message_stop') complete = true;
        } else {
          const choice = record(Array.isArray(json.choices) ? json.choices[0] : undefined);
          const delta = record(choice.delta);
          if (reasoningOf(delta)) chunks.push({ type: 'reasoning', text: reasoningOf(delta) });
          chunks.push(...split.push(str(delta.content)));
          if (choice.finish_reason) { finish = str(choice.finish_reason); complete = true; chunks.push(...split.flush()); }
        }
        for (const chunk of chunks) {
          if (chunk.type === 'status' || !chunk.text) continue;
          if (chunk.type === 'text') received = true; else thought = true;
          yield chunk;
        }
      }
      if (done) break;
    }
    for (const chunk of split.flush()) { if (chunk.type === 'text' && chunk.text) received = true; yield chunk; }
    signal.throwIfAborted();
    if (!complete) throw new Error(L('连接提前关闭，响应可能不完整', 'The connection closed early; the response may be incomplete'));
    if (finish === 'length' || finish === 'max_tokens') throw new Error(L('回答达到输出长度上限，已保留收到的内容；可在服务设置中提高最大输出', 'The answer hit the output limit; what arrived is kept. You can raise the limit in the service settings.'));
    if (finish === 'refusal' || finish === 'content_filter') throw new Error(L('服务拒绝了这次请求，已保留收到的内容', 'The service refused this request; what arrived is kept'));
    if (finish && !['stop', 'end_turn', 'stop_sequence'].includes(finish)) throw new Error(L(`响应未完整结束（${finish}）`, `The response did not finish (${finish})`));
    if (!received) throw new Error(thought ? L('模型只返回了思考过程，没有正文；可重试或调低推理强度', 'The model only returned its thinking, no answer; retry or lower the reasoning effort') : L('模型未返回可显示的正文', 'The model returned no displayable answer'));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function discoverModels(endpoint: Endpoint, key: string, signal: AbortSignal, fetcher: FetchPort): Promise<string[]> {
  validateEndpoint({ ...endpoint, model: endpoint.model || 'discovery' });
  const response = await fetcher(customApiUrl(endpoint, 'models'), { method: 'GET', headers: headers(endpoint, key), signal, redirect: 'error', credentials: 'omit' });
  if (!response.ok) throw await httpError(response, key);
  const json = record(await response.json());
  const models = Array.isArray(json.data) ? json.data.map(v => str(record(v).id)).filter(Boolean) : [];
  if (!models.length) throw new Error(L('服务未提供模型列表，请手动填写模型', 'The service does not list models; enter a model manually'));
  return [...new Set(models)].sort();
}
