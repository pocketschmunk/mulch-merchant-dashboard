export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
export function fail(code, message, status = 400, details) { throw new AppError(code, message, status, details); }
export function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid_input', 'A JSON object is required.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('unknown_field', `Unsupported field: ${key.slice(0,80)}.`);
  for (const key of required) if (!(key in value)) fail('invalid_input', `Required field: ${key}.`);
  return value;
}
export function text(value, label, max = 100, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value)) fail('invalid_input', `${label} must be plain text, at most ${max} characters.`);
  return value.trim();
}
export function bool(value, label) { if (typeof value !== 'boolean') fail('invalid_input', `${label} must be boolean.`); return value; }
export function integer(value, label, min = 0, max = 100) { if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_input', `${label} must be an integer from ${min} to ${max}.`); return value; }
export function oneOf(value, values, label) { if (!values.includes(value)) fail('invalid_input', `${label} must be one of: ${values.join(', ')}.`); return value; }
export function uuid(value) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('not_found', 'Resource not found.', 404); return value; }
export function domain(value) {
  const result = text(value, 'Shopify domain', 253).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(result)) fail('invalid_input', 'Use the store.myshopify.com domain, not a URL.');
  return result;
}
export function country(value) {
  const result = text(value, 'Country', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(result)) fail('invalid_input', 'Country must be a two-letter code.');
  // This is a draft declaration, not verified identity or provider availability.
  return result;
}
export function safeUrl(value, label = 'URL', { image = false, empty = true } = {}) {
  if (value === '' && empty) return '';
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) fail('invalid_url', `${label} must be a plain HTTPS URL.`);
  let url; try { url = new URL(value); } catch { fail('invalid_url', `${label} is invalid.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /^(localhost|127\.|0\.|\[|169\.254\.|10\.|192\.168\.)/i.test(url.hostname)) fail('invalid_url', `${label} must use a public HTTPS hostname.`);
  let decoded; try { decoded = decodeURIComponent(url.pathname + url.search + url.hash); } catch { fail('invalid_url', 'Invalid URL encoding.'); }
  if (/shop\.app|shopify\.com|myshopify\.com/i.test(url.hostname) && /checkout|payments?|cart|shop.?pay/i.test(decoded)) fail('native_checkout_forbidden', 'Native Shopify payment/cart/checkout fallback is prohibited.');
  if (/shop.?pay|javascript:|data:|\/checkout(?:\/|\?|$)|\/payments?(?:\/|\?|$)/i.test(decoded)) fail('native_checkout_forbidden', 'External checkout/payment fallback paths are prohibited.');
  if (image && !/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(url.pathname + url.search)) fail('invalid_url', 'Image URL must name a supported raster image.');
  return url.href;
}
export function safeHtml(value) {
  if (typeof value !== 'string' || value.length > 8000) fail('invalid_html', 'Custom HTML must be at most 8000 characters.');
  // Deliberately small formatting-only HTML language. No attributes, URLs,
  // embedded resources, comments, CSS, SVG, script, entity markup or parser tricks.
  const allowed = new Set(['p','br','strong','em','b','i','ul','ol','li','h2','h3','div','span','blockquote']);
  const stack = []; let out = ''; let offset = 0;
  const escape = s => s.replace(/&(?!(?:amp|lt|gt|quot|#39);)/g,'&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const tags = /<[^>]*>/g;
  for (const match of value.matchAll(tags)) {
    const raw = value.slice(offset, match.index);
    if (raw.includes('<') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) fail('invalid_html', 'Malformed custom HTML.');
    out += escape(raw);
    const tag = /^<(\/?)([a-z0-9]+)\s*(\/?)>$/i.exec(match[0]);
    if (!tag || !allowed.has(tag[2].toLowerCase())) fail('invalid_html', 'Only formatting HTML tags without attributes are supported; scripts and JavaScript attributes are prohibited.');
    const name = tag[2].toLowerCase();
    if (name === 'br') { if (tag[1]) fail('invalid_html', 'Invalid br closing tag.'); out += '<br>'; }
    else if (tag[1]) { if (stack.pop() !== name || tag[3]) fail('invalid_html', 'HTML tags must be balanced.'); out += `</${name}>`; }
    else { if (tag[3]) fail('invalid_html', 'Only br may be self-closing.'); stack.push(name); out += `<${name}>`; }
    offset = match.index + match[0].length;
  }
  const tail = value.slice(offset);
  if (tail.includes('<') || stack.length) fail('invalid_html', 'HTML tags must be complete and balanced.');
  return out + escape(tail);
}
export async function readBody(req) {
  const length = Number(req.headers['content-length'] || 0);
  if (length > 65536) fail('body_too_large', 'JSON body exceeds 64 KiB.', 413);
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) fail('unsupported_media_type', 'Use application/json.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 65536) fail('body_too_large', 'JSON body exceeds 64 KiB.', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); object(value, Object.keys(value || {})); return value; }
  catch (error) { if (error instanceof AppError) throw error; fail('invalid_json', 'Malformed JSON body.'); }
}
export function send(res, status, value) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'" });
  res.end(JSON.stringify(value));
}
export function errorResponse(res, error) {
  if (res.headersSent) { res.destroy(); return; }
  if (error instanceof AppError) return send(res, error.status, {error:error.code,message:error.message,...(error.details ? {details:error.details} : {})});
  if (error?.code === '23505') return send(res,409,{error:'conflict',message:'This record already exists.'});
  // Never return SQL, stack, provider payloads or credentials.
  send(res,503,{error:'service_unavailable',message:'The operation is unavailable. No provider success is implied.'});
}
