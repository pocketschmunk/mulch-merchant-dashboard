import { createServer } from 'node:http';
import { Models } from './models.js';
import { object, readBody, send, fail, errorResponse } from './security.js';
import { premium } from './validation.js';
import { PLANS, TIERS } from './fees.js';
import { capabilities, setupChecks } from './readiness.js';
import { securityHeaders, serveStatic } from './static.js';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_PATHS = new Set(['signup', 'login', 'logout', 'forgot-password', 'resend-verification', 'verify-email', 'reset-password'].map(value => `/api/auth/${value}`));
const publicUser = user => ({ id: user.id, email: user.email, name: user.name });

function origin(req, env) {
  let expected;
  try {
    const parsed = new URL(env.APP_ORIGIN);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== env.APP_ORIGIN) throw new Error();
    expected = parsed.origin;
  } catch { fail('auth_not_configured', 'A valid exact APP_ORIGIN is required for authenticated mutations.', 503); }
  if (req.headers.origin !== expected) fail('csrf_invalid', 'The request origin does not match this application.', 403);
}
async function csrf(req, session, auth, env) {
  origin(req, env);
  if (!req.headers['x-csrf-token']) fail('csrf_invalid', 'The session CSRF token is required.', 403);
  if (await auth.verifyCsrf(req, session) === false) fail('csrf_invalid', 'The session CSRF token is invalid.', 403);
}

