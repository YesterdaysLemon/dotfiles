import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_MS, pathKey } from './model.mjs';
import { canReadCodexQuote, detectCodexQuote, screenCandidates, screenIdentity, quoteState, recentReadTimes, SCREEN_READ_WINDOW } from './sentences.mjs';

const home = 'C:/Users/example';
const now = 1_000_000;
const codex = { address: 't1', pane: 'p1', space: 's1', role: 'maker', app: 'codex', status: 'working', cwd: home + '/Project/sample' };
const entry = (seat, checked = now) => ({ checked, cwd: pathKey(seat.cwd), app: screenIdentity(seat), pane: seat.pane, space: seat.space,
  quote: { text: 'I am checking the preview.', rule: 'codex-commentary' }, prompt: null, error: false });

test('only local Project Codex panes in this space qualify, including working panes', () => {
  assert.equal(canReadCodexQuote(codex, home, 's1'), true);
  assert.equal(canReadCodexQuote({ ...codex, status: 'idle' }, home, 's1'), true);
  assert.equal(canReadCodexQuote({ ...codex, space: undefined }, home, undefined), false);
  for (const changed of [{ cwd: home + '/Work/sample' }, { cwd: home + '/Other/sample' }, { machine: 'remote' }, { address: 'remote/t1' },
    { pane: null }, { role: '' }, { app: 'claude' }, { space: 'another', pinned: true }]) {
    assert.equal(canReadCodexQuote({ ...codex, ...changed }, home, 's1'), false);
  }
  assert.equal(canReadCodexQuote({ ...codex, cwd: '/mnt/c/Users/example/Work/sample' }, home, 's1'), false);
});

test('literal assistant prose yields one bounded sentence, including wrapped and ANSI frames', () => {
  assert.deepEqual(detectCodexQuote('• I’m checking the preview. The next step is its tests.'), { text: 'I’m checking the preview.', rule: 'codex-commentary' });
  assert.equal(detectCodexQuote('\x1b[32m• I am checking the preview\x1b[0m\n  against its committed source.\n\n• Ran a command\n  └ unrelated output')?.text,
    'I am checking the preview against its committed source.');
  assert.equal(detectCodexQuote('• I checked the source.\n\n• The preview now passes its checks.')?.text, 'The preview now passes its checks.');
});

test('working timers, queued/user/tool text, ambiguous prose and menus stay unquoted', () => {
  for (const text of ['• Working (2h · esc to interrupt)', '• Ran a command\n  • I am checking a tool result.',
    '› I am checking user input.', '• I need to inspect this.', '• Checking a file', '• I am ' + 'x'.repeat(200) + '.',
    '• I checked the preview.\n\n• Queued follow-up\n  I am changing the request.',
    '• I checked the preview.\nWould you like to run the following command?\n1. Yes, proceed']) assert.equal(detectCodexQuote(text), null);
  assert.equal(detectCodexQuote('• I checked an old frame.\n' + 'tool output\n'.repeat(25)), null, 'only the bounded current screen tail is eligible');
});

test('credential-like assignments in a candidate paragraph suppress the quote', () => {
  assert.equal(detectCodexQuote('• I am checking token=fixture-value.'), null);
  assert.equal(detectCodexQuote('• I am checking the preview.\n  password: fixture-value'), null);
});

test('one shared candidate queue deduplicates routes and rotates older checks before newer ones', () => {
  const quiet = { ...codex, status: 'idle' };
  const second = { ...codex, address: 't2', pane: 'p2' };
  const third = { ...codex, address: 't3', pane: 'p3' };
  assert.deepEqual(screenCandidates([quiet, second], {}, now, home, [], 's1').map(s => s.address), ['t1', 't2']);
  const cache = { t1: entry(quiet), t2: entry(second, now - CACHE_MS - 100), t3: entry(third, now - CACHE_MS - 200) };
  assert.deepEqual(screenCandidates([quiet, second, third], cache, now, home, [], 's1').map(s => s.address), ['t3', 't2']);
  assert.equal(screenCandidates([quiet], { t1: entry(quiet, now + 1) }, now, home, [], 's1').length, 1, 'a future check is invalid, not fresh');
});

test('quote provenance expires and invalidates on program, cwd, pane or space changes', () => {
  const cache = { t1: entry(codex) };
  assert.deepEqual(quoteState(codex, cache, now, home, 's1'), { kind: 'quote', text: cache.t1.quote.text, checked: now });
  for (const changed of [{ cwd: home + '/Project/other' }, { pane: 'p2' }, { program: { key: 'another' } }]) {
    assert.equal(quoteState({ ...codex, ...changed }, cache, now, home, 's1').kind, 'pending');
  }
  assert.equal(quoteState({ ...codex, app: 'claude' }, cache, now, home, 's1'), null);
  assert.equal(quoteState({ ...codex, space: 's2' }, cache, now, home, 's1'), null);
  assert.equal(quoteState(codex, cache, now + CACHE_MS, home, 's1').kind, 'expired');
  cache.t1.error = true; assert.equal(quoteState(codex, cache, now, home, 's1').kind, 'unavailable');
  cache.t1.error = false; cache.t1.quote = null; assert.equal(quoteState(codex, cache, now, home, 's1').kind, 'unrecognized');
});

test('the read window counts every attempt and releases budget only when it ages out', () => {
  assert.equal(recentReadTimes([now, now - 1, now - 2, now - 3], now).length, 4);
  assert.equal(recentReadTimes([now - SCREEN_READ_WINDOW, now - SCREEN_READ_WINDOW + 1], now).length, 1);
  assert.deepEqual(recentReadTimes([NaN, now + 1, -Infinity], now), []);
});
