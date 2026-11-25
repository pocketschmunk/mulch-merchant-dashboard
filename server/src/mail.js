import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError } from './security.js';

export function authOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 ||
      /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.username || parsed.password || parsed.pathname !== '/' ||
      parsed.search || parsed.hash || parsed.origin !== value) return null;
  // Explicit HTTP loopback is for isolated tests/local operation only. It does
  // not alter password, verification, configuration or authorization checks.
  const loopback = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  const publicHttps = parsed.protocol === 'https:' && !isIP(parsed.hostname) &&
    !parsed.hostname.startsWith('[') && parsed.hostname.includes('.') &&
    !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(parsed.hostname);
  if (!loopback && !publicHttps) return null;
  return Object.freeze({ origin: parsed.origin, secure: !loopback });
}

export function mailConfiguration(env = {}) {
  const origin = authOrigin(env.APP_ORIGIN);
  const key = env.RESEND_API_KEY;
  const from = env.AUTH_EMAIL_FROM;
  // Verification of the sender/domain is an operator/provider prerequisite,
  // not something configuration presence can prove. These values stay server-only.
  const keyValid = typeof key === 'string' && key.length > 0 && key.length <= 512 && !/\s/.test(key);
  const fromValid = typeof from === 'string' && from.length <= 320 &&
    !/[\u0000-\u001f\u007f]/.test(from) &&
    /^(?:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+|[^<>]+ <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>)$/.test(from);
  return { origin, configured: Boolean(origin && keyValid && fromValid) };
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function createMailer({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  const configuration = mailConfiguration(env);

  async function send(email, subject, text, html) {
    if (!configuration.configured) {
      throw new AppError('auth_not_configured', 'Email authentication is not configured.', 503);
    }
    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [email], subject, html, text }),
      });
      if (!response.ok) throw new Error('Delivery unavailable');
      // Do not read, log, return or persist the provider response body.
      await response.body?.cancel();
    } catch {
      throw new AppError('mail_delivery_failed', 'Email delivery is temporarily unavailable.', 503);
    }
  }

  function tokenLink(path, token) {
    if (!configuration.origin || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new AppError('mail_delivery_failed', 'Email delivery is temporarily unavailable.', 503);
    }
    return `${configuration.origin.origin}${path}?token=${encodeURIComponent(token)}`;
  }

  return Object.freeze({
    configured: configuration.configured,
    async sendVerification({ email, token }) {
      const link = tokenLink('/verify-email', token);
      await send(email, 'Verify your Mulch email',
        `Verify your email: ${link}\nThis single-use link expires in 24 hours. If you did not request it, ignore this email. Email verification does not grant a paid plan or dashboard access.`,
        `<p>Verify your Mulch email. This single-use link expires in 24 hours.</p><p><a href="${escapeHtml(link)}">Verify email</a></p><p>If you did not request this, ignore this email. Verification does not grant a paid plan or dashboard access.</p>`);
    },
    async sendPasswordReset({ email, token }) {
      const link = tokenLink('/reset-password', token);
      await send(email, 'Reset your Mulch password',
        `Reset your password: ${link}\nThis single-use link expires in 15 minutes. If you did not request it, ignore this email.`,
        `<p>Reset your Mulch password. This single-use link expires in 15 minutes.</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`);
    },
    async sendPasswordChanged({ email }) {
      await send(email, 'Your Mulch password was changed',
        'Your Mulch password was changed and all sign-in sessions were revoked. Sign in normally with your new password. If this was not you, request a password reset immediately.',
        '<p>Your Mulch password was changed and all sign-in sessions were revoked. Sign in normally with your new password.</p><p>If this was not you, request a password reset immediately.</p>');
    },
  });
}
