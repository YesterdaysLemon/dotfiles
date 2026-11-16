import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clarificationQuestion, clarificationTarget, clarificationCards } from './clarifications.mjs';
import { readClarifications, sendClarification } from './clarification-runner.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herd-clarifications-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(home, 'Project/sample'), appHome = path.join(home, 'app');
  const config_dir = path.join(project, '.claude/seats');
  fs.mkdirSync(config_dir, { recursive: true }); fs.mkdirSync(appHome);
  const parent = { id: 'sample:parent', from: 'sample/guide', to: 'al', state: 'open', opened_at: '2026-11-15T12:00:00Z',
    question: 'Which option?', options: ['Shelf "A"', 'Cards'], owner_project: project };
  const info = { schema_version: 1, project, config_dir, conductor: 'guide', roles: [{ role: 'guide', name: 'Current', cwd: project }], renames: [] };
  const items = [parent], calls = [];
  let writes = 0, failure = null;
  const request = { mode: 'send', project, home, appHome, parent: structuredClone(parent), option: parent.options[0], question: '-Literal "quoted"; $(nope) & %text%\n/exit `literal`' };
  const child = () => ({ id: 'sample:child', from: 'al', to: 'sample/' + info.roles[0].role, parent: parent.id, question: clarificationQuestion(request.option, request.question),
    opened_at: '2026-11-15T13:00:00Z', owner_project: project, state: 'open' });
  const options = { platform: 'linux', run(command, args, settings) {
    assert.equal(command, 'seats'); assert.equal(settings.cwd, project); assert.equal(settings.windowsHide, true);
    assert.equal(settings.env.SEATS_ASK_ROUTES_FILE, '/dev/null');
    assert.deepEqual(args.slice(0, 2), ['--project', project]); calls.push(args.slice(2));
    if (args[2] === 'info') return JSON.stringify(info);
    if (args[2] === 'asks') { if (failure === 'read' && writes) throw new Error('unavailable'); return JSON.stringify(items); }
    assert.equal(args[2], 'ask'); writes++;
    if (failure !== 'before') items.push(child());
    if (failure) throw new Error('lost receipt');
    return 'sample:child\n';
  } };
  return { home, project, appHome, parent, info, items, request, child, calls, options, writes: () => writes, fail(value) { failure = value; } };
}

test('a clarification uses literal argv, the current role and the existing parent; it never answers the parent', t => {
  const f = fixture(t);
  f.info.renames.push({ from: 'guide', to: 'vizier', at: '2026-11-15T12:30:00Z' }); f.info.roles[0].role = 'vizier';
  assert.equal(sendClarification(f.request, f.options).state, 'sent');
  assert.deepEqual(f.calls.find(args => args[0] === 'ask'), ['ask', '--from', 'al', '--parent', f.parent.id, '--', 'sample/vizier', clarificationQuestion(f.request.option, f.request.question)]);
  assert.equal(f.parent.state, 'open'); assert.equal(f.calls.some(args => args[0] === 'answer'), false);
  assert.equal(sendClarification(f.request, f.options).state, 'sent'); assert.equal(f.writes(), 1);
});

test('a lost success receipt is reconciled from exact owning child data without a second opening', t => {
  const f = fixture(t); f.fail('after');
  assert.equal(sendClarification(f.request, f.options).state, 'sent');
  assert.equal(sendClarification({ ...f.request, mode: 'confirm' }, f.options).state, 'sent'); assert.equal(f.writes(), 1);
});

test('uncertain attempts survive a new invocation and can only check delivery', t => {
  for (const failure of ['before', 'read']) {
    const f = fixture(t); f.fail(failure);
    assert.equal(sendClarification(f.request, f.options).state, 'unconfirmed');
    f.fail(null);
    assert.equal(sendClarification(f.request, f.options).state, failure === 'read' ? 'sent' : 'unconfirmed');
    assert.equal(sendClarification({ ...f.request, mode: 'confirm' }, f.options).state, failure === 'read' ? 'sent' : 'unconfirmed');
    assert.equal(f.writes(), 1);
  }
});

test('open, answered and withdrawn children fold under exactly their option, including absent successors', t => {
  const f = fixture(t), child = f.child();
  f.items.push(child, { ...child, id: 'sample:answer', state: 'answered', answer: 'Yes.\nDetails below.', answered_by: 'sample/guide' },
    { ...child, id: 'sample:withdrawn', state: 'withdrawn', reason: 'Duplicate question' },
    { ...child, id: 'sample:ordinary', question: 'Unstructured child question' }, { ...child, id: 'sample:wrong', to: 'sample/other' },
    { ...child, id: 'sample:not-al', from: 'sample/guide' }, { ...child, id: 'sample:other-parent', parent: 'sample:different' });
  f.info.roles = [];
  const response = readClarifications({ ...f.request, parents: [f.parent.id] }, f.options).parents[0];
  assert.deepEqual(response.items.map(item => item.state), ['answered', 'open', 'withdrawn']);
  assert.equal(response.target, null); assert.match(response.error, /unavailable/); assert.equal(f.writes(), 0);
});

test('Work, other owners, stale parent, missing role, bad history and invalid text refuse before writing', t => {
  for (const change of [f => { f.parent.state = 'answered'; }, f => { f.parent.options = ['Changed']; },
    f => { f.parent.from = 'different/guide'; }, f => { f.info.project += '-other'; }, f => { f.info.roles[0].cwd = path.join(f.home, 'Work/no'); },
    f => { f.info.renames = [{ from: 'guide', to: 'vizier', at: 'invalid' }]; }, f => { f.request.question = 'bad\0text'; },
    f => { f.parent.from = f.request.parent.from = 'sample'; f.info.conductor = 'bad/role'; f.info.roles[0].role = 'bad/role'; },
    f => { f.info.roles = []; }, f => { f.request.option = 'Missing'; }]) {
    const f = fixture(t); change(f); assert.throws(() => sendClarification(f.request, f.options)); assert.equal(f.writes(), 0);
  }
  const f = fixture(t), work = path.join(f.home, 'Work/sample'); fs.mkdirSync(work, { recursive: true });
  assert.throws(() => readClarifications({ ...f.request, project: work, parents: [f.parent.id] }, f.options)); assert.equal(f.calls.length, 0);
});

test('an institution asker uses its current conductor, and older role reuse is not replayed', t => {
  const f = fixture(t); f.parent.from = 'sample';
  assert.equal(clarificationTarget(f.parent, f.info, f.home).party, 'sample/guide');
  f.parent.from = 'sample/guide'; f.info.renames = [{ from: 'guide', to: 'retired', at: '2026-11-14T12:00:00Z' }];
  assert.equal(clarificationTarget(f.parent, f.info, f.home).party, 'sample/guide');
  assert.equal(clarificationCards(f.parent, [f.child()], f.info, f.home).length, 1);
});
