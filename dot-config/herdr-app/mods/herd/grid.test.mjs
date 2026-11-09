import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGrid, boundGrid, gridTarget, gridSeats, restoreGridPlan, gridApi } from './grid.mjs';

const panes = [{ pane: 'p1', terminal: 't1', tab: 'tab', zoomed: false }, { pane: 'p2', terminal: 't2', tab: 'tab', zoomed: false },
  { pane: 'pg', mod: 'herd', tab: 'tab', zoomed: true }];
const spaces = [{ id: 's1', tabs: [{ id: 'tab' }], machine: null }, { id: 'work', tabs: [{ id: 'work-tab' }], machine: null }];
const record = { institution: 'sample', space: 's1', tab: 'tab', pane: 'pg', focusPane: 'p2', zoomPane: null, token: 'fixture' };

test('grid scope binds the actual owned mod pane and tab, rejecting forged spaces and terminal IDs', () => {
  assert.deepEqual(validateGrid(record, 'pg', panes, spaces), record);
  const { pane: _pane, ...request } = record;
  assert.deepEqual(boundGrid(request, { tab: record }, panes, spaces), record, 'native mod props omit their pane ID');
  assert.equal(boundGrid({ ...request, token: 'different' }, { tab: record }, panes, spaces), null);
  assert.equal(boundGrid(request, {}, panes, spaces), null);
  for (const change of [{ space: 'work' }, { tab: 'work-tab' }, { focusPane: null }]) assert.equal(validateGrid({ ...record, ...change }, 'pg', panes, spaces), null);
  assert.equal(validateGrid(record, 'p1', panes, spaces), null);
  assert.equal(validateGrid(record, 'pg', panes, [{ ...spaces[0], machine: 'remote' }]), null);
  assert.equal(validateGrid({ ...record, space: 'work', tab: 'work-tab' }, 'pg', [{ pane: 'pg', mod: 'herd', tab: 'work-tab' }], spaces).space, 'work', 'local Work grids can render metadata only');
});

test('grid targets an existing institution terminal and orders tiles independently of urgency', () => {
  const seats = [{ address: 't2', pane: 'p2', space: 's1', role: 'maker', status: 'blocked' }, { address: 't1', pane: 'p1', space: 's1', role: 'guide', status: 'idle' }];
  const group = { key: 'sample', seats };
  const target = gridTarget(group, panes, spaces, { tab: 'tab', pane: 'p2' }, 'guide');
  assert.equal(target.anchor, 'p1'); assert.equal(target.focusPane, 'p2');
  assert.equal(gridTarget({ ...group, machine: 'remote' }, panes, spaces, {}), null);
  assert.equal(gridTarget(group, [], spaces, {}), null);
  assert.deepEqual(gridSeats(group, 's1').map(s => s.address), ['t1', 't2']);
  assert.deepEqual(gridSeats({ ...group, seats: seats.map(s => ({ ...s, status: s.status === 'blocked' ? 'idle' : 'blocked' })) }, 's1').map(s => s.address), ['t1', 't2']);
  assert.deepEqual(gridSeats(group, 'work'), []);
});

test('return restores original zoom and focus before closing only its own mod pane', () => {
  assert.deepEqual(restoreGridPlan(record, panes), [
    { command: 'pane.zoom', args: { pane: 'pg' } }, { command: 'pane.focus', args: { pane: 'p2' } }, { command: 'pane.close', args: { pane: 'pg' } },
  ]);
  assert.deepEqual(restoreGridPlan({ ...record, zoomPane: 'p1' }, panes), [
    { command: 'pane.zoom', args: { pane: 'p1' } }, { command: 'pane.focus', args: { pane: 'p2' } }, { command: 'pane.close', args: { pane: 'pg' } },
  ]);
  const sourceAlreadyZoomed = panes.map(p => ({ ...p, zoomed: p.pane === 'p1' }));
  assert.deepEqual(restoreGridPlan({ ...record, zoomPane: 'p1' }, sourceAlreadyZoomed).map(s => s.command), ['pane.focus', 'pane.close']);
  assert.equal(restoreGridPlan({ ...record, focusPane: 'gone' }, panes).find(s => s.command === 'pane.focus').args.pane, 'p1');
  assert.deepEqual(restoreGridPlan({ ...record, pane: 'p1' }, panes), [], 'a terminal can never be closed as a grid');
  assert.deepEqual(restoreGridPlan(record, panes.map(p => ({ ...p, mod: 'someone-else' }))), []);
});

test('native grid calls use argv and require command receipts, with no retry on failures', async () => {
  const calls = [];
  const execute = async (...args) => { calls.push(args); return { code: 0, stdout: '{"pane":"new-pane"}' }; };
  assert.equal((await gridApi(execute, 'pane.split', { pane: 'p1', mod: 'herd' })).pane, 'new-pane');
  assert.deepEqual(calls[0][1], ['do', 'pane.split', '{"pane":"p1","mod":"herd"}']);
  for (const result of [{ code: 1, stdout: '{"ok":true}' }, { code: 0, stdout: '{"error":"fixture failed"}' }, { code: 0, stdout: '{}' }, { code: 0, stdout: 'invalid' }]) {
    await assert.rejects(gridApi(async () => result, 'pane.zoom', { pane: 'pg' }));
  }
  await assert.rejects(gridApi(execute, 'terminal.kill', { terminal: 't1' }));
  assert.equal(calls.length, 1);
});
