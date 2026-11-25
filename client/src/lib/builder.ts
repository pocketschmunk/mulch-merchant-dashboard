import type { Block, Design } from '../types';
export const fixedTypes = ['contact', 'delivery', 'shipping', 'payment'] as const;
export const addedTypes = ['express', 'testimonial', 'rating', 'trust', 'guarantee', 'text', 'image', 'timer', 'faq', 'value-props', 'payment-icons', 'announcement', 'custom-html', 'subscription-choice', 'order-bump'] as const;
export const isFixed = (block: Block) => (fixedTypes as readonly string[]).includes(block.type);
export const newId = () => crypto.randomUUID();
export function initialDesign(): Design {
  return { accent: '#2854ff', background: '#ffffff', logoUrl: '', heading: 'Complete your order', language: 'en', blocks: fixedTypes.map(type => ({ id: newId(), type, title: type[0].toUpperCase() + type.slice(1), body: '', visible: true })) };
}
export function addBlock(blocks: Block[], type: string, premium: boolean): Block[] {
  if (!(addedTypes as readonly string[]).includes(type) || (type === 'subscription-choice' && !premium) || blocks.length >= 40) return blocks;
  return [...blocks, { id: newId(), type, title: type.replaceAll('-', ' '), body: '', visible: true }];
}
export function moveBlock(blocks: Block[], id: string, direction: number): Block[] {
  const index = blocks.findIndex(block => block.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= blocks.length || isFixed(blocks[index]) || isFixed(blocks[destination])) return blocks;
  const next = [...blocks];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
export function removeBlock(blocks: Block[], id: string): Block[] { return blocks.filter(block => block.id !== id || isFixed(block)); }
export function duplicateBlock(blocks: Block[], id: string): Block[] {
  const index = blocks.findIndex(block => block.id === id);
  if (index < 0 || isFixed(blocks[index]) || blocks.length >= 40) return blocks;
  const next = [...blocks]; next.splice(index + 1, 0, { ...blocks[index], id: newId() }); return next;
}
export function updateBlock(blocks: Block[], id: string, patch: Partial<Pick<Block, 'title' | 'body' | 'visible'>>): Block[] {
  return blocks.map(block => block.id !== id ? block : { ...block, ...patch, visible: isFixed(block) ? true : (patch.visible ?? block.visible) });
}
const formattingTags = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h2', 'h3', 'div', 'blockquote', 'span']);
export function formattingHtmlError(value: string): string | null {
  if (value.length > 8000) return 'Custom HTML must be at most 8000 characters.';
  const stack: string[] = []; let offset = 0;
  for (const match of value.matchAll(/<[^>]*>/g)) {
    if (value.slice(offset, match.index).includes('<')) return 'Custom HTML contains malformed tags.';
    const tag = /^<(\/?)([a-z0-9]+)\s*(\/?)>$/i.exec(match[0]);
    if (!tag || !formattingTags.has(tag[2].toLowerCase())) return 'Custom HTML supports formatting only: no scripts, events, attributes or embedded content.';
    const name = tag[2].toLowerCase();
    if (name === 'br') { if (tag[1]) return 'Do not close br tags.'; }
    else if (tag[1]) { if (stack.pop() !== name || tag[3]) return 'Formatting tags must be balanced.'; }
    else { if (tag[3]) return 'Only br may be self-closing.'; stack.push(name); }
    offset = match.index! + match[0].length;
  }
  return value.slice(offset).includes('<') || stack.length ? 'Formatting tags must be complete and balanced.' : null;
}
export function validateDesign(design: Design, premium: boolean): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(design.accent) || !/^#[0-9a-f]{6}$/i.test(design.background)) return 'Choose valid six-digit colors.';
  if (!design.heading.trim() || design.heading.length > 160) return 'A checkout heading of at most 160 characters is required.';
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(design.language)) return 'Choose a valid language code.';
  if (design.blocks.length > 40) return 'Use no more than 40 blocks.';
  for (const type of fixedTypes) if (design.blocks.filter(block => block.type === type).length !== 1 || !design.blocks.find(block => block.type === type)?.visible) return `Exactly one visible ${type} block is required.`;
  if (new Set(design.blocks.map(block => block.id)).size !== design.blocks.length) return 'Block identifiers must be unique.';
  if (!premium && design.blocks.some(block => block.type === 'subscription-choice')) return 'Subscription choices require Premium.';
  if (design.logoUrl && !safeImageUrl(design.logoUrl)) return 'Logo URL must name a public HTTPS raster image without credentials or checkout paths.';
  for (const block of design.blocks) {
    if (![...fixedTypes, ...addedTypes].includes(block.type as typeof addedTypes[number])) return 'Choose a supported checkout block type.';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(block.id)) return 'Block IDs must contain only letters, numbers, underscores or hyphens.';
    if (block.title.length > 120) return 'Block titles must be at most 120 characters.';
    if (block.type === 'custom-html') { const problem = formattingHtmlError(block.body); if (problem) return problem; }
    else if (block.type === 'image') { if (!safeImageUrl(block.body)) return 'Image blocks require a public HTTPS raster image URL.'; }
    else if (block.body.length > 4000 || /[<>]/.test(block.body)) return 'Block content must be plain text, at most 4000 characters.';
  }
  return null;
}
export function safeImageUrl(value: string): string | null {
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || /^(localhost|127\.|0\.|\[|169\.254\.|10\.|192\.168\.)/i.test(url.hostname)) return null;
    const decoded = decodeURIComponent(url.pathname + url.search + url.hash);
    if (/shop.?pay|javascript:|data:|\/checkout(?:\/|\?|$)|\/payments?(?:\/|\?|$)/i.test(decoded)) return null;
    if (!/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(url.pathname + url.search)) return null;
    return url.href;
  } catch { return null; }
}
// Attribute-free formatting only. Unknown tags and attributes are escaped, never executed.
// Tokenization leaves already-escaped text as text rather than converting entities into tags.
export function sanitizeFormattingHtml(value: string): string {
  const escape = (text: string) => text.replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  let output = '', offset = 0;
  for (const match of value.matchAll(/<[^>]*>/g)) {
    output += escape(value.slice(offset, match.index));
    const tag = /^<(\/?)([a-z0-9]+)\s*(\/?)>$/i.exec(match[0]);
    output += tag && formattingTags.has(tag[2].toLowerCase()) ? `<${tag[1]}${tag[2].toLowerCase()}${tag[3]}>` : escape(match[0]);
    offset = match.index! + match[0].length;
  }
  return output + escape(value.slice(offset));
}
export function designConfig(design: Design): Record<string, unknown> {
  return { accent: design.accent, background: design.background, logoUrl: design.logoUrl, heading: design.heading, language: design.language, blocks: design.blocks.map(({ id, type, title, body, visible }) => ({ id, type, title, body, visible })) };
}
