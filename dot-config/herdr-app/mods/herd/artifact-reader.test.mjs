import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { artifact, localRepository, validateGlob, pngSize, trimCache, CACHE_COUNT, CACHE_BYTES, MAX_SOURCE_BYTES } from './artifact-reader.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXWkAAAAASUVORK5CYII=', 'base64');
const digest = data => createHash('sha256').update(data).digest('hex');
const run = promisify(execFile);
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'herd-artifact-test-'));
  assert.equal(fs.realpathSync(path.dirname(temporary)), fs.realpathSync(os.tmpdir()));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const home = path.join(temporary, 'home'), repo = path.join(home, 'Project/sample'), app = path.join(home, '.config/herdr-app');
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(path.join(app, 'mods/herd'), { recursive: true }); fs.mkdirSync(path.join(home, 'Work'), { recursive: true });
  fs.writeFileSync(path.join(app, 'mods/herd/main.js'), 'fixture mod source');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const write = (name, data = png) => { const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
  const commit = (...names) => { git('add', '--', ...names); git('commit', '-qm', 'fixture', '--', ...names); return git('rev-parse', 'HEAD'); };
  return { temporary, home, repo, app, git, write, commit, read: glob => artifact(repo, glob ?? 'approved/*.png', home, app) };
}

test('committed PNG bytes, provenance and lexical selection ignore working copies and modification times', async t => {
  const f = fixture(t);
  f.write('approved/z.png'); f.write('approved/a.png'); const commit = f.commit('approved/z.png', 'approved/a.png');
  f.write('approved/a.png', 'uncommitted'); f.write('approved/new.png', 'untracked');
  const assets = () => fs.readdirSync(path.join(f.app, 'mods'), { recursive: true }).map(name => {
    const stat = fs.statSync(path.join(f.app, 'mods', name));
    return [name, stat.size, stat.mtimeMs];
  });
  const beforeAssets = assets();
  const result = await f.read();
  assert.deepEqual(assets(), beforeAssets, 'cache misses must change no mod asset or directory');
  assert.equal(result.path, 'approved/a.png'); assert.equal(result.commit, commit); assert.equal(result.sha256, digest(png));
  const cache = path.join(f.app, result.image), before = fs.statSync(cache).mtimeMs;
  assert.deepEqual(fs.readFileSync(cache), png); assert.deepEqual([result.width, result.height], [1, 1]);
  await f.read(); assert.equal(fs.statSync(cache).mtimeMs, before, 'cache hits never touch the image');
  assert.deepEqual(assets(), beforeAssets, 'cache hits must change no mod asset or directory, including lock files');
});

test('a deletion-only newest commit leaves the slot empty instead of reviving an older image', async t => {
  const f = fixture(t); f.write('approved/sheet.png'); f.commit('approved/sheet.png');
  f.git('rm', '-q', '--', 'approved/sheet.png'); f.git('commit', '-qm', 'delete');
  await assert.rejects(f.read(), /no-present-image/);
  await assert.rejects(f.read('missing/*.png'), /no-match/);
});

test('ask evidence selects exactly the named committed PNG inside the owning repository', async t => {
  const f = fixture(t);
  f.write('docs/a.png'); f.write('docs/z.png'); const commit = f.commit('docs/a.png', 'docs/z.png');
  f.write('docs/z.png', 'uncommitted replacement');
  const result = await artifact(f.repo, 'docs/z.png', f.home, f.app, true);
  assert.equal(result.path, 'docs/z.png'); assert.equal(result.commit, commit); assert.equal(result.sha256, digest(png));
  for (const value of ['docs/*.png', '../outside.png', '/outside.png', 'docs/[az].png']) await assert.rejects(artifact(f.repo, value, f.home, f.app, true));
  await assert.rejects(artifact(path.join(f.repo, 'docs'), 'z.png', f.home, f.app, true), /owner-root-required/);
});

