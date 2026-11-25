import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Requester } from '../lib/api';
import { describeError } from '../lib/api';
import { navigate } from '../lib/navigation';
import { Brand, Field, Notice } from '../components/UI';
import type { Session } from '../types';
const headings: Record<string, string> = {
  '/login': 'Sign in to Mulch', '/signup': 'Create your Mulch account', '/forgot-password': 'Reset your password',
  '/reset-password': 'Choose a new password', '/verify-email': 'Verify your email',
};
export function AuthPage({ path, api, configured, onLogin }: { path: string; api: Requester; configured: boolean | null; onLogin: (session: Session) => Promise<void> }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const login = path === '/login', signup = path === '/signup', reset = path === '/reset-password', verify = path === '/verify-email';
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      if (login) {
        const response = await api<Session>('/api/auth/login', { method: 'POST', body: { email, password } });
        await onLogin(response);
      } else {
        const endpoint = signup ? 'signup' : reset ? 'reset-password' : verify ? 'verify-email' : 'forgot-password';
        const body = signup ? { name, email, password } : reset ? { token, password } : verify ? { token } : { email };
        const response = await api<{ message: string }>(`/api/auth/${endpoint}`, { method: 'POST', body });
        setMessage(response.message); setDone(true); setPassword('');
        if (reset || verify) { setToken(''); window.history.replaceState(null, '', path); }
      }
    } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError('');
    try { const response = await api<{ message: string }>('/api/auth/resend-verification', { method: 'POST', body: { email } }); setMessage(response.message); }
    catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }
  return <div className="auth-layout"><aside className="auth-story"><Brand /><div><span className="eyebrow">THE MULCH MERCHANT WORKSPACE</span><h1>Your money,<br />when you need it</h1><p>A clearer checkout. A connected store.<br />One paid membership per store.</p></div><small>Original Mulch checkout · Standard / Premium</small></aside><main className="auth-main"><div className="auth-card"><Brand /><h2>{headings[path] ?? headings['/login']}</h2><p className="muted">{verify ? 'Use your single-use email token. Verification does not sign you in or grant paid access.' : reset ? 'Your reset token is single-use. Resetting revokes existing sessions; sign in again afterward.' : 'Verify your email, sign in, then purchase a plan. No dashboard or configuration is available before verified payment.'}</p>
    {configured === false && <Notice error>Email authentication is not configured on this server. No email or login has been confirmed.</Notice>}
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    {(!done || login) && <form onSubmit={submit} className="form-stack">
      {signup && <Field label="Your name"><input autoComplete="name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Field>}
      {(!reset && !verify) && <Field label="Email address"><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></Field>}
      {(reset || verify) && <Field label={reset ? 'Password-reset token' : 'Email-verification token'} hint="The token is submitted only when you press the button below."><input required autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} /></Field>}
      {(login || signup || reset) && <Field label="Password" hint={!login ? 'At least 12 characters. Use a unique password.' : undefined}><input type="password" required minLength={login ? 1 : 12} maxLength={256} autoComplete={login ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></Field>}
      <button className="button primary" disabled={busy || configured === false}>{busy ? 'Submitting…' : login ? 'Sign in' : signup ? 'Create account & send verification' : reset ? 'Reset password' : verify ? 'Verify email' : 'Send reset instructions'}</button>
    </form>}
    {done && !login && <button className="button primary" onClick={() => navigate('/login')}>Return to sign in</button>}
    <div className="auth-links">{login ? <><button className="link" onClick={() => navigate('/signup')}>Create account</button><button className="link" onClick={() => navigate('/forgot-password')}>Forgot password?</button></> : <button className="link" onClick={() => navigate('/login')}>Back to sign in</button>}<button className="link" onClick={() => navigate('/verify-email')}>Verify email</button></div>
    {(login || verify || signup) && <details className="resend"><summary>Need another verification email?</summary><Field label="Account email"><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></Field><button className="button" disabled={busy || !email || configured === false} onClick={resend}>Resend verification</button></details>}
    <small className="muted">Mulch membership billing is separate from your customers’ checkout payments.</small>
  </div></main></div>;
}
