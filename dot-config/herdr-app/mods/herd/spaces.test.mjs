import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceHerd, orderSpaceGroups } from './spaces.mjs';

const home = 'C:/Users/example';
const spaces = [{ id: 's1', name: 'First', folder: home + '/Work', machine: null }, { id: 's2', name: 'Second', folder: home, machine: null }];
const seat = (address, space, role, root, pinned = false) => ({ address, space, role, cwd: home + '/' + root + '/sample', pinned, status: 'idle', avatar: 'avatars/sample/face.png' });
const group = (key, seats, status = 'idle') => ({ key, name: key, seats: seats.map(s => ({ ...s, status })) });
const groups = [
  group('a-team', [seat('t1', 's1', 'maker', 'Project')], 'blocked'),
  group('z-principal', [seat('t2', 's1', 'liaison', 'Project', true)]),
  group('b-team', [seat('t3', 's2', 'maker', 'Work')], 'working'),
  group('y-principal', [seat('t4', 's2', 'liaison', 'Work', true)]),
];
test('the selected space owns the herd and its local liaison sorts first, independent of names and folder hints', () => {
  const view = spaceHerd(groups, spaces, 's1', home);
  assert.equal(view.personal, true);
  assert.equal(view.groups[0].key, 'z-principal');
  assert.deepEqual(view.groups.filter(g => !g.outsidePin).map(g => g.key), ['z-principal', 'a-team']);
  assert.equal(view.groups.at(-1).key, 'y-principal');
  assert.equal(view.groups.at(-1).outsidePin, true);
  assert.equal(view.groups.at(-1).seats[0].avatar, null);
});
test('a non-personal space keeps its own institutions and pinned access, without any familiar faces', () => {
  const view = spaceHerd(groups, spaces, 's2', home);
  assert.equal(view.personal, false);
  assert.deepEqual(view.groups.filter(g => !g.outsidePin).map(g => g.key), ['y-principal', 'b-team']);
  assert.equal(view.groups.at(-1).key, 'z-principal');
  assert.ok(view.groups.every(g => g.seats.every(s => s.avatar === null)));
});
test('prompt triage cannot reorder an institution ahead of its liaison', () => {
  const view = spaceHerd(groups, spaces, 's1', home);
  const waiting = view.groups.map(g => g.key === 'a-team' ? { ...g, status: 'blocked' } : g);
  assert.equal(orderSpaceGroups(waiting)[0].key, 'z-principal');
});
