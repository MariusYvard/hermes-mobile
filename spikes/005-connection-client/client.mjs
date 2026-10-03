// Portable web-API candidate; React Native has NOT been exercised.
export class ConnectionError extends Error {
  constructor(code, status) { super(code); this.name = 'ConnectionError'; this.code = code; if (status !== undefined) this.status = status; }
  toJSON() { return {code: this.code, ...(this.status === undefined ? {} : {status: this.status})}; }
}
const fail = (code, status) => { throw new ConnectionError(code, status); };
export function createClient({origin, token = '', timeoutMs = 3000, maxBytes = 262144} = {}) {
  let base;
  try {
    if (typeof origin !== 'string' || !/^https?:\/\/[^/?#\\\s]+\/?$/.test(origin)) throw 0;
    base = new URL(origin);
    if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname)))) throw 0;
    // Reject alternate numeric spellings normalized by WHATWG URL.
    if (base.protocol === 'http:' && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?\/?$/.test(origin)) throw 0;
  } catch { fail('invalid_url'); }
  let discovered, discoveryGeneration = 0;
  if (typeof token !== 'string' || token.length > 8192 || /[^\x21-\x7e]/.test(token) ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 ||
    !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) fail('invalid_options');
  async function request(path, method = 'GET', payload, sessionLookup = false) {
    if (typeof fetch !== 'function' || typeof AbortController !== 'function' || typeof TextDecoder !== 'function') fail('unsupported_runtime');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader;
    try {
      const response = await fetch(base.origin + path, {method, signal:controller.signal, redirect:'manual', headers:{...(token ? {Authorization:`Bearer ${token}`} : {}), ...(payload === undefined ? {} : {'Content-Type':'application/json'})}, ...(payload === undefined ? {} : {body:JSON.stringify(payload)})});
      if (response.status >= 300 && response.status < 400) fail('redirect_blocked',response.status);
      const missingLookup = response.status === 404 && sessionLookup;
      if (!response.ok && !missingLookup) fail(({401:'unauthorized',403:'forbidden',404:'unsupported_transport',409:'conflict'})[response.status] || 'http_error',response.status);
      if (Number(response.headers.get('content-length')) > maxBytes) fail('response_too_large');
      if (!response.body?.getReader) fail('unsupported_runtime');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8',{fatal:true}); let bytes = 0, text = '';
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) fail('response_too_large');
        try { text += decoder.decode(value,{stream:true}); } catch { fail('invalid_json'); }
      }
      let body;
      try { text += decoder.decode(); body = JSON.parse(text); }
      catch { fail(missingLookup ? 'unsupported_transport' : 'invalid_json', missingLookup ? 404 : undefined); }
      if (missingLookup) fail(body?.error?.code === 'session_not_found' ? 'session_not_found' : 'unsupported_transport', 404);
      return body;
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      fail(controller.signal.aborted ? 'timeout' : 'unreachable');
    } finally {
      clearTimeout(timer); controller.abort();
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    }
  }
  async function capabilities() {
    const generation = ++discoveryGeneration;
    discovered = undefined;
    const body = await request('/v1/capabilities');
    if (generation !== discoveryGeneration) fail('stale_discovery');
    if (body?.object !== 'hermes.api_server.capabilities' || body.platform !== 'hermes-agent') fail('invalid_contract');
    if (body.auth?.type !== 'bearer' || body.auth.required !== true) fail('insecure_auth');
    if (!body.features || typeof body.features !== 'object' || Array.isArray(body.features) || !body.endpoints || typeof body.endpoints !== 'object' || Array.isArray(body.endpoints)) fail('invalid_contract');
    discovered = body;
    return {session_resources: body.features?.session_resources === true};
  }
  function endpoint(name, method, path) {
    if (!discovered) fail('capabilities_required');
    const ep = discovered.endpoints?.[name];
    if (discovered.features?.session_resources !== true || ep?.method !== method || ep.path !== path) fail('unsupported_capability');
    // Never resolve a server-supplied URL. Only exact known relative templates are accepted.
    return path;
  }
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  function readableId(id) {
    if (typeof id !== 'string' || id.length === 0 || [...id].length > 256 ||
        id === '.' || id.includes('..') || /[\/\\\r\n\x00]/.test(id) || /^\p{L}:/u.test(id)) return false;
    // Reject lone UTF-16 surrogates before URL encoding can throw a native URIError.
    try { encodeURIComponent(id); return true; } catch { return false; }
  }
  function session(row) {
    if (!row || !readableId(row.id) || !(row.title === undefined || row.title === null || (typeof row.title === 'string' && row.title.length <= 4096))) fail('invalid_session_contract');
    return {id: row.id, title: row.title ?? null};
  }
  async function listSessions() {
    const body = await request(endpoint('sessions','GET','/api/sessions'));
    if (body?.object !== 'list' || !Array.isArray(body.data) || typeof body.has_more !== 'boolean') fail('invalid_session_contract');
    return {data:body.data.map(session),has_more:body.has_more};
  }
  async function getSession(id) {
    if (!readableId(id)) fail('invalid_input');
    const path = endpoint('session','GET','/api/sessions/{session_id}').replace('{session_id}',encodeURIComponent(id));
    const body = await request(path, 'GET', undefined, true);
    if (body?.object !== 'hermes.session' || body.session?.id !== id) fail('invalid_session_contract');
    return session(body.session);
  }
  async function createSession({id, title} = {}) {
    if (!validId(id) || typeof title !== 'string' || title.length > 200 || /[\r\n\x00]/.test(title)) fail('invalid_input');
    const body = await request(endpoint('session_create','POST','/api/sessions'),'POST',{id,title});
    if (body?.object !== 'hermes.session' || body.session?.id !== id) fail('invalid_session_contract');
    return session(body.session);
  }
  return Object.freeze({capabilities,listSessions,getSession,createSession});
}
