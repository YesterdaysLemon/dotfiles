// Own-ledger reads and explicit child openings. No shell strings or terminal sends.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seatsInvocation } from './answer-runner.mjs';
import { personalFolder } from './spaces.mjs';
import { pathKey } from './model.mjs';
import { clarificationQuestion, clarificationTarget, clarificationCards } from './clarifications.mjs';

function context(request, options) {
  const project = fs.realpathSync(request?.project || ''), userHome = fs.realpathSync(request?.home || '');
  if (!personalFolder(project, userHome)) throw new Error('The owning personal project is unavailable.');
  const run = options.run || execFileSync, invocation = options.invocation || seatsInvocation(options.platform, options.env, run);
  const settings = {
    cwd: project, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    // Every party and parent here belongs to this owner. Do not discover other
    // configured institutions merely to read or clarify this one ledger.
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...(options.env || process.env), SEATS_ASK_ROUTES_FILE: '/dev/null' },
  };
  const invoke = args => {
    const argv = [...invocation.prefix, '--project', project, ...args];
    if (options.run) return run(invocation.command, argv, settings);
    const output = spawnSync(invocation.command, argv, settings);
    if (output.error || output.status !== 0 || (args[0] === 'info' && /role history unavailable/i.test(output.stderr || ''))) {
      const failure = new Error(output.stderr?.trim().slice(0, 400) || output.error?.message || 'The seats command failed.');
      failure.status = output.status; failure.signal = output.signal; failure.code = output.error?.code; failure.indeterminate = Boolean(output.error);
      throw failure;
    }
    return output.stdout;
  };
  const info = JSON.parse(invoke(['info', '--json']));
  if (info?.schema_version !== 1 || pathKey(info.project) !== pathKey(project) ||
      !personalFolder(fs.realpathSync(info.config_dir), userHome)) throw new Error('The canonical personal owner is unavailable.');
  const read = () => {
    const items = JSON.parse(invoke(['asks', '--json']));
    if (!Array.isArray(items) || items.length > 10000) throw new Error('Invalid owning ledger response.');
    return items;
  };
  return { project, userHome, info, invoke, read };
}

function parentRow(id, items, ctx) {
  const matches = items.filter(item => item?.id === id);
  if (matches.length !== 1) throw new Error('The parent ask is unavailable.');
  const parent = matches[0];
  if (pathKey(parent.owner_project) !== pathKey(ctx.project)) throw new Error('The parent belongs to a different project.');
  let target = null, error;
  try { target = clarificationTarget(parent, ctx.info, ctx.userHome); } catch (failure) { error = failure.message; }
  return { parent, target, error, items: clarificationCards(parent, items, ctx.info, ctx.userHome) };
}

export function readClarifications(request, options = {}) {
  if (!Array.isArray(request.parents) || request.parents.length > 500 || request.parents.some(id => typeof id !== 'string')) throw new Error('Invalid parent list.');
  const ctx = context(request, options), items = ctx.read();
  return { schema: 1, parents: [...new Set(request.parents)].map(id => {
    try { const row = parentRow(id, items, ctx); return { id, target: row.target, items: row.items, error: row.error }; }
    catch (error) { return { id, items: [], error: error.message }; }
  }) };
}

function journalFile(request, ctx, question, create = true) {
  const appHome = fs.realpathSync(request.appHome || '');
  const relative = path.relative(ctx.userHome, appHome);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The app home is outside the user home.');
  const folder = path.join(appHome, 'herd-clarifications');
  if (create) fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (fs.existsSync(folder) && (fs.lstatSync(folder).isSymbolicLink() || pathKey(fs.realpathSync(folder)) !== pathKey(folder))) throw new Error('The clarification journal is linked.');
  const key = createHash('sha256').update(JSON.stringify([pathKey(ctx.project), request.parent.id, question])).digest('hex');
  return path.join(folder, key + '.json');
}

function loadJournal(file) {
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Invalid clarification journal.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value?.schema !== 1 || !Array.isArray(value.before) || !['attempted', 'failed', 'sent'].includes(value.state) ||
      (value.state === 'failed' && (!Number.isInteger(value.exit_status) || value.exit_status <= 0 || !Number.isFinite(Date.parse(value.exited_at))))) throw new Error('Invalid clarification journal.');
  return value;
}

