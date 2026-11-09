import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as model from './model.mjs';
import * as artifacts from './artifacts.mjs';
import * as asks from './asks.mjs';
import * as sentences from './sentences.mjs';

// Exercise the shipped view's real callbacks with a tiny GPUI description recorder.
// Native layout/paint is checked separately by herdr-app and review screenshots.
function element() {
  const node = { childNodes: [], values: {}, click: null };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') target.childNodes.push(args[0]);
      else if (key === 'children') target.childNodes.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](proxy); }
      else if (key === 'on_click') target.click = args[0];
      else target.values[key] = args[0];
      return proxy;
    };
  } });
  return proxy;
}

function find(node, id) {
  if (!node || typeof node === 'string') return null;
  if (node.values.id === id) return node;
  for (const child of node.childNodes) { const found = find(child, id); if (found) return found; }
  return null;
}

function harness(storage = new Map(), execute = async () => ({ code: 1 }), userHome = 'C:/Users/example') {
  const calls = [];
  const sharedState = new Map();
  const InputState = { new: options => ({ text: options?.value || '', value() { return this.text; }, set_value(text) { this.text = text; }, on() {} }) };
  const names = ['CACHE_MS', 'projectHerd', 'withPromptStates', 'stateHistory', 'duration', 'promptCandidates', 'currentPrompts', 'detectPrompt', 'screenText', 'pathKey', 'canReadScreen',
    'INFO_TTL', 'personalFolder', 'artifactSource', 'acceptInfo', 'acceptArtifact', 'fitArtifact', 'configChanges', 'seatsExecutable', 'ASK_TTL', 'parseAsks', 'questionExcerpt', 'askGroups', 'answerCommand', 'acceptedAnswer', 'askImages',
    'SCREEN_READ_LIMIT', 'canReadCodexQuote', 'detectCodexQuote', 'quoteState', 'recentReadTimes', 'screenCandidates', 'screenIdentity'];
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class Herd', 'return class Herd');
  const Herd = new Function('View', 'div', 'image', 'svg', 'v_flex', 'h_flex', 'Input', 'InputState', 'run', 'theme', 'shared', 'setShared', 'home', 'localStorage', 'props', 'exec', 'appHome', 'openOverlay', 'window', 'hc', ...names, source)(
    class {}, element, element, element, element, element,
    { new: element }, InputState,
    (...args) => calls.push(args), () => new Proxy({}, { get: (_, key) => String(key) }), key => sharedState.get(key), (key, value) => sharedState.set(key, value), () => userHome,
    { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) ?? null },
    () => ({}), execute, () => 'C:/Users/example/.config/herdr-app', value => calls.push(['overlay', value]),
    () => ({ platform: 'linux' }),
    args => execute('hc', args),
    ...names.map(name => ({ ...model, ...artifacts, ...asks, ...sentences })[name]),
  );
  const view = new Herd();
  const seat = { address: 't1', pane: 'p1', name: 'Sample', role: 'maker', status: 'idle', cwd: userHome + '/Project/sample', institution: 'sample' };
  view.snapshot = () => [{ key: 'sample', name: 'Sample institution', workspace: 'sample', status: 'idle', quiet: true, seats: [seat] }];
  view.history = {};
  view.personalView = true;
  view.width = 340;
  view.lastCheck = Date.now();
  view.answerStates = {}; view.askInputs = {}; view.evidence = {};
  view.cache = { t1: { checked: Date.now(), cwd: model.pathKey(seat.cwd), prompt: { id: 'claude-trust', title: 'Folder trust', key: 'Enter', quote: 'Do you trust the files in this folder?' } } };
  return { view, seat, calls, storage, sharedState };
}

test('quiet seats remain visible, dimmed and clickable; rendering sends no terminal actions', () => {
  const { view, calls } = harness();
  const row = find(view.render(), 'herd-seat-t1');
  assert.ok(row);
  assert.ok(row.values.opacity > 0 && row.values.opacity < 1);
  assert.deepEqual(calls, []);
  row.click();
  assert.deepEqual(calls, [['pane.focus', { pane: 'p1' }]]);
});

