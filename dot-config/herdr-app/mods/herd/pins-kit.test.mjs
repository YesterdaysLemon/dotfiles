import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makePin, resolvePin } from './pins.mjs';

// Opt in to the real kit contract; all mutations stay in a scratch institution.
// The normal suite remains usable on machines without the personal seats kit.
test('real seats info/rename-role emits the ordered history consumed by saved pins', { skip: !process.env.HERD_TEST_SEATS_KIT }, async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'herd-pins-kit-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('herd-pins-kit-'));
    rmSync(root, { recursive: true, force: true });
  });
  const userHome = root.replace(/\\/g, '/') + '/home', project = userHome + '/Project/sample';
  const cfg = project + '/.claude/seats', bin = path.join(root, 'bin');
  mkdirSync(cfg + '/handoffs', { recursive: true }); mkdirSync(bin);
  writeFileSync(path.join(bin, 'hc'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  writeFileSync(cfg + '/seats.conf', 'SEATS_HERDR_WORKSPACE=pin-fixture\nSEATS_CONDUCTOR=guide\nSEATS_HANDOFFS=.claude/seats/handoffs\n');
  writeFileSync(cfg + '/roles', 'guide\nmaker_old\n');
  for (const role of ['guide', 'maker_old']) writeFileSync(cfg + '/handoffs/' + role + '.md', '# Synthetic fixture\n');
  const bash = process.env.HERD_TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
  const kit = path.resolve(process.env.HERD_TEST_SEATS_KIT).replace(/\\/g, '/');
  const run = promisify(execFile);
  const invoke = async (...args) => (await run(bash, [kit + '/bin/seats', '--project', project, ...args], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, SEATS_HOME: path.join(root, 'institutions'), PATH: bin + path.delimiter + process.env.PATH },
  })).stdout;
  const group = { key: 'fixture', workspace: 'pin-fixture', name: 'Fixture', seats: [
    { address: 't1', role: 'guide', cwd: project }, { address: 't2', role: 'maker_old', cwd: project },
  ] };
  const infos = { fixture: { cwd: project, info: JSON.parse(await invoke('info', '--json')) } };
  const maker = makePin(group, group.seats[1], infos, userHome), conductor = makePin(group, group.seats[0], infos, userHome);
  await invoke('rename-role', 'maker_old', 'builder');
  await invoke('rename-role', 'builder', 'craft-worker');
  await invoke('rename-role', 'guide', 'coordinator');
  infos.fixture.info = JSON.parse(await invoke('info', '--json'));
  assert.deepEqual(infos.fixture.info.renames.map(({ from, to }) => [from, to]), [
    ['maker_old', 'builder'], ['builder', 'craft-worker'], ['guide', 'coordinator'],
  ]);
  // Legacy roles may contain underscores; new targets follow the current writer grammar.
  group.seats[1] = { ...group.seats[1], address: 't9', role: 'craft-worker' };
  group.seats[0] = { ...group.seats[0], address: 't8', role: 'coordinator' };
  assert.equal(resolvePin(maker, [group], infos, userHome).seat.address, 't9');
  assert.equal(resolvePin(conductor, [group], infos, userHome).seat.address, 't8');
});