function saveJournal(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export function sendClarification(request, options = {}) {
  if (!['send', 'confirm'].includes(request.mode) || !request.parent?.id) throw new Error('Invalid clarification request.');
  const question = clarificationQuestion(request.option, request.question), ctx = context(request, options);
  const initial = ctx.read(), row = parentRow(request.parent.id, initial, ctx), parent = row.parent;
  if (!row.target) throw new Error(row.error || 'The asking role is unavailable.');
  if (parent.from !== request.parent.from || parent.question !== request.parent.question || parent.opened_at !== request.parent.opened_at ||
      JSON.stringify(parent.options || []) !== JSON.stringify(request.parent.options || []) || !parent.options?.includes(request.option)) throw new Error('The parent ask changed. Refresh before asking.');
  const matching = cards => cards.filter(card => card.option === request.option && card.question === request.question.trim());
  const openings = items => items.filter(item => item?.parent === parent.id && item.from === 'al' && item.question === question);
  const result = (state, cards = row.items) => ({ schema: 1, state, parents: [{ id: parent.id, target: row.target, items: cards }] });
  const existing = matching(row.items);
  if (existing.length === 1) return result('sent');
  if (existing.length > 1) return result('unconfirmed');
  // A matching opening on another recipient must also prevent a duplicate.
  if (openings(initial).length) return result('unconfirmed');
  if (request.mode === 'confirm') {
    const file = journalFile(request, ctx, question, false), saved = loadJournal(file);
    if (saved?.state !== 'failed' || saved.parent !== parent.id) return result('unconfirmed');
    const lock = file + '.lock';
    try { fs.mkdirSync(lock); } catch { return result('unconfirmed'); }
    try {
      const current = loadJournal(file);
      if (current?.state !== 'failed' || current.parent !== parent.id) return result('unconfirmed');
      // This snapshot is taken after the known completed failure, while this
      // request's writer lock is held. An unavailable/rewound ledger cannot clear it.
      const latestItems = ctx.read(), latest = parentRow(parent.id, latestItems, ctx);
      if (matching(latest.items).length === 1) return result('sent', latest.items);
      if (openings(latestItems).length || !current.before.every(id => latestItems.some(item => item.id === id))) return result('unconfirmed', latest.items);
      fs.unlinkSync(file);
      return result('not-sent', latest.items); // The next send remains a separate explicit action.
    } finally { fs.rmdirSync(lock); }
  }
  const file = journalFile(request, ctx, question);
  const saved = loadJournal(file);
  if (saved) return result('unconfirmed'); // No repeat write after an ambiguous attempt, including restart.
  const lock = file + '.lock';
  try { fs.mkdirSync(lock); } catch { throw new Error('This question is already being sent or needs a delivery check.'); }
  try {
    if (loadJournal(file)) return result('unconfirmed');
    const attempt = { schema: 1, state: 'attempted', parent: parent.id, before: initial.map(item => item.id), at: new Date().toISOString() };
    saveJournal(file, attempt);
    // Record intent before invoking a writer. Its notification can fail after the child was appended.
    try { ctx.invoke(['ask', '--from', 'al', '--parent', parent.id, '--', row.target.party, question]); }
    catch (error) {
      // Only a completed numeric exit is a clean failure. Timeouts, signals,
      // spawn errors and old attempted journals remain ambiguous.
      if (Number.isInteger(error.status) && error.status > 0 && error.status <= 255 && !error.signal && !error.code && !error.killed && !error.indeterminate) {
        saveJournal(file, { ...attempt, state: 'failed', exit_status: error.status, exited_at: new Date().toISOString() });
      }
    }
    try {
      const latest = parentRow(parent.id, ctx.read(), ctx), matches = matching(latest.items);
      if (matches.length === 1) {
        saveJournal(file, { schema: 1, state: 'sent', parent: parent.id, before: initial.map(item => item.id), child: matches[0].id });
        return result('sent', latest.items);
      }
      return result('unconfirmed', latest.items);
    } catch { return result('unconfirmed'); }
  } finally { fs.rmdirSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2].length > 100000) throw new Error('Invalid clarification request.');
    const request = JSON.parse(process.argv[2]);
    const result = request.mode === 'read' ? readClarifications(request) : sendClarification(request);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    console.error(error.stderr?.toString('utf8').trim().slice(0, 400) || error.message);
    process.exitCode = 1;
  }
}