test('LFS reads only verified local objects or matching hydrated bytes and never fetches', async t => {
  const f = fixture(t), sha = digest(png);
  f.write('approved/sheet.png', `version https://git-lfs.github.com/spec/v1\noid sha256:${sha}\nsize ${png.length}\n`);
  f.commit('approved/sheet.png');
  f.git('config', 'remote.origin.url', 'https://unreachable.invalid/no-network');
  await assert.rejects(f.read());
  f.write('approved/sheet.png', png); assert.equal((await f.read()).sha256, sha);
  f.write('approved/sheet.png', Buffer.alloc(png.length)); await assert.rejects(f.read(), /lfs-not-present/);
  const object = path.join(f.repo, '.git/lfs/objects', sha.slice(0, 2), sha.slice(2, 4), sha);
  fs.mkdirSync(path.dirname(object), { recursive: true }); fs.writeFileSync(object, png);
  assert.equal((await f.read()).sha256, sha);
});

test('scope, linked Git metadata, glob and PNG header bounds fail before source access', async t => {
  const f = fixture(t);
  assert.throws(() => localRepository(path.join(f.home, 'Work'), f.home), /scope/);
  for (const glob of ['../x.png', '/x.png', ':(glob)x.png', 'x.jpg', 'a\\x.png', '.git/*.png']) assert.throws(() => validateGlob(glob));
  assert.throws(() => pngSize(Buffer.from('not a png')), /invalid-png/);
  const huge = Buffer.from(png); huge.writeUInt32BE(20000, 16); huge.writeUInt32BE(20000, 20);
  assert.throws(() => pngSize(huge), /image-too-large/);
  const linked = path.join(f.home, 'Project/linked'); fs.mkdirSync(linked);
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ' + path.join(f.home, 'Work'));
  assert.throws(() => localRepository(linked, f.home), /scope/);
  f.write('approved/sheet.png'); f.commit('approved/sheet.png');
  await assert.rejects(artifact(f.repo, 'approved/*.png', f.home, path.join(f.home, 'Work')), /invalid-cache/);
  assert.deepEqual(fs.readdirSync(path.join(f.home, 'Work')), [], 'a rejected cache root is never created under Work');
  f.write('approved/huge.png', Buffer.alloc(MAX_SOURCE_BYTES + 1)); f.commit('approved/huge.png');
  await assert.rejects(f.read(), /source-too-large/);
});

test('cache count and byte limits remove only owned regular image files', t => {
  const f = fixture(t), cache = path.join(f.app, 'cache'); fs.mkdirSync(cache);
  for (let i = 0; i < CACHE_COUNT + 3; i++) fs.writeFileSync(path.join(cache, i.toString(16).padStart(64, '0') + '.png'), Buffer.alloc(1024));
  fs.writeFileSync(path.join(cache, 'keep.txt'), 'unrelated'); trimCache(cache);
  assert.equal(fs.readdirSync(cache).filter(name => name.endsWith('.png')).length, CACHE_COUNT);
  trimCache(cache, CACHE_COUNT, 2048);
  assert.ok(fs.readdirSync(cache).filter(name => name.endsWith('.png')).length <= 2);
  assert.equal(fs.readFileSync(path.join(cache, 'keep.txt'), 'utf8'), 'unrelated');
  assert.equal(CACHE_BYTES, 12 * 1024 * 1024);
});

test('concurrent CLI readers serialize cache writes and leave no temporary or lock files', async t => {
  const f = fixture(t); f.write('approved/sheet.png'); f.commit('approved/sheet.png');
  const helper = fileURLToPath(new URL('./artifact-reader.mjs', import.meta.url));
  const args = [helper, '--repo', f.repo, '--glob', 'approved/*.png', '--home', f.home, '--app-home', f.app];
  const outputs = await Promise.all([run(process.execPath, args), run(process.execPath, args), run(process.execPath, args)]);
  for (const output of outputs) assert.equal(JSON.parse(output.stdout).status, 'ready');
  assert.deepEqual(fs.readdirSync(path.join(f.app, 'herd-cache')), [digest(png) + '.png']);
});
