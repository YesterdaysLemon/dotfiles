import test from 'node:test';
import assert from 'node:assert/strict';
import { askTalkTarget } from './asks.mjs';

const home = 'C:/Users/example', project = home + '/Project/sample';
function fixture() {
  const ask = { id: 'sample:fixture', from: 'sample/guide', to: 'al', state: 'open', opened_at: '2026-11-10T12:00:00Z', owner_project: project };
  const seat = { address: 't1', pane: 'p1', space: 's1', cwd: project, name: 'Current', role: 'guide', avatar: 'avatars/sample/current.png' };
  const group = { key: 'sample', workspace: 'sample', seats: [seat] };
  const panes = [{ pane: 'p1', terminal: 't1', tab: 'tab' }];
  const spaces = [{ id: 's1', folder: project, tabs: [{ id: 'tab' }] }];
  const info = { schema_version: 1, workspace: 'sample', project, config_dir: project + '/.claude/seats', conductor: 'guide', renames: [] };
  const infos = { sample: { cwd: project, info } };
  return { ask, seat, group, panes, spaces, info, infos, target(personal = true) { return askTalkTarget(ask, [group], panes, spaces, home, personal, infos); } };
}

test('talk binds the ask party and personal owner to exactly one real pane', () => {
  const f = fixture();
  assert.equal(f.target().state, 'ready');
  assert.equal(f.target().pane.pane, 'p1');
  f.seat.name = 'Replacement'; f.seat.address = 't2'; f.seat.pane = 'p2';
  f.panes[0] = { pane: 'p2', terminal: 't2', tab: 'tab' };
  assert.equal(f.target().seat.name, 'Replacement');
  assert.equal(f.target().pane.pane, 'p2');
});

test('talk follows ordered role renames after opening and ignores older reuse history', () => {
  const f = fixture();
  f.info.renames = [{ from: 'guide', to: 'captain', at: '2026-11-10T12:10:00Z' }, { from: 'captain', to: 'director', at: '2026-11-10T12:20:00Z' }];
  f.seat.role = 'director';
  assert.equal(f.target().state, 'ready');
  f.info.renames = [{ from: 'guide', to: 'older-seat', at: '2026-11-10T11:00:00Z' }]; f.seat.role = 'guide';
  assert.equal(f.target().state, 'ready');
  f.info.renames = [{ from: 'guide', to: 'invalid', at: 'bad timestamp' }];
  assert.equal(f.target().state, 'unavailable');
});

test('an institution asker uses its configured conductor and worktrees require canonical metadata', () => {
  const f = fixture(); f.ask.from = 'sample';
  assert.equal(f.target().seat.role, 'guide');
  f.seat.cwd = home + '/Project/sample-feature';
  f.infos.sample.cwd = f.seat.cwd;
  assert.equal(f.target().state, 'ready');
  f.infos.sample = null;
  assert.equal(f.target().state, 'unavailable');
});

test('unavailable, ambiguous or mismatched panes never fall back to a name or address', () => {
  const f = fixture();
  f.group.seats.push({ ...f.seat, address: 't3' });
  assert.match(f.target().reason, /More than one/);
  f.group.seats.pop(); f.panes[0].terminal = 't-new';
  assert.match(f.target().reason, /no live pane/);
  f.panes[0].terminal = 't1'; f.seat.cwd = home + '/Project/different'; f.infos.sample = null;
  assert.equal(f.target().state, 'unavailable', 'the same workspace label is insufficient to bind another owner');
});

test('Work, remote and mixed destination spaces are rejected without readers', () => {
  for (const change of [f => { f.seat.cwd = home + '/Work/sample'; }, f => { f.seat.machine = 'remote'; },
    f => { f.seat.address = 'remote/t1'; }, f => { f.group.machine = 'remote'; }, f => { f.spaces[0].machine = 'remote'; },
    f => { f.group.seats.push({ ...f.seat, address: 'work', role: 'other', cwd: home + '/Work/other' }); }]) {
    const f = fixture(); change(f); assert.equal(f.target().state, 'unavailable');
  }
  assert.equal(fixture().target(false).state, 'unavailable');
});