export function createApp({ pool, env = process.env, auth, entitlements }) {
  if (!pool?.query || !pool?.connect || !auth?.session || !auth?.handle || !auth?.verifyCsrf || !entitlements?.access || !entitlements?.refresh) throw new TypeError('A PostgreSQL pool, real authentication interface and entitlement interface are required.');
  const models = new Models(pool, env);
  const server = createServer(async (req, res) => {
    securityHeaders(res, env);
    try {
      const url = new URL(req.url, 'http://application.invalid');
      const pathname = url.pathname;
      if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true, sourceOnly: true });
      if (req.method === 'GET' && pathname === '/api/public-config') return send(res, 200, {
        brand: 'Mulch Checkout', authMode: 'email', authConfigured: auth.configured === true,
        checkoutOrigin: 'https://pay.mulchcheckout.com', policy: { tiers: TIERS, monthlyPlans: { standard: 150, premium: 250 } }, sourceOnly: true
      });
      if (AUTH_PATHS.has(pathname)) {
        if (req.method !== 'POST') fail('not_found', 'API route not found.', 404);
        const body = await readBody(req);
        // Auth owns signup/login/recovery origin enforcement and logout CSRF.
        const handled = await auth.handle(req, res, url, body);
        if (handled === false && !res.writableEnded) fail('not_found', 'API route not found.', 404);
        return;
      }
      if (!pathname.startsWith('/api/')) return await serveStatic(req, res, url, env);
      const session = await auth.session(req);
      if (req.method === 'GET' && pathname === '/api/session') return send(res, 200, {
        authenticated: Boolean(session), ...(session ? { user: publicUser(session.user), csrfToken: session.csrfToken } : {}), authMode: 'email'
      });
      if (!session?.user) fail('unauthenticated', 'Sign in to your verified Mulch account.', 401);
      if (MUTATIONS.has(req.method)) await csrf(req, session, auth, env);
      if (req.method === 'GET' && pathname === '/api/access') return send(res, 200, await entitlements.access(session.user));
      if (req.method === 'POST' && pathname === '/api/access/refresh') {
        object(await readBody(req), []);
        return send(res, 200, await entitlements.refresh(session.user));
      }
      // Authentication alone never unlocks even configuration or store lists.
      const access = await entitlements.access(session.user);
      if (access?.hasAccess !== true) fail('subscription_required', 'Purchase and verify an active paid Standard or Premium membership before opening any dashboard.', 402);
      if (pathname === '/api/stores') {
        if (req.method === 'GET') return send(res, 200, { stores: await models.stores(session.user) });
        if (req.method === 'POST') return send(res, 201, { store: await models.createStore(session.user, await readBody(req)) });
      }
      const match = /^\/api\/stores\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname);
      if (!match) fail('not_found', 'API route not found.', 404);
      const [, storeId, section, part, resourceId, action] = match;
      const row = await models.storeRow(session.user.id, storeId);
      if (section === 'resources' && part) {
        if (!resourceId && !action && req.method === 'GET') return send(res, 200, { items: await models.resources(row, part) });
        if (!resourceId && !action && req.method === 'POST') return send(res, 201, { item: await models.saveResource(session.user, storeId, part, await readBody(req)) });
        if (resourceId && !action && req.method === 'PUT') return send(res, 200, { item: await models.saveResource(session.user, storeId, part, await readBody(req), resourceId) });
        if (resourceId && !action && req.method === 'DELETE') {
          if (req.headers['content-type'] || Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) object(await readBody(req), []);
          return send(res, 200, await models.deleteResource(session.user, storeId, part, resourceId));
        }
        if (resourceId && action === 'activate' && req.method === 'POST') {
          object(await readBody(req), []);
          await models.activate(session.user, storeId, part, resourceId);
        }
      }
      if (section === 'connections' && !resourceId && !action && req.method === 'POST') {
        const body = await readBody(req);
        if (part === 'shopify') {
          object(body, ['shopDomain'], ['shopDomain']);
          const { domain } = await import('./security.js');
          if (domain(body.shopDomain) !== row.shop_domain) fail('invalid_input', 'Connect only the shop domain bound to this store.');
          fail('connection_not_configured', 'Verified Shopify OAuth and ownership adapters are not configured. No external authorization URL was invented.', 503);
        }
        if (part === 'payments') {
          object(body, ['action'], ['action']);
          if (!['connect', 'refresh', 'payouts'].includes(body.action)) fail('invalid_input', 'Payment action must be connect, refresh or payouts.');
          return send(res, 200, await models.fees.connection(row, body.action));
        }
      }
      if (part || resourceId || action) fail('not_found', 'API route not found.', 404);
      if (section === 'consent' && req.method === 'POST') return send(res, 200, { store: await models.consent(session.user, storeId, await readBody(req)) });
      if (req.method !== 'GET') fail('not_found', 'API route not found.', 404);
      switch (section) {
        case 'bootstrap': {
          const [store, resources, analytics, fees] = await Promise.all([models.publicStore(row), models.resourcesForBootstrap(row), models.analytics(row), models.fees.summary(storeId)]);
          return send(res, 200, { store, user: publicUser(session.user), resources, analytics, fees, capabilities: capabilities(row.plan) });
        }
        case 'analytics': {
          for (const key of url.searchParams.keys()) if (key !== 'period') fail('invalid_input', 'Only the analytics period query is supported.');
          return send(res, 200, { analytics: await models.analytics(row, url.searchParams.get('period') || '30d') });
        }
        case 'orders': return send(res, 200, { items: await models.orders(row) });
        case 'abandoned': return send(res, 200, { items: [] });
        case 'subscribers': premium(row.plan); return send(res, 200, { items: [] });
        case 'recovery': premium(row.plan); return send(res, 200, { items: [], metrics: {} });
        case 'fees': return send(res, 200, await models.fees.summary(storeId));
        case 'setup-check': {
          const [store, fees] = await Promise.all([models.publicStore(row), models.fees.summary(storeId)]);
          return send(res, 200, { checks: setupChecks(store, fees) });
        }
        case 'billing': return send(res, 200, models.billing(row));
        case 'ai-mcp': return send(res, 200, { configured: false, verified: false, message: 'AI & MCP scope is unverified. No AI service, MCP credential or live automation is configured.' });
        default: fail('not_found', 'API route not found.', 404);
      }
    } catch (error) { errorResponse(res, error); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}
