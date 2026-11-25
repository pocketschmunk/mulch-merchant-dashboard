import { useEffect, useState } from 'react';
export function navigate(path: string, replace = false) {
  if (!path.startsWith('/') || path.startsWith('//')) return;
  if (replace) window.history.replaceState(null, '', path); else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => { const listener = () => setPath(window.location.pathname); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); }, []);
  return path;
}
