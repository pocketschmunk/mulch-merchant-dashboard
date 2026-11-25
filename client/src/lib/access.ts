import type { Access, Session, Store } from '../types';
import type { Requester } from './api';
import { paidGate } from './routes';
export async function loadAccess(api: Requester, session: Session, refresh = false): Promise<{ access: Access | null; stores: Store[] }> {
  if (paidGate(session, null) === 'login') return { access: null, stores: [] };
  const access = await api<Access>(refresh ? '/api/access/refresh' : '/api/access', refresh ? { method: 'POST', csrf: session.csrfToken, body: {} } : undefined);
  if (paidGate(session, access) !== 'dashboard') return { access, stores: [] };
  const response = await api<{ stores: Store[] }>('/api/stores');
  return { access, stores: response.stores.filter(store => validStoreAccess(store, access)) };
}
export function validStoreAccess(store: Store, access: Access | null): boolean {
  return access?.hasAccess === true && access.verification?.configured === true && store.planStatus === 'active' &&
    access.entitlements.some(item => item.status === 'active' && item.storeId === store.id && item.plan === store.plan);
}
export function paidBindingKey(access: Access | null): string {
  return JSON.stringify((access?.entitlements ?? []).map(item => [item.id, item.storeId, item.plan, item.status]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export async function reconcilePaidStores(api: Requester, access: Access, preferredId: string): Promise<{ stores: Store[]; storeId: string }> {
  if (!access.hasAccess || !access.verification.configured) return { stores: [], storeId: '' };
  const response = await api<{ stores: Store[] }>('/api/stores');
  const stores = response.stores.filter(store => validStoreAccess(store, access));
  return { stores, storeId: stores.some(store => store.id === preferredId) ? preferredId : stores[0]?.id ?? '' };
}
