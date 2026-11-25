import test from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, designConfig, duplicateBlock, fixedTypes, initialDesign, moveBlock, removeBlock, sanitizeFormattingHtml, updateBlock, validateDesign } from '../src/lib/builder';
import { freshConfig, schemas, validateConfig } from '../src/lib/resourceSchemas';
import { money } from '../src/components/UI';
test('builder starts with one visible fixed contact/delivery/shipping/payment block', () => {
  const design = initialDesign(); assert.deepEqual(design.blocks.map(block => block.type), [...fixedTypes]); assert.equal(validateDesign(design, false), null);
});
test('core blocks cannot be hidden, deleted, duplicated or repositioned', () => {
  const { blocks } = initialDesign();
  for (const block of blocks) { assert.equal(removeBlock(blocks, block.id).length, 4); assert.equal(duplicateBlock(blocks, block.id).length, 4); assert.equal(updateBlock(blocks, block.id, { visible: false }).find(value => value.id === block.id)?.visible, true); assert.deepEqual(moveBlock(blocks, block.id, 1), blocks); }
});
test('add, reorder, visibility, duplicate and delete work on added blocks', () => {
  const initial = initialDesign().blocks; let blocks = addBlock(initial, 'text', false); blocks = addBlock(blocks, 'faq', false);
  const first = blocks[4], second = blocks[5]; blocks = moveBlock(blocks, second.id, -1); assert.equal(blocks[4].id, second.id);
  blocks = updateBlock(blocks, first.id, { visible: false, body: 'Useful content' }); assert.equal(blocks.find(value => value.id === first.id)?.visible, false);
  blocks = duplicateBlock(blocks, first.id); assert.equal(blocks.length, 7); assert.equal(new Set(blocks.map(value => value.id)).size, 7);
  assert.equal(removeBlock(blocks, first.id).length, 6);
});
test('subscription blocks are Premium-only and unsupported block types cannot be added', () => {
  const blocks = initialDesign().blocks; assert.equal(addBlock(blocks, 'subscription-choice', false), blocks);
  assert.equal(addBlock(blocks, 'script', true), blocks); assert.equal(addBlock(blocks, 'subscription-choice', true).length, 5);
  assert.match(validateDesign({ ...initialDesign(), blocks: addBlock(blocks, 'subscription-choice', true) }, false) ?? '', /Premium/);
});
test('design validates required blocks, unique ids, safe image URLs and script rejection', () => {
  const design = initialDesign(); assert.match(validateDesign({ ...design, blocks: design.blocks.slice(1) }, true) ?? '', /contact/);
  assert.match(validateDesign({ ...design, blocks: [...design.blocks, { ...design.blocks[0], type: 'text' }] }, true) ?? '', /unique/);
  assert.match(validateDesign({ ...design, logoUrl: 'javascript:alert(1)' }, true) ?? '', /HTTPS/);
  const blocks = addBlock(design.blocks, 'custom-html', false); blocks[4].body = '<script>alert(1)</script>'; assert.match(validateDesign({ ...design, blocks }, false) ?? '', /no scripts/);
  blocks[4].body = '<p><strong>Formatting only</strong></p>'; assert.equal(validateDesign({ ...design, blocks }, false), null);
});
test('HTML preview preserves only attribute-free formatting and escapes every execution surface', () => {
  assert.equal(sanitizeFormattingHtml('<p><strong>Safe</strong><br></p>'), '<p><strong>Safe</strong><br></p>');
  for (const html of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<iframe src="https://evil.test"></iframe>', '<svg onload=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<p onclick="alert(1)">x</p>', '<style>body{display:none}</style>']) {
    const safe = sanitizeFormattingHtml(html); assert.doesNotMatch(safe, /<(script|img|iframe|svg|a|style)\b/i); assert.doesNotMatch(safe, /<p\s+onclick/i);
  }
});
test('serialization uses only the exact checkout design contract fields', () => {
  const config = designConfig(initialDesign()); assert.deepEqual(Object.keys(config).sort(), ['accent', 'background', 'blocks', 'heading', 'language', 'logoUrl'].sort());
  assert.deepEqual(Object.keys((config.blocks as object[])[0]).sort(), ['id', 'type', 'title', 'body', 'visible'].sort());
});
test('configuration factories are independent and unknown fields are rejected', () => {
  const first = freshConfig('shipping'); (first.zones as object[]).push({ country: 'US', rateMinor: '500', freeOverMinor: '10000' }); assert.deepEqual(freshConfig('shipping').zones, []);
  for (const kind of Object.keys(schemas) as (keyof typeof schemas)[]) assert.match(validateConfig(kind, { ...freshConfig(kind), fakeConnected: true }) ?? '', /Unsupported field/);
});
test('resource form validators reject unsafe products, invalid discounts, test variants and zone amounts', () => {
  assert.match(validateConfig('offer', { ...freshConfig('offer'), productId: 'https://evil.test' }) ?? '', /Shopify Product GID/);
  assert.equal(validateConfig('offer', { ...freshConfig('offer'), productId: 'gid://shopify/Product/123' }), null);
  assert.match(validateConfig('discount', { ...freshConfig('discount'), code: 'TEST', value: 101 }) ?? '', /cannot exceed/);
  assert.match(validateConfig('experiment', { ...freshConfig('experiment'), variantA: 'same', variantB: 'same' }) ?? '', /different/);
  assert.match(validateConfig('shipping', { currency: 'usd', zones: [{ country: 'US', rateMinor: '-1', freeOverMinor: '0' }] }) ?? '', /non-negative/);
  assert.match(validateConfig('survey', { question: 'Why?', answers: [], required: false }) ?? '', /non-empty survey/);
});
test('money uses exact integer minor units without unsafe floating-point rounding', () => {
  assert.equal(money('0'), '$0.00'); assert.equal(money('500001'), '$5,000.01'); assert.equal(money('900719925474099312345'), '$9,007,199,254,740,993,123.45'); assert.equal(money(undefined), 'Unavailable');
});