test('a prompt row focuses the terminal without confirming or sending keys', () => {
  const { view, calls } = harness();
  const row = find(view.render(), 'herd-prompt-t1');
  assert.ok(row);
  row.click();
  assert.deepEqual(calls, [['pane.focus', { pane: 'p1' }]]);
});

test('a seat without a pane peeks, and compact mode still includes quiet seats', () => {
  const { view, seat, calls } = harness();
  seat.pane = null;
  view.width = 100;
  const row = find(view.render(), 'herd-seat-t1');
  assert.ok(row);
  row.click();
  assert.deepEqual(calls, [['terminal.peek', { terminal: 't1' }]]);
});

test('observed history persists outside render and survives a fresh view reload', () => {
  const first = harness();
  first.view.render();
  assert.equal(first.storage.size, 0, 'render does not write storage');
  const observedAt = first.view.history.t1.at;
  first.view.saveHistory();
  assert.ok(first.storage.has('herd.states'));
  const reloaded = harness(first.storage).view;
  reloaded.scan = () => {};
  reloaded.init({}, { spawn() {}, timer: { every() {} } });
  reloaded.render();
  assert.equal(reloaded.history.t1.at, observedAt);
});

test('artifact clicks open a local preview and never change terminal focus', () => {
  const { view, calls, seat } = harness();
  view.artifacts = { sample: { status: 'ready', image: 'herd-cache/' + 'a'.repeat(64) + '.png', width: 320, height: 200, commit: 'b'.repeat(40), path: 'approved/sheet.png' } };
  view.infos = { sample: { cwd: seat.cwd } };
  const image = find(view.render(), 'herd-artifact-sample');
  assert.ok(image);
  image.click({}, { stop_propagation() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'overlay');
  assert.equal(calls[0][1].props.artifactPreview.image, view.artifacts.sample.image);
  seat.cwd = 'C:/Users/example/Work/sample';
  assert.equal(find(view.render(), 'herd-artifact-sample'), null, 'moving into Work drops the cached artifact immediately');
});

test('metadata refresh makes no calls for a Work institution', async () => {
  const commands = [];
  const { view, seat } = harness(new Map(), async (...args) => { commands.push(args); return { code: 1 }; });
  seat.cwd = 'C:/Users/example/Work/sample';
  view.snapshot = () => [{ key: 'sample', workspace: 'sample', seats: [seat] }];
  view.infos = {};
  view.artifacts = {};
  let task;
  view.refreshMetadata({ spawn: body => { task = body({ notify() {} }); } });
  await task;
  assert.deepEqual(commands, []);
  assert.deepEqual(view.artifacts, {});
});

test('asks refresh invokes only the aggregate reader, and ask clicks open details without answering', async () => {
  const commands = [];
  const ask = { id: 'sample:20261108T120000Z-abc', from: 'sample/guide', to: 'al', state: 'open', question: 'Which build?', opened_at: '2026-11-08T12:00:00Z' };
  const { view, seat, calls } = harness(new Map(), async (...args) => { commands.push(args); return { code: 0, stdout: JSON.stringify([ask]) }; });
  view.snapshot = () => [{ key: 'sample', workspace: 'sample', seats: [seat] }];
  let task;
  view.refreshAsks({ spawn: body => { task = body({ notify() {} }); } });
  await task;
  assert.deepEqual(commands[0].slice(0, 2), ['seats', ['--project', seat.cwd, 'asks', '--to', 'al', '--all', '--open', '--json']]);
  assert.equal(view.asks.length, 1);
  find(view.render(), 'herd-ask-' + ask.id).click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'overlay');
  assert.equal(calls[0][1].props.askList[0].id, ask.id);
  assert.equal(commands.length, 1);
});

test('a failed asks refresh retains the last list and marks it stale', async () => {
  const { view, seat } = harness();
  view.snapshot = () => [{ key: 'sample', workspace: 'sample', seats: [seat] }];
  view.asks = [{ id: 'sample:old', question: 'Known open ask' }];
  let task;
  view.refreshAsks({ spawn: body => { task = body({ notify() {} }); } });
  await task;
  assert.equal(view.asks[0].id, 'sample:old');
  assert.equal(view.asksError, true);
});

