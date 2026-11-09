// Preserve arbitrary answer text on Windows without a cmd.exe command string.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answerCommand } from './asks.mjs';

export function seatsInvocation(platform = process.platform, env = process.env, run = execFileSync) {
  if (platform !== 'win32') return { command: 'seats', prefix: [] };
  const entry = String(env.PATH || env.Path || '').split(';').map(folder => path.join(folder.replace(/^"|"$/g, ''), 'seats'))
    .find(file => { try { return fs.statSync(file).isFile() && fs.readFileSync(file, 'utf8').slice(0, 80).includes('bash'); } catch { return false; } });
  if (!entry) throw new Error('The Bash seats entrypoint is unavailable on PATH.');
  const execPath = run('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true, timeout: 5000, env }).trim();
  for (let folder = path.resolve(execPath), depth = 0; depth < 6; folder = path.dirname(folder), depth++) {
    const bash = path.join(folder, 'bin/bash.exe');
    if (fs.existsSync(bash)) return { command: bash, prefix: [entry] };
  }
  throw new Error('Git Bash is unavailable.');
}

export function runAnswer(request, options = {}) {
  const run = options.run || execFileSync;
  const project = fs.realpathSync(request?.project || '');
  const userHome = fs.realpathSync(request?.home || '');
  const command = answerCommand({ id: request.id, to: 'al', state: 'open', owner_project: project }, request.answer, userHome);
  const invocation = seatsInvocation(options.platform, options.env, run);
  return run(invocation.command, [...invocation.prefix, ...command.args], { cwd: command.cwd, encoding: 'utf8', windowsHide: true,
    timeout: 25000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: options.env || process.env });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2].length > 100000) throw new Error('Invalid answer request.');
    process.stdout.write(runAnswer(JSON.parse(process.argv[2])));
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim();
    console.error(detail?.slice(0, 400) || (error.code === 'ETIMEDOUT' ? 'Answer timed out; refresh before trying again.' : error.message));
    process.exitCode = 1;
  }
}
