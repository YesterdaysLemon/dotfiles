import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAsks, questionExcerpt } from './asks.mjs';

const ask = { id: 'sample:20261108T120000Z-123abc', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose the next build?', opened_at: '2026-11-08T12:00:00Z', options: ['one', 'two'], recommendation: 'one', blocks: 'the next build' };
test('the asks lane retains only open asks to Al and preserves the brief fields', () => {
  const items = parseAsks(JSON.stringify([ask, { ...ask, id: 'other:closed', state: 'answered' }, { ...ask, id: 'other:peer', to: 'sample/maker' }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].id, ask.id);
  assert.deepEqual(items[0].options, ['one', 'two']);
  assert.equal(items[0].recommendation, 'one');
  assert.equal(items[0].blocks, 'the next build');
});
test('malformed, duplicate, oversized or unknown-state responses never become an all-clear', () => {
  for (const value of ['not json', '{}', JSON.stringify([ask, ask]), JSON.stringify([{ ...ask, state: 'mystery' }]), JSON.stringify(Array(501).fill(ask))]) assert.throws(() => parseAsks(value));
  assert.equal(questionExcerpt({ question: ' a   longer\nquestion for the next build ' }, 16), 'a longer questi…');
});
