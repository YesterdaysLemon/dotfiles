// Local committed PNG extraction. Node built-ins only; no image decoder or network.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';

export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_PIXELS = 32_000_000;
export const CACHE_COUNT = 24;
export const CACHE_BYTES = 12 * 1024 * 1024;
const fail = reason => { throw new Error(reason); };
const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (value, root) => { const relative = path.relative(root, value); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const personal = (value, userHome) => inside(value, fs.realpathSync(path.join(userHome, 'Project'))) && !inside(value, path.resolve(userHome, 'Work'));
const regular = file => { try { return fs.lstatSync(file).isFile(); } catch { return false; } };
const bounded = (file, limit) => {
  if (!regular(file) || fs.statSync(file).size > limit) fail('file-unavailable');
  const fd = fs.openSync(file, 'r');
  try {
    const data = Buffer.alloc(Math.min(fs.fstatSync(fd).size, limit) + 1);
    const count = fs.readSync(fd, data, 0, data.length, 0);
    if (count > limit) fail('source-too-large');
    return data.subarray(0, count);
  } finally { fs.closeSync(fd); }
};

export function localRepository(folder, userHome) {
  folder = fs.realpathSync(folder);
  if (!personal(folder, userHome)) fail('scope');
  for (let root = folder; personal(root, userHome); root = path.dirname(root)) {
    const dotgit = path.join(root, '.git');
    if (!fs.existsSync(dotgit)) continue;
    let gitdir = fs.realpathSync(dotgit);
    if (!personal(gitdir, userHome)) fail('scope');
    if (regular(gitdir)) {
      const link = bounded(gitdir, 4096).toString('utf8').trim();
      if (!link.startsWith('gitdir: ')) fail('invalid-git-link');
      gitdir = fs.realpathSync(path.resolve(root, link.slice(8)));
      if (!personal(gitdir, userHome)) fail('scope');
    }
    const common = path.join(gitdir, 'commondir');
    if (fs.existsSync(common) && !personal(fs.realpathSync(path.resolve(gitdir, bounded(common, 4096).toString('utf8').trim())), userHome)) fail('scope');
    return root;
  }
  fail('not-git');
}

function git(repo, ...args) {
  try {
    return execFileSync('git', ['--no-lazy-fetch', '-C', repo, ...args], { timeout: 10000,
      maxBuffer: MAX_SOURCE_BYTES + 4096, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
  } catch { fail('git-unavailable'); }
}

export function validateGlob(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 512 || pattern.trim() !== pattern ||
      /[\x00-\x1f\\:$`]/.test(pattern) || pattern.startsWith('/') || pattern.split('/').some(p => p === '..' || p === '.git') ||
      !pattern.endsWith('.png')) fail('invalid-glob');
  return pattern;
}

export function pngSize(data) {
  if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') fail('invalid-png');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (!width || !height || width > 32768 || height > 32768 || width * height > MAX_PIXELS) fail('image-too-large');
  return { width, height };
}

export function committedImage(repo, pattern, userHome) {
  const pathspec = ':(glob)' + validateGlob(pattern);
  const commit = git(repo, 'log', '-1', '--format=%H', '--', pathspec).toString('ascii').trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) fail('no-match');
  const paths = [...new Set(git(repo, 'diff-tree', '-m', '--root', '-r', '--no-commit-id', '--name-only', '--diff-filter=AM', '-z', commit, '--', pathspec)
    .toString('utf8').split('\0').filter(Boolean))].sort();
  if (!paths.length) fail('no-present-image');
  if (paths.length > 512) fail('invalid-selection');
  const relative = paths[0];
  const source = path.resolve(repo, relative);
  // Resolve existing links before any source-file access. Missing files are fine: Git owns the bytes.
  const canonical = fs.existsSync(source) ? fs.realpathSync(source) : source;
  if (!relative.endsWith('.png') || !inside(canonical, repo) || !personal(canonical, userHome)) fail('scope');
  const object = commit + ':' + relative;
  const size = Number(git(repo, 'cat-file', '-s', object).toString('ascii').trim());
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SOURCE_BYTES) fail('source-too-large');
  let data = git(repo, 'cat-file', 'blob', object);
  if (data.length !== size) fail('invalid-object');
  if (data.subarray(0, 43).toString('ascii').startsWith('version https://git-lfs.github.com/spec/v1')) {
    const pointer = /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize ([0-9]+)\n?$/.exec(data.toString('ascii'));
    if (!pointer) fail('invalid-lfs-pointer');
    const expected = Number(pointer[2]);
    if (!Number.isSafeInteger(expected) || expected > MAX_SOURCE_BYTES) fail('source-too-large');
    const common = fs.realpathSync(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').toString('utf8').trim());
    if (!personal(common, userHome)) fail('scope');
    const lfs = path.join(common, 'lfs/objects', pointer[1].slice(0, 2), pointer[1].slice(2, 4), pointer[1]);
    const local = regular(lfs) ? lfs : source;
    const real = fs.realpathSync(local);
    if (!personal(real, userHome) || (local === lfs && !inside(real, common))) fail('scope');
    data = bounded(real, MAX_SOURCE_BYTES);
    if (data.length !== expected || hash(data) !== pointer[1]) fail('lfs-not-present');
  }
  return { data, commit, relative, ...pngSize(data) };
}

export function trimCache(cache, maxCount = CACHE_COUNT, maxBytes = CACHE_BYTES) {
  const files = fs.readdirSync(cache).filter(name => /^[0-9a-f]{64}\.png$/.test(name) && regular(path.join(cache, name)))
    .map(name => ({ name, ...fs.statSync(path.join(cache, name)) })).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  let bytes = 0;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (index >= maxCount || bytes + file.size > maxBytes) fs.unlinkSync(path.join(cache, file.name));
    else bytes += file.size;
  }
}

async function cacheAccess(cache, lock, body) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || fs.lstatSync(lock).isSymbolicLink()) fail('cache-unavailable');
      // A dead process can leave a lock. Reclaim only its known file and empty directory.
      const ownerFile = path.join(lock, 'owner.json');
      try {
        const owner = JSON.parse(bounded(ownerFile, 256));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) fail('cache-unavailable');
        try { process.kill(owner.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') { fs.unlinkSync(ownerFile); fs.rmdirSync(lock); continue; } }
      } catch { /* An initializing writer owns the directory until this bounded wait expires. */ }
      if (Date.now() >= deadline) fail('cache-busy');
      await pause(25);
    }
  }
  const owner = path.join(lock, 'owner.json');
  try {
    fs.writeFileSync(owner, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    for (const name of fs.readdirSync(cache)) if (/^\.preview-[0-9a-f-]+\.tmp$/.test(name) && regular(path.join(cache, name))) fs.unlinkSync(path.join(cache, name));
    return body();
  } finally { if (regular(owner)) fs.unlinkSync(owner); fs.rmdirSync(lock); }
}

export async function artifact(folder, pattern, userHome, appHome) {
  userHome = fs.realpathSync(userHome);
  const repo = localRepository(folder, userHome);
  const { data, commit, relative, width, height } = committedImage(repo, pattern, userHome);
  if (data.length > CACHE_BYTES) fail('cache-full');
  appHome = fs.realpathSync(appHome);
  const cache = path.join(appHome, 'herd-cache');
  const lockRoot = path.join(appHome, 'cache/herd-locks');
  if (inside(cache, path.resolve(userHome, 'Work'))) fail('invalid-cache');
  for (const part of [cache, path.join(appHome, 'cache'), lockRoot]) {
    if (fs.existsSync(part) && fs.realpathSync(part) !== part) fail('invalid-cache');
    fs.mkdirSync(part, { recursive: true });
  }
  const digest = hash(data), output = path.join(cache, digest + '.png');
  // Herdr reloads scripts on mod asset edits. Both cache and locks live outside
  // mods, so neither a new artifact nor a cache hit can reload the script.
  await cacheAccess(cache, path.join(lockRoot, hash(Buffer.from(cache)) + '.writer.lock'), () => {
    if (fs.existsSync(output) && !regular(output)) fail('invalid-cache');
    if (!regular(output) || hash(bounded(output, MAX_SOURCE_BYTES)) !== digest) {
      trimCache(cache, CACHE_COUNT - 1, CACHE_BYTES - data.length);
      const temporary = path.join(cache, '.preview-' + randomUUID() + '.tmp');
      try { fs.writeFileSync(temporary, data, { flag: 'wx' }); fs.renameSync(temporary, output); }
      finally { if (regular(temporary)) fs.unlinkSync(temporary); }
    }
    // No writes on a cache hit: asset watchers must not trigger a reload loop.
    trimCache(cache);
    if (!regular(output)) fail('cache-full');
  });
  return { status: 'ready', image: 'herd-cache/' + digest + '.png', width, height, commit, path: relative, sha256: digest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { repo: { type: 'string' }, glob: { type: 'string' }, home: { type: 'string' }, 'app-home': { type: 'string' } } });
    if (Object.values(values).length !== 4) fail('invalid-arguments');
    console.log(JSON.stringify(await artifact(values.repo, values.glob, values.home, values['app-home'])));
  } catch (error) { console.log(JSON.stringify({ status: 'empty', reason: error.message || 'unavailable' })); }
}
