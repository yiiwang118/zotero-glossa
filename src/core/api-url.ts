/** Accept API roots, versioned roots, and explicit Anthropic Messages URLs. */
export function customApiUrl(endpoint: { baseUrl?: string; apiStyle?: string }, resource: 'chat' | 'models' = 'chat'): string {
  const url = new URL(endpoint.baseUrl?.trim() ?? '');
  if (!/^https?:$/.test(url.protocol)) throw new Error('Base URL must use HTTP(S).');
  let path = url.pathname.replace(/\/+$/, '');
  if (endpoint.apiStyle === 'anthropic') {
    const explicitResource = /\/(messages|models)$/.test(path);
    if (explicitResource) path = path.replace(/\/(messages|models)$/, '');
    else if (!/\/v\d+[a-z\d.-]*$/i.test(path)) path += '/v1';
    path += resource === 'models' ? '/models' : '/messages';
  } else {
    path += resource === 'models' ? '/models' : '/chat/completions';
  }
  url.pathname = path;
  url.hash = '';
  return url.toString();
}
