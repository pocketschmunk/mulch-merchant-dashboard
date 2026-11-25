import type { ReactNode } from 'react';
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'blue' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><span className="empty-mark" aria-hidden="true">—</span><h3>{title}</h3><p>{children}</p></div>; }
export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <section className="panel"><div className="panel-head"><h2>{title}</h2>{action}</div>{children}</section>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Loading({ text = 'Checking server evidence…' }: { text?: string }) { return <div className="loading" role="status"><span className="spinner" />{text}</div>; }
export function money(value: string | number | undefined): string {
  if (value === undefined || !/^-?\d+$/.test(String(value))) return 'Unavailable';
  const minor = BigInt(value), negative = minor < 0n, absolute = negative ? -minor : minor;
  return `${negative ? '-' : ''}$${(absolute / 100n).toLocaleString('en-US')}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function percent(value: number | null | undefined): string { return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`; }
export function feeRate(basisPoints: number) { return `${(basisPoints / 100).toFixed(1)}%`; }
export function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
export function Brand() { return <span className="brand"><img src="/brand-mark.svg" width="30" height="30" alt="" /><span>mulch<span className="brand-dot">.</span></span></span>; }
