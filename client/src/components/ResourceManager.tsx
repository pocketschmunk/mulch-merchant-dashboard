import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Design, Resource, ResourceKind } from '../types';
import type { Requester } from '../lib/api';
import { ApiError, describeError, storePath } from '../lib/api';
import { designConfig, initialDesign, validateDesign } from '../lib/builder';
import { freshConfig, premiumKinds, schemas, validateConfig } from '../lib/resourceSchemas';
import { Badge, Empty, Field, Notice } from './UI';
import { CheckoutBuilder } from './CheckoutBuilder';
import { ResourceFields } from './ResourceFields';
export function ResourceManager({ storeId, csrf, api, kind, premium, designs, onChanged }: { storeId: string; csrf: string; api: Requester; kind: ResourceKind; premium: boolean; designs: Resource[]; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<Resource[] | null>(null); const [selected, setSelected] = useState<Resource | null>(null);
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(''); const [config, setConfig] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const label = kind === 'checkout-design' ? 'Checkout design' : schemas[kind].label;
  const path = storePath(storeId, `resources/${kind}`);
  async function load() {
    const response = await api<{ items: Resource[] }>(path); setItems(response.items);
  }
  useEffect(() => {
    let active = true; setItems(null); setEditing(false); setError(''); setMessage('');
    api<{ items: Resource[] }>(path).then(response => { if (active) setItems(response.items); }).catch(err => { if (active) setError(describeError(err)); });
    return () => { active = false; };
  }, [path, api]);
  function edit(item: Resource | null) {
    setSelected(item); setTitle(item?.title ?? '');
    setConfig(item ? structuredClone(item.config) : kind === 'checkout-design' ? designConfig(initialDesign()) : freshConfig(kind));
    setEditing(true); setError(''); setMessage(''); setConflict(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!title.trim() || title.length > 100) { setError('A resource title of at most 100 characters is required.'); return; }
    const validation = kind === 'checkout-design' ? validateDesign(config as unknown as Design, premium) : validateConfig(kind, config);
    if (validation) { setError(validation); return; }
    if (kind === 'experiment' && (!designs.some(design => design.id === config.variantA) || !designs.some(design => design.id === config.variantB))) { setError('Both variants must be checkout designs owned by this store.'); return; }
    setBusy(true);
    try {
      const body = selected ? { title, config, version: selected.version } : { title, config };
      const response = await api<{ item: Resource }>(selected ? `${path}/${encodeURIComponent(selected.id)}` : path, { method: selected ? 'PUT' : 'POST', csrf, body });
      setSelected(response.item); setConfig(response.item.config); setMessage('Draft saved to the server. No live payment, email, pixel or experiment was activated.');
      await load(); await onChanged();
    } catch (err) { setError(describeError(err)); setConflict(err instanceof ApiError && err.status === 409); } finally { setBusy(false); }
  }
  async function remove(item: Resource) {
    if (!window.confirm(`Delete draft “${item.title}”? This cannot be undone.`)) return;
    setBusy(true); setError(''); setMessage('');
    try { await api(`${path}/${encodeURIComponent(item.id)}`, { method: 'DELETE', csrf }); if (selected?.id === item.id) setEditing(false); await load(); await onChanged(); setMessage('Resource deleted.'); }
    catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }
  async function activate(item: Resource) {
    setBusy(true); setError(''); setMessage('');
    try { await api(`${path}/${encodeURIComponent(item.id)}/activate`, { method: 'POST', csrf, body: {} }); await load(); await onChanged(); setMessage('Server activation response received. Verify setup evidence before taking payments.'); }
    catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }
  if (premiumKinds.includes(kind) && !premium) return <Notice>Premium is required for customer subscription configuration. Standard includes the shared one-time checkout features.</Notice>;
  return <section className="panel resource-manager"><div className="panel-head"><div><h2>{label} drafts</h2><small className="muted">Saved configuration ≠ connected ≠ test-verified</small></div><button className="button primary small" disabled={busy} onClick={() => edit(null)}>New {label.toLowerCase()}</button></div>{error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    {conflict && <button className="button small" onClick={async () => { try { const response = await api<{ items: Resource[] }>(path); setItems(response.items); const latest = response.items.find(item => item.id === selected?.id); if (latest) edit(latest); else setEditing(false); } catch (err) { setError(describeError(err)); } }}>Reload latest saved version (discards edits)</button>}
    {items === null && !error ? <p className="muted">Loading saved resources…</p> : items?.length ? <div className="resource-list">{items.map(item => <div className="resource-row" key={item.id}><button className="link resource-title" onClick={() => edit(item)}>{item.title}</button><Badge tone={item.status === 'active' ? 'good' : 'neutral'}>{item.status}</Badge><small className="muted">v{item.version}</small><button className="button small" disabled={busy} onClick={() => edit(item)}>Edit</button><button className="button small" disabled={busy} onClick={() => activate(item)}>Check activation</button><button className="button small danger" disabled={busy} onClick={() => remove(item)}>Delete</button></div>)}</div> : !error && <Empty title="No saved resources yet">Create a configuration draft. Drafts are not live operations.</Empty>}
    {editing && <form onSubmit={save} className="resource-form"><div className="row between"><h3>{selected ? 'Edit saved draft' : 'Create draft'}</h3><button className="button small" type="button" onClick={() => setEditing(false)}>Close editor</button></div><Field label="Internal resource title"><input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></Field>{kind === 'checkout-design' ? <CheckoutBuilder design={config as unknown as Design} onChange={design => setConfig(designConfig(design))} premium={premium} /> : <ResourceFields kind={kind} config={config} onChange={setConfig} designs={designs} />}<div className="row wrap form-footer"><button className="button primary" disabled={busy || conflict}>{busy ? 'Saving…' : 'Save draft'}</button><small className="muted">{selected ? `Optimistic version ${selected.version}` : 'New resource'} · Server validates ownership and paid features.</small></div></form>}
  </section>;
}
