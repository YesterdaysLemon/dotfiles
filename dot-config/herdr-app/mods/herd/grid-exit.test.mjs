import test from 'node:test';
import assert from 'node:assert/strict';
import { exitGrids } from './grid-exit.mjs';

test('fallback waits for fresh layout, focuses before closing only supplied grids, and never uses a shell', () => {
  const calls = []; let polls = 0;
  const result = exitGrids({ panes: ['pg1', 'pg2', 'pg1'], focus: 'p2', zooms: [{ pane: 'pg1', target: 'pg1' }] }, (command, args) => {
    assert.equal(command, 'herdr-app');
    if (args[0] === 'status') return JSON.stringify({ layout: ++polls < 3 ? 'herd' : 'seats-main', focused_pane: 'pg1' });
    calls.push(args); return '{"ok":true}';
  }, () => {});
  assert.equal(result.closed, 2);
  assert.deepEqual(calls, [ ['do', 'pane.zoom', '--pane', 'pg1'], ['do', 'pane.focus', '--pane', 'p2'], ['do', 'pane.close', '--pane', 'pg1'], ['do', 'pane.close', '--pane', 'pg2'] ]);
});

test('reload/quit and a newer selected terminal do not restore old focus or close grids in another layout', () => {
  const calls = [];
  const skipped = exitGrids({ panes: ['pg'], focus: 'p2' }, (_command, args) => { assert.equal(args[0], 'status'); return '{"layout":"herd"}'; }, () => {});
  assert.equal(skipped.skipped, true);
  const result = exitGrids({ panes: ['pg'], focus: 'p2' }, (_command, args) => {
    if (args[0] === 'status') return '{"layout":"seats-main","focused_pane":"new-terminal"}';
    calls.push(args); return '{"ok":true}';
  }, () => {});
  assert.equal(result.closed, 1); assert.deepEqual(calls, [['do', 'pane.close', '--pane', 'pg']]);
  const failed = exitGrids({ panes: ['pg'] }, (_command, args) => args[0] === 'status' ? '{"layout":"seats-main"}' : '{"error":"missing"}', () => {});
  assert.equal(failed.closed, 0); assert.equal(failed.failures.length, 1);
  for (const request of [{ panes: [''] }, { panes: ['remote/pg'] }, { panes: ['pg'], focus: 'p2\n' }, { panes: Array(65).fill('pg') }, { panes: ['pg'], zooms: [{ pane: 'not-owned', target: 'p2' }] }]) {
    assert.throws(() => exitGrids(request, () => assert.fail('invalid requests cannot invoke commands')));
  }
});
