// The seats kit validates the catalog. This bridge verifies and stages its image manifest.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localRepository, cacheAccess, MAX_SOURCE_BYTES } from './artifact-reader.mjs';
import { seatsInvocation } from './answer-runner.mjs';
import { scriptPath } from './asks.mjs';

export const CARD_CACHE_COUNT = 96, CARD_CACHE_BYTES = 64 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (file, root) => { const rel = path.relative(root, file); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
const fail = text => { throw new Error(text); };
const imageName = /^[0-9a-f]{64}\.(png|jpg)$/;
function bounded(file, limit) {
  if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > limit) fail('Card file is unavailable or too large.');
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(Math.min(fs.fstatSync(fd).size, limit) + 1), count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count > limit) fail('Card file is too large.');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
function ownRequest(userHome, appHome, file) {
  const work = path.resolve(userHome, 'Work');
  if (inside(path.resolve(appHome), work)) fail('Work is excluded.');
  const app = fs.realpathSync(appHome);
  if (inside(app, work) || path.dirname(path.resolve(file)) !== app || !/^\.herd-card-request-[a-z0-9-]+\.json$/.test(path.basename(file))) fail('Invalid card request location.');
  return app;
}
export function cleanCardRequest(userHome, appHome, file) {
  ownRequest(userHome, appHome, file);
  if (fs.existsSync(file)) {
    if (!fs.lstatSync(file).isFile()) fail('Invalid card request file.');
    fs.unlinkSync(file);
  }
}
function cacheFolder(appHome, userHome) {
  const app = fs.realpathSync(appHome), work = path.resolve(userHome, 'Work');
  if (inside(app, work)) fail('Work is excluded.');
  for (const folder of ['herd-cache', 'herd-cache/cards', 'cache', 'cache/herd-locks']) {
    const full = path.join(app, folder);
    if (fs.existsSync(full) && fs.realpathSync(full) !== full) fail('Linked card cache refused.');
    fs.mkdirSync(full, { recursive: true });
  }
  return path.join(app, 'herd-cache/cards');
}
function trim(cache, keep) {
  const files = fs.readdirSync(cache).filter(name => imageName.test(name) && fs.lstatSync(path.join(cache, name)).isFile())
    .map(name => ({ name, ...fs.statSync(path.join(cache, name)) })).sort((a, b) => Number(keep.has(b.name)) - Number(keep.has(a.name)) || b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  let bytes = 0;
  files.forEach((file, index) => {
    if (index >= CARD_CACHE_COUNT || bytes + file.size > CARD_CACHE_BYTES) {
      if (keep.has(file.name)) fail('Card exceeds the image cache budget.');
      fs.unlinkSync(path.join(cache, file.name));
    } else bytes += file.size;
  });
}

export async function checkedCard(request, options = {}) {
  const userHome = fs.realpathSync(request.home), repo = localRepository(request.project, userHome);
  if (repo !== fs.realpathSync(request.project)) fail('Use the owning project root.');
  if (!Array.isArray(request.options) || request.options.length > 30 || request.options.some(v => typeof v !== 'string' || v.includes('|'))) fail('Invalid owning ask options.');
  const input = JSON.stringify(request.card);
  if (!input || Buffer.byteLength(input) > 65536) fail('Card exceeds 64 KiB.');
  const run = options.run || execFileSync, invocation = options.invocation || seatsInvocation(options.platform, options.env, run);
  const args = [...invocation.prefix, '--project', repo, '_asks-card-check'];
  if (request.options.length) args.push('--options', request.options.join('|'));
  if (request.recommendation) args.push('--rec', request.recommendation);
  const gitSettings = { encoding: 'utf8', cwd: repo, timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } };
  const commit = () => execFileSync('git', ['--no-lazy-fetch', '-C', repo, 'rev-parse', 'HEAD'], gitSettings).trim();
  const before = commit();
  let result;
  try { result = JSON.parse(run(invocation.command, args, { ...gitSettings, input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 90000, maxBuffer: 2 * 1024 * 1024 })); }
  catch (error) { fail(error.stderr?.toString('utf8').trim().slice(0, 400) || 'Card validation is unavailable.'); }
  if (fs.realpathSync(result.owner_project) !== repo || result.card?.schema !== 'ark-card/1' || !Array.isArray(result.images) || result.images.length > 70) fail('Invalid card validation receipt.');
  if (request.expectedImages && (!Array.isArray(request.expectedImages) || request.expectedImages.length !== result.images.length ||
      request.expectedImages.some((image, index) => image.path !== result.images[index].path || image.sha256 !== result.images[index].sha256))) fail('Card images changed. Refresh to inspect them before answering.');
  let baseline = null;
  if (request.card_images != null) {
    const seen = new Set(); let bytes = 0;
    if (!Array.isArray(request.card_images) || request.card_images.length > 70 || request.card_images.some(image => {
      if (!scriptPath(image?.path) || !/^[0-9a-f]{64}$/.test(image.sha256 || '') || !Number.isInteger(image.bytes) || image.bytes < 1 || image.bytes > MAX_SOURCE_BYTES || seen.has(image.path)) return true;
      seen.add(image.path); bytes += image.bytes; return false;
    }) || bytes > 32 * 1024 * 1024 || seen.size !== result.images.length || result.images.some(image => !seen.has(image.path))) fail('Invalid recorded card image baseline.');
    baseline = new Map(request.card_images.map(image => [image.path, image]));
  }
  let total = 0;
  const images = result.images.map(item => {
    if (!scriptPath(item.path) || !/\.(png|jpe?g)$/i.test(item.path) || !/^[0-9a-f]{64}$/.test(item.sha256) ||
        !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_SOURCE_BYTES || !['image/png', 'image/jpeg'].includes(item.mime) ||
        !Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 8192 || item.height > 8192 || item.width * item.height > 16_000_000) fail('Invalid card image receipt.');
    const file = path.resolve(repo, item.path);
    if (!inside(file, repo) || fs.realpathSync(file) !== file || fs.realpathSync(item.file) !== file) fail('Linked or foreign card image refused.');
    const data = bounded(file, MAX_SOURCE_BYTES);
    if (data.length !== item.bytes || digest(data) !== item.sha256 || fs.realpathSync(file) !== file) fail('Card image changed after validation.');
    total += data.length;
    if (total > 32 * 1024 * 1024) fail('Card images exceed 32 MiB.');
    return { item, data, name: item.sha256 + (item.mime === 'image/png' ? '.png' : '.jpg') };
  });
  if (before !== commit()) fail('Project changed during card validation. Check again.');
  if (images.length) {
    const cache = cacheFolder(request.appHome, userHome), keep = new Set(images.map(image => image.name));
    await cacheAccess(cache, path.join(request.appHome, 'cache/herd-locks/card-writer.lock'), () => {
      for (const name of fs.readdirSync(cache)) if (/^\.card-[0-9a-f-]+\.tmp$/.test(name) && fs.lstatSync(path.join(cache, name)).isFile()) fs.unlinkSync(path.join(cache, name));
      for (const { item, data, name } of images) {
        const target = path.join(cache, name);
        if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) fail('Linked cache image refused.');
        if (fs.existsSync(target) && digest(bounded(target, MAX_SOURCE_BYTES)) === item.sha256) continue;
        const temporary = path.join(cache, '.card-' + randomUUID() + '.tmp');
        try { fs.writeFileSync(temporary, data, { flag: 'wx' }); fs.renameSync(temporary, target); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      }
      trim(cache, keep);
    });
  }
  return { card: result.card, images: images.map(({ item, name }) => {
    const asked = baseline?.get(item.path), changed = asked && (asked.sha256 !== item.sha256 || asked.bytes !== item.bytes);
    return { status: 'ready', image: 'herd-cache/cards/' + name, path: item.path, width: item.width, height: item.height,
      commit: before, sha256: item.sha256, bytes: item.bytes, provenance: !asked ? 'unrecorded' : changed ? 'changed' : 'same',
      ...(changed ? {askedSha256:asked.sha256,askedBytes:asked.bytes} : {}) };
  }) };
}

export async function runCardRequest(userHome, appHome, file, options = {}) {
  ownRequest(userHome, appHome, file);
  try { return await checkedCard({ ...JSON.parse(bounded(file, 512 * 1024).toString('utf8')), home: userHome, appHome }, options); }
  finally { cleanCardRequest(userHome, appHome, file); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) fail('Invalid card request.');
    const [mode, userHome, appHome, file] = process.argv.slice(2);
    if (mode === 'check') console.log(JSON.stringify(await runCardRequest(userHome, appHome, file)));
    else if (mode === 'clean') cleanCardRequest(userHome, appHome, file);
    else fail('Invalid card request mode.');
  } catch (error) { console.error(String(error.message || 'Card unavailable.').slice(0, 400)); process.exitCode = 1; }
}
