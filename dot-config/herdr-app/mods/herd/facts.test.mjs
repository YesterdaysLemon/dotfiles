import test from 'node:test';
import assert from 'node:assert/strict';
import { publishFacts, consumeFacts, forgetFacts } from './facts.mjs';
import { CACHE_MS, pathKey, screenIdentity } from './model.mjs';

test('ephemeral grid facts copy recognized fields, bind live screen identity, expire and are forgotten', () => {
  const token = {}, now = Date.now(), seat = { address: 't1', pane: 'p1', space: 's1', cwd: 'C:/Users/example/Project/sample', app: 'codex' };
  const entry = { checked: now - 100, cwd: pathKey(seat.cwd), app: screenIdentity(seat), pane: 'p1', space: 's1', quote: { text: 'I am checking the preview.', raw: 'not recognized' }, raw: 'raw screen' };
  publishFacts(token, { t1: entry }, { t1: { status: 'working', at: now - 5000, answer: 'never copy' } }, now);
  entry.quote.text = 'mutated caller';
  const facts = consumeFacts([{ ...seat, status: 'working' }], now);
  assert.equal(facts.cache.t1.quote.text, 'I am checking the preview.');
  assert.ok(!JSON.stringify(facts).includes('raw'));
  assert.ok(!JSON.stringify(facts).includes('never copy'));
  for (const change of [{ cwd: 'C:/Users/example/Work/sample' }, { app: 'claude' }, { pane: 'p2' }, { space: 's2' }]) assert.deepEqual(consumeFacts([{ ...seat, ...change }], now).cache, {});
  assert.deepEqual(consumeFacts([seat], now + CACHE_MS).cache, {});
  forgetFacts(token); assert.deepEqual(consumeFacts([seat], now), { cache: {}, history: {} });
});
