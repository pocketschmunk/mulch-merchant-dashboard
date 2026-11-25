import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { send } from '../src/security.js';

export const USER = Object.freeze({ id: randomUUID(), email: 'api-fixture@example.test', name: 'API fixture' });
export const ENV = Object.freeze({ APP_ORIGIN: 'https://merchant.example.test', WHOP_ENVIRONMENT: 'disabled' });
export const CSRF = 'test-only-csrf-not-a-production-session';
export function fakeAuth(user = USER) {
  return {
    mode: 'email', configured: true,
    async session(req) { return req.headers['x-test-auth'] === 'yes' ? { user, csrfToken: CSRF } : null; },
    verifyCsrf(req) { return req.headers['x-csrf-token'] === CSRF; },
    async handle(req, res) { send(res, 202, { message: 'Test fixture handler only' }); return true; }
  };
}
export function fakeEntitlements(hasAccess = true) {
  const result = { hasAccess, entitlements: [], plans: [], verification: { configured: true, message: 'Test fixture only' } };
  return { access: async () => result, refresh: async () => result };
}
export async function withServer(work, options = {}) {
  const pool = options.pool || { query: async () => ({ rows: [] }), connect: async () => { throw new Error('No fixture transaction expected'); } };
  const server = createApp({ pool, env: { ...ENV, ...options.env }, auth: options.auth || fakeAuth(), entitlements: options.entitlements || fakeEntitlements() });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, authenticated = true, csrf = CSRF, origin = ENV.APP_ORIGIN, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(authenticated ? { 'x-test-auth': 'yes' } : {}), ...(origin !== null ? { Origin: origin } : {}),
      ...(csrf !== null ? { 'X-CSRF-Token': csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const content = await response.text();
    let data; try { data = JSON.parse(content); } catch { data = content; }
    return { status: response.status, headers: response.headers, data };
  };
  try { return await work(request, server); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
export function design(extra = []) {
  return { accent: '#2463eb', background: '#ffffff', logoUrl: '', heading: 'Secure checkout', language: 'en', blocks: [
    ...['contact', 'delivery', 'shipping', 'payment'].map(type => ({ id: type, type, title: type, body: '', visible: true })), ...extra
  ] };
}
