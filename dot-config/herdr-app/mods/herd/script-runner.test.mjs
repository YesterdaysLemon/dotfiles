import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectScript, launchScript } from './script-runner.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herd-script-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(home, 'Project/sample space');
  fs.mkdirSync(path.join(project, 'tools'), { recursive: true }); fs.mkdirSync(path.join(home, 'Work'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
  const file = path.join(project, 'tools/setup.ps1');
  fs.writeFileSync(file, "Write-Output 'Harmless fixture'\n", 'utf8');
  git('add', 'tools/setup.ps1'); git('commit', '-qm', 'fixture', '--', 'tools/setup.ps1');
  const options = { platform: 'linux', run(command, args) { assert.equal(command, 'seats'); assert.deepEqual(args, ['--project', fs.realpathSync(project), '_asks-run-check', 'tools/setup.ps1']); return JSON.stringify({ run: 'tools/setup.ps1', owner_project: fs.realpathSync(project), script: fs.realpathSync(file) }); } };
  return { home, project, file, git, options, request: { id: 'sample:run', project, home, run: 'tools/setup.ps1' } };
}

test('the check and terminal launcher bind HEAD and exact bytes, use argv, and inherit the interactive terminal', t => {
  const f = fixture(t), script = inspectScript(f.request, f.options), calls = [];
  assert.equal(script.project, fs.realpathSync(f.project));
  const request = { ...f.request, ...script };
  assert.equal(launchScript(request, { ...f.options, spawn(...args) { calls.push(args); return { status: 0 }; } }), 0);
  assert.deepEqual(calls[0][1], ['-NoLogo', '-NoProfile', '-File', script.file]);
  assert.deepEqual(calls[0][2], { cwd: script.project, stdio: 'inherit', shell: false });
  assert.throws(() => inspectScript(f.request, { platform: 'linux', run() { throw new Error('Kit gate refused.'); } }), /Kit gate refused/);
  assert.throws(() => inspectScript(f.request, { platform: 'linux', run() { return '{"run":"other.ps1","owner_project":"/elsewhere","script":"/elsewhere/other.ps1"}'; } }), /different owning script/);
  fs.writeFileSync(f.file, "Write-Output 'Changed after click'\n", 'utf8');
  f.git('update-index', '--assume-unchanged', 'tools/setup.ps1');
  assert.throws(() => launchScript(request, { ...f.options, spawn() { assert.fail('changed script cannot run'); } }));
});

test('script checks reject traversal, Work, missing/untracked files, staged edits, linked parents and Git links', t => {
  const f = fixture(t);
  for (const run of ['../setup.ps1', '/setup.ps1', 'tools\\setup.ps1', 'tools/../setup.ps1', '.git/setup.ps1', 'tools/new.ps1']) assert.throws(() => inspectScript({ ...f.request, run }, f.options));
  assert.throws(() => inspectScript({ ...f.request, project: path.join(f.home, 'Work') }, f.options));
  fs.writeFileSync(path.join(f.project, 'tools/new.ps1'), 'untracked');
  assert.throws(() => inspectScript({ ...f.request, run: 'tools/new.ps1' }, f.options));
  fs.writeFileSync(f.file, 'staged edit'); f.git('add', 'tools/setup.ps1');
  assert.throws(() => inspectScript(f.request, f.options)); f.git('reset', '-q', 'HEAD', '--', 'tools/setup.ps1'); f.git('checkout', '--', 'tools/setup.ps1');
  const link = path.join(f.project, 'linked'); fs.symlinkSync(path.join(f.project, 'tools'), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inspectScript({ ...f.request, run: 'linked/setup.ps1' }, f.options));
});

test('the real PowerShell launcher runs a harmless committed fixture with output retained in its terminal', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, "Set-Content -LiteralPath 'fixture-ran.txt' -Value 'fixture only'\n", 'utf8');
  f.git('add', 'tools/setup.ps1'); f.git('commit', '-qm', 'harmless run', '--', 'tools/setup.ps1');
  const bin = path.join(f.home, 'bin'); fs.mkdirSync(bin);
  const gate = path.join(bin, 'gate.cjs');
  fs.writeFileSync(gate, `const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2);if(a[0]!=='--project'||a[2]!=='_asks-run-check')process.exit(4);console.log(JSON.stringify({run:a[3],owner_project:fs.realpathSync(a[1]),script:fs.realpathSync(path.join(a[1],a[3]))}));`);
  const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(bin, 'seats'), `#!/usr/bin/env bash\nexport MSYS2_ARG_CONV_EXCL='*'\nexec ${quote(process.execPath)} ${quote(gate)} "$@"\n`, { encoding: 'utf8', mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  const cli = fileURLToPath(new URL('./script-runner.mjs', import.meta.url));
  const checked = JSON.parse(execFileSync(process.execPath, [cli, 'check', JSON.stringify(f.request)], { encoding: 'utf8', windowsHide: true, env }));
  assert.match(checked.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.parse(Buffer.from(checked.token, 'base64url')).project, fs.realpathSync(f.project));
  execFileSync(process.execPath, [cli, 'launch', checked.token], { windowsHide: true, env });
  assert.equal(fs.readFileSync(path.join(f.project, 'fixture-ran.txt'), 'utf8').trim(), 'fixture only');
});