test('a non-personal space suppresses all readers even with a personal pinned liaison', async () => {
  const commands = [];
  const { view, seat } = harness(new Map(), async (...args) => { commands.push(args); return { code: 1 }; });
  seat.pinned = true;
  seat.role = 'liaison';
  Object.assign(seat, { app: 'codex', space: 's1', status: 'working' });
  view.viewSpace = 's1';
  view.personalView = false;
  view.cache = {};
  view.infos = {};
  view.artifacts = {};
  const tasks = [];
  const cx = { notify() {}, spawn: body => { const task = body(cx); tasks.push(task); return task; } };
  view.scan(cx);
  view.refreshMetadata(cx);
  view.refreshAsks(cx);
  await Promise.all(tasks);
  assert.deepEqual(commands, []);
  assert.equal(find(view.render(), 'herd-all-asks'), null);
});

test('render schedules no tasks or timers when the selected space changes', () => {
  const { view, calls } = harness();
  const forbidden = () => assert.fail('render must remain free of task and timer creation');
  const cx = { spawn: forbidden, timer: { after: forbidden, every: forbidden } };
  view.viewSpace = 's1';
  view.render(cx);
  view.viewSpace = 's2';
  view.render(cx);
  assert.deepEqual(calls, []);
});

test('switching to a non-personal space during a preview stops the remaining metadata queue', async () => {
  const commands = [];
  const { view, seat } = harness(new Map(), async (command) => {
    commands.push(command);
    if (command === 'node') {
      view.personalView = false;
      return { code: 1 };
    }
    return { code: 0, stdout: JSON.stringify({ schema_version: 1, workspace: 'sample', project: seat.cwd,
      config_dir: seat.cwd + '/.claude/seats', artifact_state: 'ready', artifact: 'approved/*.png' }) };
  });
  view.snapshot = () => ['sample', 'second'].map(key => ({ key, workspace: key, seats: [seat] }));
  view.infos = {};
  view.artifacts = {};
  let task;
  const cx = { notify() {}, spawn: body => { task = body(cx); } };
  view.refreshMetadata(cx);
  await task;
  assert.deepEqual(commands, ['seats', 'node']);
});

test('prompts and working Codex quotes share four attempts per read window, including refresh requests', async () => {
  const commands = [];
  const quote = 'I am checking the preview.';
  const { view, storage } = harness(new Map(), async (...args) => {
    commands.push(args);
    if (commands.length === 1) return { code: 1, stdout: 'fixture failure that must not be retained' };
    return { code: 0, stdout: JSON.stringify({ text: `• ${quote}\n\n• Ran a command\n  └ fixture tool body that must not be retained` }) };
  });
  const seats = Array.from({ length: 6 }, (_, i) => ({ address: 't' + (i + 1), pane: 'p' + (i + 1), space: 's1', name: 'Fixture', role: 'maker',
    app: i === 0 ? 'claude' : 'codex', status: i < 2 ? 'idle' : 'working', cwd: 'C:/Users/example/Project/sample' }));
  view.viewSpace = 's1'; view.cache = {}; view.readTimes = [];
  view.snapshot = () => [{ key: 'sample', name: 'Sample', workspace: 'sample', status: 'working', seats }];
  let task;
  const cx = { notify() {}, spawn: body => { task = body(cx); } };
  view.scan(cx); await task;
  assert.equal(commands.length, 4);
  assert.equal(new Set(commands.map(command => command[1][1])).size, 4, 'a quiet Codex pane is read once for both routes');
  view.scan(cx); await task;
  assert.equal(commands.length, 4, 'refresh cannot bypass the time window');
  view.readTimes = view.readTimes.map(time => time - sentences.SCREEN_READ_WINDOW - 1);
  view.scan(cx); await task;
  assert.equal(commands.length, 6, 'the next budget serves unchecked panes while cached checks are reused');
  assert.ok(commands.every(command => command[0] === 'hc' && command[1][0] === 'read'));
  assert.ok(!JSON.stringify(view.cache).includes('fixture tool body'), 'raw terminal text is not cached');
  assert.ok(!JSON.stringify(view.cache).includes('fixture failure'), 'failed screen text is not cached either');
  const row = find(view.render(), 'herd-quote-t3');
  assert.equal(row.childNodes[0], quote);
  view.saveHistory();
  assert.ok(![...storage.values()].some(value => value.includes(quote)), 'quotes never enter persisted state');
});

