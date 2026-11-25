import { useCallback, useEffect, useRef, useState } from 'react';
import type { Access, Bootstrap, PublicConfig, Session, Store } from './types';
import { ApiError, describeError, request, storePath } from './lib/api';
import type { Requester } from './lib/api';
import { loadAccess, paidBindingKey, reconcilePaidStores, validStoreAccess } from './lib/access';
import { authPaths, paidGate, resolveRoute } from './lib/routes';
import { navigate, usePath } from './lib/navigation';
import { Brand, Loading, Notice } from './components/UI';
import { Shell } from './components/Shell';
import { AuthPage } from './pages/Auth';
import { PurchasePage, StoreCreator } from './pages/Purchase';
import { DashboardPage } from './pages/Dashboard';
export function App() {
  const path = usePath(); const generation = useRef(0); const pollPending = useRef(false);
  const [session, setSession] = useState<Session | null>(null); const [access, setAccess] = useState<Access | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null); const [stores, setStores] = useState<Store[]>([]); const [storeId, setStoreId] = useState('');
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null); const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false); const [reconciling, setReconciling] = useState(false); const [error, setError] = useState(''); const [bootstrapError, setBootstrapError] = useState('');
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('mulch-appearance') === 'dark'; } catch { return false; } });
  const gate = paidGate(session, access);
  const bindingKey = paidBindingKey(access);
  const api: Requester = useCallback(async <T,>(url: string, options?: { method?: string; body?: unknown; csrf?: string }): Promise<T> => {
    try { return await request<T>(url, options); }
    catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
        generation.current++; setAccess(null); setStores([]); setStoreId(''); setBootstrap(null);
        if (err.status === 401) setSession(null);
        setError(describeError(err)); navigate(err.status === 401 ? '/login' : '/purchase', true);
      }
      throw err;
    }
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('mulch-appearance', dark ? 'dark' : 'light'); } catch { /* Appearance is optional, never an access signal. */ } }, [dark]);
  async function applySession(next: Session, refresh = false) {
    if (!next.authenticated || !next.user || !next.csrfToken) throw new Error('The server did not establish a complete authenticated session.');
    const version = ++generation.current; setSession(next); setBusy(true); setAccess(null); setStores([]); setBootstrap(null); setError('');
    try {
      const result = await loadAccess(api, next, refresh);
      if (version !== generation.current) return;
      setAccess(result.access); setStores(result.stores); setStoreId(result.stores[0]?.id ?? '');
      navigate(paidGate(next, result.access) === 'dashboard' ? '/dashboard' : '/purchase', true);
    } catch (err) { if (version === generation.current) { setError(describeError(err)); navigate('/purchase', true); } }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true; const version = ++generation.current;
    async function initialize() {
      try {
        const [nextConfig, nextSession] = await Promise.all([api<PublicConfig>('/api/public-config').catch(() => null), api<Session>('/api/session')]);
        if (!active || version !== generation.current) return;
        setConfig(nextConfig); setSession(nextSession);
        if (nextSession.authenticated) {
          const result = await loadAccess(api, nextSession);
          if (!active || version !== generation.current) return;
          setAccess(result.access); setStores(result.stores); setStoreId(result.stores[0]?.id ?? '');
        }
      } catch (err) { if (active) { setError(describeError(err)); setAccess(null); setStores([]); } }
      finally { if (active) setInitialized(true); }
    }
    void initialize(); return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!initialized || authPaths.includes(path as typeof authPaths[number]) && ['/verify-email', '/reset-password', '/forgot-password'].includes(path)) return;
    if (gate === 'login' && !authPaths.includes(path as typeof authPaths[number])) navigate('/login', true);
    else if (gate === 'purchase' && path !== '/purchase') navigate('/purchase', true);
    else if (gate === 'dashboard' && (path === '/' || path === '/purchase' || path === '/login' || path === '/signup')) navigate('/dashboard', true);
  }, [initialized, gate, path]);
  async function refreshAccess() { if (session?.authenticated) await applySession(session, true); }
  // Current server leases are checked regularly and on return to the page. Uncertainty removes all private data.
  useEffect(() => {
    if (!session?.authenticated || gate !== 'dashboard') return;
    const poll = async () => {
      if (pollPending.current) return;
      pollPending.current = true;
      let version = generation.current;
      try {
        const next = await api<Access>('/api/access');
        if (version !== generation.current) return;
        if (paidGate(session, next) !== 'dashboard') { generation.current++; setAccess(next); setStores([]); setBootstrap(null); setStoreId(''); navigate('/purchase', true); }
        else {
          if (paidBindingKey(next) !== bindingKey) {
            version = ++generation.current;
            setBootstrap(null); setBootstrapError(''); setReconciling(true);
          }
          const current = await reconcilePaidStores(api, next, storeId);
          if (version !== generation.current) return;
          setAccess(next); setStores(current.stores); setStoreId(current.storeId);
        }
      } catch (err) { if (version === generation.current) { generation.current++; setAccess(null); setStores([]); setBootstrap(null); setStoreId(''); setError(describeError(err)); navigate('/purchase', true); } }
      finally { pollPending.current = false; setReconciling(false); }
    };
    const interval = window.setInterval(() => void poll(), 60_000);
    const visibility = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visibility); };
  }, [session, gate, api, bindingKey, storeId]);
  const loadBootstrap = useCallback(async () => {
    if (!storeId) return;
    const version = generation.current;
    const result = await api<Bootstrap>(storePath(storeId, 'bootstrap'));
    if (version !== generation.current) return;
    if (!validStoreAccess(result.store, access) || result.store.id !== storeId) throw new Error('The server did not return a store with current bound paid entitlement.');
    setBootstrap(result);
  }, [api, storeId, access]);
  useEffect(() => {
    if (gate !== 'dashboard' || !storeId) { setBootstrap(null); return; }
    let active = true; const version = generation.current; setBootstrap(null); setBootstrapError('');
    api<Bootstrap>(storePath(storeId, 'bootstrap')).then(result => {
      if (!active || version !== generation.current) return;
      if (!validStoreAccess(result.store, access) || result.store.id !== storeId) { setBootstrapError('No current server-verified paid store binding was returned.'); return; }
      setBootstrap(result);
    }).catch(err => { if (active) setBootstrapError(describeError(err)); });
    return () => { active = false; };
  }, [api, gate, storeId, bindingKey]);
  async function logout() {
    if (!session?.csrfToken) { setSession(null); return; }
    setBusy(true); setError('');
    try { await api('/api/auth/logout', { method: 'POST', csrf: session.csrfToken, body: {} }); generation.current++; setSession(null); setAccess(null); setStores([]); setBootstrap(null); setStoreId(''); navigate('/login', true); }
    catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }
  async function onCreated(store: Store) {
    if (!session) return;
    const version = generation.current;
    const result = await loadAccess(api, session);
    if (version !== generation.current) return;
    setAccess(result.access); setStores(result.stores); setStoreId(result.stores.some(item => item.id === store.id) ? store.id : ''); navigate('/dashboard', true);
  }
  function onStore(id: string) { if (stores.some(store => store.id === id && validStoreAccess(store, access))) { setBootstrap(null); setBootstrapError(''); setStoreId(id); } }
  if (!initialized) return <div className="boot-screen"><Brand /><Loading text="Checking session and paid membership…" /></div>;
  if (authPaths.includes(path as typeof authPaths[number])) return <><AuthPage key={path} path={path} api={api} configured={config?.authConfigured ?? null} onLogin={next => applySession(next)} />{error && <div className="global-error"><Notice error>{error}</Notice></div>}</>;
  if (gate === 'login') return <div className="boot-screen"><Loading text="Returning to sign in…" /></div>;
  if (reconciling) return <div className="boot-screen"><Brand /><Loading text="Refreshing paid store permissions…" /></div>;
  if (gate === 'purchase' || !access || !session?.csrfToken) return <PurchasePage session={session!} access={access} error={error} busy={busy} refresh={refreshAccess} logout={logout} />;
  if (!stores.length) return <div className="gate-page"><header className="gate-header"><Brand /><div className="row"><button className="button small" onClick={refreshAccess}>Refresh memberships</button><button className="button small" onClick={logout}>Sign out</button></div></header><main className="gate-content"><span className="eyebrow">ACTIVE PAID MEMBERSHIP VERIFIED</span><h1>Connect your purchased store.</h1>{error && <Notice error>{error}</Notice>}<StoreCreator access={access} csrf={session.csrfToken} api={api} onCreated={onCreated} /></main></div>;
  const route = resolveRoute(path), store = stores.find(item => item.id === storeId);
  if (!route) return <div className="boot-screen"><Brand /><Notice error>This page does not exist. No public dashboard or bypass route is available.</Notice><button className="button" onClick={() => navigate('/dashboard')}>Return to paid workspace</button></div>;
  if (!store) return <div className="boot-screen"><Notice error>Select a store with current paid membership proof.</Notice><button className="button" onClick={() => onStore(stores[0].id)}>Select available paid store</button></div>;
  return <Shell route={route} stores={stores} store={store} session={session} onStore={onStore} logout={logout} refreshAccess={refreshAccess} dark={dark} toggleTheme={() => setDark(!dark)}>{error && <Notice error>{error}</Notice>}{bootstrapError ? <Notice error>{bootstrapError}<button className="button small" onClick={async () => { setBootstrapError(''); try { await loadBootstrap(); } catch (err) { setBootstrapError(describeError(err)); } }}>Retry server data</button></Notice> : bootstrap?.store.id === storeId ? <DashboardPage key={`${storeId}:${route.path}`} route={route} bootstrap={bootstrap} access={access} stores={stores} csrf={session.csrfToken} api={api} onChanged={loadBootstrap} onCreated={onCreated} onStore={onStore} refreshAccess={refreshAccess} /> : <Loading text="Loading this paid store’s server data…" />}</Shell>;
}
