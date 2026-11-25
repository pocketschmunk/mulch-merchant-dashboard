import { stat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './security.js';

const DEFAULT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
export function securityHeaders(res, env) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (env.APP_ORIGIN?.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
export async function serveStatic(req, res, url, env) {
  if (!['GET', 'HEAD'].includes(req.method)) fail('not_found', 'Route not found.', 404);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { fail('not_found', 'Route not found.', 404); }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part.startsWith('.'))) fail('not_found', 'Route not found.', 404);
  let root;
  try { root = await realpath(env.CLIENT_DIST || DEFAULT_DIST); } catch { fail('client_not_built', 'The standalone client build is not installed. Build client/dist before starting the release.', 503); }
  let target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) fail('not_found', 'Route not found.', 404);
  let info;
  try { info = await stat(target); } catch { /* Evaluate safe SPA fallback below. */ }
  if (!info?.isFile()) {
    if (path.extname(pathname) || pathname.startsWith('/assets/')) fail('not_found', 'Static asset not found.', 404);
    target = path.join(root, 'index.html');
  }
  let actual;
  try { actual = await realpath(target); } catch { fail('client_not_built', 'Client index.html is not installed.', 503); }
  if (!actual.startsWith(`${root}${path.sep}`)) fail('not_found', 'Static asset not found.', 404);
  const type = TYPES[path.extname(actual)];
  if (!type) fail('not_found', 'Static asset type is not served.', 404);
  const content = await readFile(actual);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length, 'Cache-Control': path.extname(actual) === '.html' ? 'private, no-store' : 'public, max-age=3600' });
  res.end(req.method === 'HEAD' ? undefined : content);
}