test('an expired quote is removed from the row and its tooltip without scheduling a read during render', () => {
  const { view, seat, calls } = harness();
  Object.assign(seat, { app: 'codex', status: 'working', space: 's1' }); view.viewSpace = 's1';
  view.cache = { t1: { checked: Date.now() - model.CACHE_MS - 1, cwd: model.pathKey(seat.cwd), app: sentences.screenIdentity(seat),
    pane: seat.pane, space: seat.space, quote: { text: 'I am checking the expired fixture.' }, error: false } };
  const tree = view.render({ spawn() { assert.fail('render cannot start a read'); }, timer: { after() { assert.fail('render cannot start a timer'); } } });
  assert.equal(find(tree, 'herd-quote-t1'), null);
  assert.match(find(tree, 'herd-seat-t1').values.tooltip, /Screen quote expired/);
  assert.ok(!find(tree, 'herd-seat-t1').values.tooltip.includes('expired fixture'));
  assert.deepEqual(calls, []);
});

test('clicking any teaser opens every ask, grouped by institution, rather than a one-item inbox', () => {
  const { view, calls } = harness();
  view.asks = Array.from({ length: 14 }, (_, i) => ({ id: `${i < 7 ? 'studio' : i < 11 ? 'game' : i === 11 ? 'wiki' : 'sample'}:item${i}`,
    from: 'sample/guide', to: 'al', state: 'open', question: `Question ${i}?`, opened_at: '2026-11-08T12:00:00Z' }));
  find(view.render(), 'herd-ask-studio:item0').click();
  assert.equal(calls[0][1].props.askList.length, 14, 'the old callback passed [ask] and displayed 1');
  assert.deepEqual(asks.askGroups(calls[0][1].props.askList).map(g => [g.owner, g.asks.length]), [['game', 4], ['sample', 2], ['studio', 7], ['wiki', 1]]);
  view.askList = view.asks;
  const detail = view.render();
  for (const ask of view.asks) assert.ok(find(detail, 'herd-ask-' + ask.id));
});

test('answers write a scratch ledger with exact text once, then require the matching receipt before sent', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'herd-answer-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const userHome = root.replace(/\\/g, '/') + '/home', owner = userHome + '/Project/sample';
  mkdirSync(owner, { recursive: true });
  const stub = path.join(root, 'seats-stub.cjs'), ledger = path.join(owner, 'asks.jsonl');
  writeFileSync(stub, `const fs=require('node:fs');const a=process.argv.slice(2);if(a[0]!=='--project'||a[2]!=='answer'||a[3]!=='--from'||a[4]!=='al'||a[5]!=='--')process.exit(3);const event={id:a[6],answer:a[7]};fs.appendFileSync('asks.jsonl',JSON.stringify(event)+'\\n');setTimeout(()=>console.log(event.id),30);`, 'utf8');
  const commands = [], run = promisify(execFile);
  const { view, calls, sharedState } = harness(new Map(), async (command, args, options) => {
    commands.push({ command, args, options });
    assert.equal(command, 'node');
    const request = JSON.parse(args[1]);
    const invocation = asks.answerCommand({ id: request.id, to: 'al', state: 'open', owner_project: request.project }, request.answer, request.home);
    const result = await run(process.execPath, [stub, ...invocation.args], { cwd: options.cwd, encoding: 'utf8', windowsHide: true });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  }, userHome);
  const ask = { id: 'sample:fixture', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose?', owner_project: owner };
  view.askList = [ask]; view.prepareAskInputs();
  const note = '-free "text"; $(not-a-command) `literal`\nsecond line';
  view.askInputs[ask.id].set_value(note);
  const tasks = [], cx = { notify() {}, spawn(body) { tasks.push(body(cx)); } };
  view.answerAsk(ask, 'Option A', cx);
  view.answerAsk(ask, 'Option A', cx);
  assert.equal(view.answerStates[ask.id].sending, true);
  assert.equal(commands.length, 1);
  await Promise.all(tasks);
  assert.deepEqual(JSON.parse(readFileSync(ledger, 'utf8').trim()), { id: ask.id, answer: 'Option A\n\n' + note });
  assert.equal(commands[0].options.cwd, owner);
  assert.equal(view.answerStates[ask.id].sent, ask.from);
  assert.equal(view.visibleAsks([ask]).length, 0);
  assert.equal(sharedState.get('herd.askOutcomes')[ask.id], ask.from);
  assert.deepEqual(calls, [], 'the receipt updates shared visibility without a command that dismisses the dialog');
  view.answerAsk(ask, 'Option A', cx);
  assert.equal(commands.length, 1);
});

