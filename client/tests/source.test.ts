import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { routes, routeHref, authPaths } from '../src/lib/routes';
test('static route manifest exactly matches paid and authentication routes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manus-routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.routes.map((entry: { path: string }) => entry.path).sort(), ['/', ...authPaths, '/purchase', ...routes.map(route => routeHref(route.path))].sort());
});
test('production source has no demo, fixture or developer entitlement bypass', async () => {
  async function files(url: URL): Promise<URL[]> {
    const entries = await readdir(url, { withFileTypes: true }); const out: URL[] = [];
    for (const entry of entries) { const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url); if (entry.isDirectory()) out.push(...await files(path)); else if (/\.(tsx?|css)$/.test(entry.name)) out.push(path); }
    return out;
  }
  for (const file of await files(new URL('../src/', import.meta.url))) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /\/demo\b|fixture-store|fixture@example|DEV_USER|AUTH_BYPASS|VITE_.*(?:TOKEN|SECRET)|localStorage\.(?:setItem|getItem)\([^)]*(?:plan|entitlement|session)/i, file.pathname);
  }
});
