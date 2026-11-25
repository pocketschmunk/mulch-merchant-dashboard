import type { Resource, ResourceKind } from '../types';
import { schemas } from '../lib/resourceSchemas';
import { Field, Notice } from './UI';
interface Zone { country: string; rateMinor: string; freeOverMinor: string }
export function ResourceFields({ kind, config, onChange, designs }: {
  kind: Exclude<ResourceKind, 'checkout-design'>;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  designs: Resource[];
}) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  return <div className="form-grid">
    {schemas[kind].fields.map(field => {
      if (field.type === 'boolean') {
        return <label key={field.key} className="check-field">
          <input type="checkbox" checked={config[field.key] === true} onChange={event => set(field.key, event.target.checked)} />
          <span>{field.label}</span>
        </label>;
      }
      if (field.type === 'select') {
        const designSelect = kind === 'experiment' && ['variantA', 'variantB'].includes(field.key);
        return <Field label={field.label} hint={field.hint} key={field.key}>
          <select value={String(config[field.key] ?? '')} onChange={event => set(field.key, event.target.value)}>
            {designSelect && <option value="">Select an owned design</option>}
            {designSelect
              ? designs.map(design => <option value={design.id} key={design.id}>{design.title} · {design.status}</option>)
              : field.options?.map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>;
      }
      if (field.type === 'textarea') {
        return <Field label={field.label} hint={field.hint} key={field.key}>
          <textarea rows={3} maxLength={field.maxLength ?? 4000} value={String(config[field.key] ?? '')} onChange={event => set(field.key, event.target.value)} />
        </Field>;
      }
      return <Field label={field.label} hint={field.hint} key={field.key}>
        <input type={field.type} min={field.min} max={field.max}
          step={field.type === 'number' ? field.integer ? 1 : '0.01' : undefined}
          maxLength={field.maxLength ?? 600} value={String(config[field.key] ?? '')}
          onChange={event => set(field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)} />
      </Field>;
    })}
    {kind === 'survey' && <div className="span-all array-editor">
      <h3>Answer choices</h3>
      {(config.answers as string[]).map((answer, index) => <div className="row" key={index}>
        <Field label={`Answer ${index + 1}`}>
          <input value={answer} maxLength={200} onChange={event => set('answers', (config.answers as string[]).map((value, at) => at === index ? event.target.value : value))} />
        </Field>
        <button type="button" className="button small danger" onClick={() => set('answers', (config.answers as string[]).filter((_, at) => at !== index))}>Remove</button>
      </div>)}
      <button type="button" className="button small" disabled={(config.answers as string[]).length >= 20} onClick={() => set('answers', [...config.answers as string[], ''])}>Add answer</button>
    </div>}
    {kind === 'shipping' && <div className="span-all array-editor">
      <h3>Country zones</h3>
      <p className="muted">Rate and free-over threshold are whole USD cents. Saving does not activate a shipping runtime.</p>
      {(config.zones as Zone[]).map((zone, index) => <div className="shipping-zone" key={index}>
        {(['country', 'rateMinor', 'freeOverMinor'] as const).map(key => <Field key={key} label={key === 'country' ? 'Country (ISO)' : key === 'rateMinor' ? 'Rate (cents)' : 'Free over (cents)'}>
          <input value={zone[key]} maxLength={key === 'country' ? 2 : 16} inputMode={key === 'country' ? 'text' : 'numeric'}
            onChange={event => set('zones', (config.zones as Zone[]).map((value, at) => at === index ? { ...value, [key]: key === 'country' ? event.target.value.toUpperCase() : event.target.value } : value))} />
        </Field>)}
        <button type="button" className="button small danger" onClick={() => set('zones', (config.zones as Zone[]).filter((_, at) => at !== index))}>Remove zone</button>
      </div>)}
      <button type="button" className="button small" disabled={(config.zones as Zone[]).length >= 100} onClick={() => set('zones', [...config.zones as Zone[], { country: '', rateMinor: '0', freeOverMinor: '0' }])}>Add country zone</button>
    </div>}
    {kind === 'recovery' && <div className="span-all array-editor">
      <h3>Retry schedule</h3>
      <p className="muted">At most 8 unique increasing days (1–60) after a failed renewal. These preferences do not run retries or send messages.</p>
      {(config.retryDays as number[]).map((day, index) => <div className="row" key={index}>
        <Field label={`Retry ${index + 1} (day)`}>
          <input type="number" min={1} max={60} step={1} value={day} onChange={event => set('retryDays', (config.retryDays as number[]).map((value, at) => at === index ? Number(event.target.value) : value))} />
        </Field>
        <button type="button" className="button small danger" onClick={() => set('retryDays', (config.retryDays as number[]).filter((_, at) => at !== index))}>Remove</button>
      </div>)}
      <button type="button" className="button small" disabled={(config.retryDays as number[]).length >= 8 || Number((config.retryDays as number[]).at(-1) ?? 0) >= 60}
        onClick={() => set('retryDays', [...config.retryDays as number[], Number((config.retryDays as number[]).at(-1) ?? 0) + 1])}>Add retry day</button>
    </div>}
    {kind === 'experiment' && <div className="span-all">
      <Notice>Only owned Mulch checkout-design IDs are supported. Saved tests remain drafts; no experiment runtime or traffic allocation is activated.</Notice>
    </div>}
  </div>;
}
