const BASE = '';

async function request(path, options) {
  const opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { throw new Error('服务返回了非 JSON 内容'); }
  if (!res.ok) throw new Error(data.error || ('请求失败：' + res.status));
  return data;
}

export function get(path) { return request(path); }
export function post(path, body) { return request(path, { method: 'POST', body: JSON.stringify(body || {}) }); }
export function patch(path, body) { return request(path, { method: 'PATCH', body: JSON.stringify(body || {}) }); }
export function del(path) { return request(path, { method: 'DELETE' }); }

export const api = { get, post, patch, del };
