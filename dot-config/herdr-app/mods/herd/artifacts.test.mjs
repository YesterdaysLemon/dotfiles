import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactSource, acceptInfo, acceptArtifact, fitArtifact, configChanges, seatsExecutable } from './artifacts.mjs';

const home = 'C:/Users/example';
const group = { workspace: 'sample', machine: '', seats: [{ address: 't1', role: 'maker', cwd: home + '/Project/sample' }] };
test('Windows uses the installed command wrapper rather than an extensionless shell script', () => {
  assert.equal(seatsExecutable('windows'), 'seats.cmd');
  assert.equal(seatsExecutable('linux'), 'seats');
  assert.equal(seatsExecutable('macos'), 'seats');
});
test('artifact metadata discovery deliberately skips Work, remote and unlabelled groups', () => {
  assert.equal(artifactSource(group, home), home + '/Project/sample');
  assert.equal(artifactSource({ ...group, machine: 'remote' }, home), null);
  assert.equal(artifactSource({ ...group, workspace: null }, home), null);
  for (const seat of [{ ...group.seats[0], cwd: home + '/Work/sample' }, { ...group.seats[0], address: 'remote/t1' }]) {
    assert.equal(artifactSource({ ...group, seats: [seat] }, home), null);
  }
});
test('metadata is versioned, bound to the institution, and confined to personal paths', () => {
  const info = { schema_version: 1, workspace: 'sample', project: home + '/Project/sample', config_dir: home + '/Project/kit/institutions/sample' };
  assert.equal(acceptInfo(info, group, home), info);
  for (const changed of [{ schema_version: 2 }, { workspace: 'another' }, { project: home + '/Work/sample' }, { config_dir: home + '/Work/kit' }]) {
    assert.equal(acceptInfo({ ...info, ...changed }, group, home), null);
  }
});

test('seat urgency and row order do not change the institution metadata source', () => {
  const seats = [group.seats[0], { ...group.seats[0], address: 't2', cwd: home + '/Project/sample-wt/maker' }];
  assert.equal(artifactSource({ ...group, seats }, home), artifactSource({ ...group, seats: seats.toReversed() }, home));
});
test('only bounded content-keyed previews enter image(); fit preserves their aspect ratio', () => {
  const value = { status: 'ready', image: 'herd-cache/' + 'a'.repeat(64) + '.png', width: 768, height: 512, commit: 'b'.repeat(40), path: 'renders/approved/sheet.png' };
  assert.equal(acceptArtifact(value), value);
  for (const changed of [{ image: '../secret.png' }, { width: Infinity }, { height: 32769 }, { width: 8192, height: 8192 }, { commit: 'HEAD' }, { status: 'empty' }]) assert.equal(acceptArtifact({ ...value, ...changed }), null);
  const fit = fitArtifact(value, 240);
  assert.equal(fit.width / fit.height, 1.5);
  assert.ok(fit.height <= 160 && fit.width <= 240);
});

test('read locks and mail do not turn watchers into a metadata refresh loop', () => {
  const root = home + '/Project/sample/.claude/seats';
  assert.equal(configChanges([root + '/asks.lock', root + '/asks.lock/owner', root + '/mail.jsonl'], root), false);
  assert.equal(configChanges([root + '/asks.jsonl'], root), true);
  assert.equal(configChanges([root + '/seats.conf'], root), true);
  assert.equal(configChanges([root + '/role-history.tsv'], root), true);
  assert.equal(configChanges([root], root), true);
});