test('failed, timed-out and mismatched answer receipts stay visible; Work makes no write', async () => {
  for (const result of [{ code: 1, stderr: 'Ledger busy' }, { code: 0, stdout: 'sample:other' }, new Error('Timed out')]) {
    const { view } = harness(new Map(), async () => { if (result instanceof Error) throw result; return result; });
    const ask = { id: 'sample:fixture', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose?', owner_project: 'C:/Users/example/Project/sample' };
    view.askList = [ask]; view.prepareAskInputs(); view.askInputs[ask.id].set_value('Answer');
    let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
    view.answerAsk(ask, null, cx); await task;
    assert.ok(view.answerStates[ask.id].error);
    assert.equal(view.answerStates[ask.id].sent, undefined);
    assert.equal(view.visibleAsks([ask]).length, 1);
    view.personalView = false;
    view.answerAsk(ask, 'Option A', { notify() {}, spawn() { assert.fail('Work cannot write'); } });
    ask.owner_project = 'C:/Users/example/Work/sample'; view.personalView = true;
    view.answerAsk(ask, 'Option A', { notify() {}, spawn() { assert.fail('Work owner cannot write'); } });
  }
});

test('a missing owner disables answers, and Work starts no evidence reads', async () => {
  const { view, calls } = harness(new Map(), async () => assert.fail('no reader should run'));
  const ask = { id: 'sample:fixture', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose docs/sheet.png?', options: ['A'] };
  view.askList = [ask]; view.prepareAskInputs();
  const tree = view.render();
  assert.ok(find(tree, 'herd-ask-' + ask.id));
  const button = find(tree, 'herd-answer-option-' + ask.id + '-0');
  assert.equal(button.values.opacity, 0.45);
  button.click({}, { spawn() { assert.fail('unknown owner cannot send'); } });
  assert.deepEqual(calls, []);
  ask.owner_project = 'C:/Users/example/Work/sample';
  let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
  view.loadEvidence(cx); await task;
  view.personalView = false;
  ask.owner_project = 'C:/Users/example/Project/sample';
  view.loadEvidence(cx); await task;
  assert.deepEqual(view.evidence, {});
});

test('a screen moved to Work while its read was in flight never becomes a quote', async () => {
  const { view, seat } = harness(new Map(), async () => {
    seat.cwd = 'C:/Users/example/Work/sample';
    return { code: 0, stdout: JSON.stringify({ text: '• I am checking the preview.' }) };
  });
  Object.assign(seat, { app: 'codex', space: 's1', status: 'working' });
  view.viewSpace = 's1'; view.cache = {};
  view.snapshot = () => [{ key: 'sample', name: 'Sample', seats: [{ ...seat }] }];
  let task;
  const cx = { notify() {}, spawn: body => { task = body(cx); } };
  view.scan(cx); await task;
  assert.deepEqual(view.cache, {});
  assert.equal(find(view.render(), 'herd-quote-t1'), null);
});
