// Explicit ask-button launches only. No shell text, background job or credential handling.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { localRepository } from './artifact-reader.mjs';
import { scriptPath } from './asks.mjs';
import { seatsInvocation } from './answer-runner.mjs';

const fail = message => { throw new Error(message); };
export function inspectScript(request, options = {}) {
  if (!request || !/^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/.test(request.id || '') || !scriptPath(request.run)) fail('Invalid ask script.');
  const userHome = fs.realpathSync(request.home), project = fs.realpathSync(request.project);
  if (localRepository(project, userHome) !== project) fail('The owning project root is required.');
  // The first rough card supports the one-shot PowerShell entrypoint.
  if (!request.run.endsWith('.ps1')) fail('This terminal card currently supports PowerShell scripts (.ps1).');
  let file = project;
  const parts = request.run.split('/');
  for (const [index, part] of parts.entries()) {
    file = path.join(file, part);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || fs.realpathSync(file) !== file || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) fail('The script must be a regular file without linked directories.');
  }
  const run = options.run || execFileSync, invocation = seatsInvocation(options.platform, options.env, run);
  const gate = JSON.parse(run(invocation.command, [...invocation.prefix, '--project', project, '_asks-run-check', request.run], {
    cwd: project, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe'], env: options.env || process.env }));
  if (gate.run !== request.run || typeof gate.owner_project !== 'string' || typeof gate.script !== 'string' ||
      path.resolve(gate.owner_project) !== project || path.resolve(gate.script) !== file) fail('The kit returned a different owning script.');
  const git = (...args) => execFileSync('git', ['--no-lazy-fetch', '-C', project, ...args], {
    timeout: 10000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
  const commit = git('rev-parse', 'HEAD').toString('ascii').trim();
  const entry = git('ls-tree', '-z', commit, '--', ':(literal)' + request.run).toString('utf8');
  if (!/^100(?:644|755) blob [0-9a-f]{40,64}\t[^\0]+\0$/.test(entry)) fail('The script must be committed as a regular file at HEAD.');
  // Git's native comparison respects checkout line endings and refuses staged or unstaged edits.
  git('diff', '--no-ext-diff', '--no-textconv', '--exit-code', '--quiet', commit, '--', ':(literal)' + request.run);
  if (fs.statSync(file).size > 2 * 1024 * 1024) fail('The script is too large for this card.');
  const bytes = fs.readFileSync(file), committed = git('cat-file', 'blob', commit + ':' + request.run);
  const lf = data => Buffer.from(data.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  if (bytes.length > 2 * 1024 * 1024 || (!bytes.equals(committed) && !lf(bytes).equals(lf(committed)))) fail('The script differs from its committed version.');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { project, file, commit, digest };
}

export function launchScript(request, options = {}) {
  const script = inspectScript(request, options);
  if (script.commit !== request.commit || script.digest !== request.digest) fail('The script changed after the click. Refresh the ask and check the script.');
  const platform = options.platform || process.platform;
  const interpreter = platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
  const result = (options.spawn || spawnSync)(interpreter, ['-NoLogo', '-NoProfile', '-File', script.file], { cwd: script.project, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[3].length > 16000) fail('Invalid script launch request.');
    if (process.argv[2] === 'check') {
      const request = JSON.parse(process.argv[3]), script = inspectScript(request);
      const launch = { ...request, project: script.project, commit: script.commit, digest: script.digest };
      // Herdr starts argv in an interactive shell; a single shell-safe token preserves paths and JSON quotes.
      console.log(JSON.stringify({ ...script, token: Buffer.from(JSON.stringify(launch)).toString('base64url') }));
    }
    else if (process.argv[2] === 'launch' && /^[A-Za-z0-9_-]+$/.test(process.argv[3])) {
      process.exitCode = launchScript(JSON.parse(Buffer.from(process.argv[3], 'base64url').toString('utf8')));
    }
    else fail('Invalid script action.');
  } catch (error) { console.error((error.stderr?.toString('utf8').trim() || error.message || 'The script is unavailable.').slice(0, 400)); process.exitCode = 1; }
}
