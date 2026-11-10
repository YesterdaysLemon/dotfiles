import test from 'node:test';
import assert from 'node:assert/strict';
import { PIN_STORE, readPins, makePin, resolvePin, matchingPin, togglePin } from './pins.mjs';

const home = 'C:/Users/example', project = home + '/Project/sample';
const make = () => {
  const group = { key: 'sample', workspace: 'sample', name: 'Sample', seats: [
    { address: 't1', pane: 'p1', role: 'liaison', name: 'First', cwd: project, status: 'working' },
    { address: 't2', pane: 'p2', role: 'maker', name: 'Second', cwd: project, status: 'idle' },
  ] };
  const info = { schema_version: 1, workspace: 'sample', project, config_dir: project + '/.claude/seats', conductor: 'liaison',
    roles: [{ role: 'liaison' }, { role: 'maker' }] };
  return { group, info, groups: [group], infos: { sample: { cwd: project, info } } };
};

test('pins serialize only durable preferences and survive JSON/application reload', () => {
  const { group, infos } = make();
  const pin = makePin(group, group.seats[0], infos, home);
  assert.equal(PIN_STORE, 'herd.pins.v1');
  const loaded = readPins(JSON.parse(JSON.stringify({ version: 1, items: [pin, pin] })), home);
  assert.deepEqual(loaded, [{ workspace: 'sample', project: project.toLowerCase(), kind: 'conductor' }]);
  assert.ok(!/t1|First|working|avatar/.test(JSON.stringify(loaded)));
  assert.deepEqual(readPins({ version: 2, items: [pin] }, home), []);
});

test('conductor pin follows both rotation and a role rename without repinning', () => {
  const { group, info, groups, infos } = make();
  const pin = makePin(group, group.seats[0], infos, home);
  group.seats[0] = { ...group.seats[0], address: 't99', pane: 'p99', role: 'vizier', name: 'Successor' };
  info.conductor = 'vizier'; info.roles[0].role = 'vizier';
  assert.equal(resolvePin(pin, groups, infos, home).seat.address, 't99');
  assert.deepEqual(togglePin([pin], makePin(group, group.seats[0], infos, home), groups, infos, home), []);
});

test('an ordinary seat follows the kit alias chain, and Unpin removes the original preference', () => {
  const { group, info, groups, infos } = make();
  const pin = makePin(group, group.seats[1], infos, home);
  group.seats[1] = { ...group.seats[1], address: 't8', role: 'craftsperson' };
  info.roles[1].role = 'craftsperson'; info.renames = [
    { from: 'maker', to: 'builder', at: '2026-11-10T01:00:00Z' },
    { from: 'builder', to: 'craftsperson', at: '2026-11-10T02:00:00Z' },
  ];
  assert.equal(resolvePin(pin, groups, infos, home).seat.address, 't8');
  const current = makePin(group, group.seats[1], infos, home);
  assert.equal(matchingPin([pin], current, groups, infos, home), pin);
  assert.deepEqual(togglePin([pin], current, groups, infos, home), []);
  info.renames.push({ from: 'craftsperson', to: 'maker', at: 'corrupt' });
  assert.equal(resolvePin(pin, groups, infos, home).state, 'unavailable');
});

test('ordered rename cursors distinguish a reused role name and a legitimate rename back', () => {
  const { group, info, groups, infos } = make();
  const old = makePin(group, group.seats[1], infos, home);
  info.renames = [{ from: 'maker', to: 'builder', at: '2026-11-10T01:00:00Z' }];
  group.seats[1].role = 'builder'; info.roles[1].role = 'builder';
  const reused = { ...group.seats[1], address: 't3', role: 'maker' };
  group.seats.push(reused); info.roles.push({ role: 'maker' });
  const newer = makePin(group, reused, infos, home);
  assert.equal(resolvePin(old, groups, infos, home).seat.address, 't2');
  assert.equal(resolvePin(newer, groups, infos, home).seat.address, 't3');
  assert.notEqual(newer.after, old.after);
  group.seats.pop(); info.roles.pop();
  info.renames.push({ from: 'builder', to: 'maker', at: '2026-11-10T02:00:00Z' });
  group.seats[1].role = 'maker'; info.roles[1].role = 'maker';
  assert.equal(resolvePin(old, groups, infos, home).seat.address, 't2');
  info.renames = [];
  assert.equal(resolvePin(newer, groups, infos, home).state, 'unavailable', 'missing recorded history cannot reinterpret a pin');
});

test('missing, ambiguous, Work and remote targets never resolve to a stale terminal', () => {
  const { group, groups, infos } = make();
  const pin = makePin(group, group.seats[1], infos, home);
  assert.equal(resolvePin(pin, [], infos, home).state, 'unavailable');
  group.seats.push({ ...group.seats[1], address: 't3' });
  assert.equal(resolvePin(pin, groups, infos, home).state, 'ambiguous');
  group.seats.pop();
  group.seats[1].cwd = home + '/Work/sample';
  assert.equal(makePin(group, group.seats[1], infos, home), null);
  assert.equal(resolvePin(pin, groups, infos, home).state, 'unavailable');
  assert.deepEqual(readPins({ version: 1, items: [{ ...pin, project: home + '/Work/sample' }] }, home), []);
  group.seats[1].cwd = project; group.machine = 'remote';
  assert.equal(resolvePin(pin, groups, infos, home).state, 'unavailable');
});

test('institution pins keep their insertion order through state changes; seat and institution are distinct', () => {
  const { group, groups, infos } = make();
  const institution = makePin(group, null, infos, home), seat = makePin(group, group.seats[1], infos, home);
  let pins = togglePin([], seat, groups, infos, home);
  pins = togglePin(pins, institution, groups, infos, home);
  group.seats.reverse(); group.seats[0].status = 'blocked';
  assert.deepEqual(pins, [seat, institution]);
  assert.equal(resolvePin(institution, groups, infos, home).seat.role, 'liaison');
  assert.deepEqual(togglePin(pins, seat, groups, infos, home), [institution]);
});

test('malformed metadata cannot break rendering or resolve a pin through a changed source', () => {
  const { group, groups, infos, info } = make();
  const pin = makePin(group, group.seats[1], infos, home);
  info.roles = 'invalid';
  assert.equal(makePin(group, group.seats[1], infos, home), null);
  assert.equal(resolvePin(pin, groups, infos, home).state, 'unavailable');
  info.roles = [{ role: 'liaison' }, { role: 'maker' }];
  infos.sample.cwd = project + '-different';
  assert.equal(resolvePin(pin, groups, infos, home).state, 'unavailable');
});
