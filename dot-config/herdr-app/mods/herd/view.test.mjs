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
import * as facts from './facts.mjs';
import * as grid from './grid.mjs';
import * as askText from './ask-text.mjs';

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

function harness(storage = new Map(), execute = async () => ({ code: 1 }), userHome = 'C:/Users/example', viewProps = {}, appSettings = {}) {
  const calls = [];
  const sharedState = new Map();
  const native = { panes: [{ pane: 'p1', terminal: 't1', tab: 'tab', zoomed: false }],
    spaces: [{ id: 's1', name: 'First', folder: userHome + '/Project/sample', machine: null, tabs: [{ id: 'tab' }] }],
    focus: { space: 's1', tab: 'tab', pane: 'p1' } };
  const InputState = { new: options => ({ text: options?.value || '', value() { return this.text; }, set_value(text) { this.text = text; }, on() {} }) };
  const names = ['CACHE_MS', 'projectHerd', 'withPromptStates', 'stateHistory', 'duration', 'promptCandidates', 'currentPrompts', 'detectPrompt', 'screenText', 'pathKey', 'canReadScreen',
    'INFO_TTL', 'personalFolder', 'artifactSource', 'acceptInfo', 'acceptArtifact', 'fitArtifact', 'configChanges', 'seatsExecutable', 'ASK_TTL', 'parseAsks', 'questionExcerpt', 'askGroups', 'askerProfile', 'answerCommand', 'acceptedAnswer', 'askImages', 'scriptSpace',
    'SCREEN_READ_LIMIT', 'canReadCodexQuote', 'detectCodexQuote', 'quoteState', 'recentReadTimes', 'screenCandidates', 'screenIdentity', 'questionBlocks',
    'publishFacts', 'consumeFacts', 'forgetFacts', 'validateGrid', 'boundGrid', 'gridTarget', 'gridSeats', 'restoreGridPlan', 'gridApi'];
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class Herd', 'return class Herd');
  const Herd = new Function('View', 'div', 'image', 'svg', 'v_flex', 'h_flex', 'Input', 'InputState', 'run', 'theme', 'shared', 'setShared', 'home', 'localStorage', 'props', 'exec', 'appHome', 'openOverlay', 'closeOverlay', 'window', 'settings', 'hc', 'panes', 'spaces', 'focused', ...names, source)(
    class {}, element, element, element, element, element,
    { new: element }, InputState,
    (...args) => calls.push(args), () => new Proxy({}, { get: (_, key) => String(key) }), key => sharedState.get(key), (key, value) => sharedState.set(key, value), () => userHome,
    { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) ?? null },
    () => viewProps, execute, () => 'C:/Users/example/.config/herdr-app', value => calls.push(['overlay', value]), id => calls.push(['closeOverlay', id]),
    () => ({ platform: 'linux' }),
    () => appSettings,
    args => execute('hc', args),
    () => native.panes, () => native.spaces, () => native.focus,
    ...names.map(name => ({ ...model, ...artifacts, ...asks, ...sentences, ...facts, ...grid, ...askText })[name]),
  );
  const view = new Herd();
  const seat = { address: 't1', pane: 'p1', space: 's1', name: 'Sample', role: 'maker', status: 'idle', cwd: userHome + '/Project/sample', institution: 'sample' };
  view.snapshot = () => [{ key: 'sample', name: 'Sample institution', workspace: 'sample', status: 'idle', quiet: true, seats: [seat] }];
  view.history = {};
  view.personalView = true;
  view.width = 340;
  view.lastCheck = Date.now();
  view.answerStates = {}; view.askInputs = {}; view.evidence = {}; view.scriptStates = {};
  view.livePanes = native.panes; view.liveSpaces = native.spaces; view.liveFocus = native.focus;
  view.cache = { t1: { checked: Date.now(), cwd: model.pathKey(seat.cwd), prompt: { id: 'claude-trust', title: 'Folder trust', key: 'Enter', quote: 'Do you trust the files in this folder?' } } };
  return { view, seat, calls, storage, sharedState, native };
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
  reloaded.init({}, { notify() {}, spawn() {}, timer: { every() {} } });
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
  view.refreshAsks({ notify() {}, spawn: body => { task = body({ notify() {} }); } });
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
  view.refreshAsks({ notify() {}, spawn: body => { task = body({ notify() {} }); } });
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
  assert.equal(sharedState.get('herd.askOutcomes')[ask.id].from, ask.from);
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

test('a timeout or error after append confirms the exact answer and shows sent without another write', async () => {
  for (const failure of [new Error('Timed out'), { code: 1, stderr: 'Notification failed' }, { code: 0, stdout: '' }]) {
    const commands = [];
    const { view, sharedState } = harness(new Map(), async (command, args, options) => {
      const request = JSON.parse(args[1]); commands.push({ request, options });
      if (request.mode === 'confirm') return { code: 0, stdout: '{"state":"sent"}' };
      if (failure instanceof Error) throw failure;
      return failure;
    });
    const ask = { id: 'sample:fixture', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose?', owner_project: 'C:/Users/example/Project/sample' };
    view.askList = [ask]; view.prepareAskInputs(); view.askInputs[ask.id].set_value('Exact note');
    let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
    view.answerAsk(ask, 'A', cx); await task;
    assert.equal(commands.length, 2);
    assert.equal(commands[0].request.answer, 'A\n\nExact note');
    assert.deepEqual(commands[1].request, { ...commands[0].request, mode: 'confirm' });
    assert.equal(commands[1].options.cwd, ask.owner_project);
    assert.equal(view.answerStates[ask.id].sent, ask.from);
    assert.equal(sharedState.get('herd.askOutcomes')[ask.id].from, ask.from);
    view.answerAsk(ask, 'A', cx);
    assert.equal(commands.length, 2, 'a confirmed answer cannot be sent twice');
  }
});

test('unavailable delivery checks retain submitted text; Check delivery only reads, and open/closed outcomes stay distinct', async () => {
  const commands = []; let state = null;
  const { view } = harness(new Map(), async (_command, args) => {
    const request = JSON.parse(args[1]); commands.push(request);
    return request.mode === 'confirm' && state ? { code: 0, stdout: JSON.stringify({ state }) } : { code: 1 };
  });
  const ask = { id: 'sample:fixture', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose?', owner_project: 'C:/Users/example/Project/sample' };
  view.askList = [ask]; view.prepareAskInputs(); view.askInputs[ask.id].set_value('Original answer');
  let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
  view.answerAsk(ask, null, cx); await task;
  assert.equal(view.answerStates[ask.id].unconfirmed, 'Original answer');
  assert.equal(find(view.render(), 'herd-answer-send-' + ask.id).childNodes[0], 'Check delivery');
  assert.equal(find(view.render(), 'herd-answer-input-' + ask.id).values.disabled, true);
  view.askInputs[ask.id].set_value('Changed draft');
  state = 'closed'; view.answerAsk(ask, null, cx); await task;
  assert.equal(commands.length, 3); assert.equal(commands[2].mode, 'confirm');
  assert.equal(commands[2].answer, 'Original answer');
  assert.equal(view.answerStates[ask.id].closed, true);
  view.answerStates[ask.id] = { unconfirmed: 'Original answer' };
  state = 'open'; view.answerAsk(ask, null, cx); await task;
  assert.equal(view.answerStates[ask.id].unconfirmed, undefined);
  assert.match(view.answerStates[ask.id].error, /still shows this ask open/);
});

test('a slow inbox refresh shows checking with a generous timeout and keeps the last list until completion', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const commands = [];
  const { view } = harness(new Map(), async (...args) => { commands.push(args); return pending; });
  const ask = { id: 'sample:old', from: 'sample/guide', to: 'al', state: 'open', question: 'Known open ask', opened_at: '2026-11-08T12:00:00Z' };
  view.askList = [ask]; view.askSource = 'C:/Users/example/Project/sample'; view.asksError = true;
  let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
  view.refreshAsks(cx);
  assert.equal(view.asksBusy, true); assert.equal(view.asksError, false);
  assert.equal(commands[0][2].timeout, 120000);
  assert.equal(view.askList[0].id, ask.id);
  assert.equal(find(view.render(), 'herd-refresh-asks').childNodes[0], 'Checking…');
  resolve({ code: 0, stdout: '[]' }); await task;
  assert.equal(view.asksBusy, false); assert.equal(view.asksError, false);
  assert.deepEqual(view.askList, []);
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

test('a grid copy starts no readers and consumes the sidebar quote without persisting it', () => {
  const record = { institution: 'sample', space: 's1', tab: 'tab', focusPane: 'p1', zoomPane: null, token: 'fixture' };
  const { view, seat, native, calls, storage, sharedState } = harness(new Map(), async () => assert.fail('a grid cannot execute readers'), 'C:/Users/example', { grid: record });
  native.panes.push({ pane: 'pg', tab: 'tab', mod: 'herd', zoomed: false });
  sharedState.set('herd.gridPanes', { tab: { ...record, pane: 'pg' } });
  const timers = [];
  view.init({}, { spawn() { assert.fail('grid init cannot start reader tasks'); }, timer: { every(ms) { timers.push(ms); } } });
  assert.deepEqual(timers, [30000]);
  assert.deepEqual(calls, []);
  calls.length = 0;
  Object.assign(seat, { app: 'codex', status: 'working', avatar: 'avatars/sample/current.png' });
  const owner = {}, now = Date.now();
  facts.publishFacts(owner, { t1: { checked: now, cwd: model.pathKey(seat.cwd), app: model.screenIdentity(seat), pane: seat.pane, space: seat.space,
    quote: { text: 'I am checking the shared preview.' } } }, { t1: { status: seat.status, at: now - 60000 } }, now);
  const tree = view.render();
  assert.ok(find(tree, 'herd-grid-face-t1'));
  assert.equal(find(tree, 'herd-grid-sentence-t1').childNodes[0], 'I am checking the shared preview.');
  assert.deepEqual(calls, []);
  view.saveHistory();
  assert.ok(![...storage.values()].some(value => value.includes('shared preview')));
  view.personalView = false;
  const work = view.render();
  assert.equal(find(work, 'herd-grid-face-t1'), null);
  assert.equal(find(work, 'herd-grid-sentence-t1'), null);
  assert.deepEqual(view.cache, {});
  facts.forgetFacts(owner);
});

test('opening a grid guards rapid clicks and creates only a new owned mod pane', async () => {
  let resolve;
  const commands = [];
  const { view, seat, sharedState } = harness(new Map(), async (...args) => {
    commands.push(args); return new Promise(done => { resolve = done; });
  });
  const group = { key: 'sample', seats: [seat] };
  let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
  view.openGrid(group, cx); view.openGrid(group, cx);
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'herdr-app');
  const request = JSON.parse(commands[0][1][2]);
  assert.equal(request.mod, 'herd'); assert.equal(request.pane, 'p1');
  assert.equal(request.props.grid.institution, 'sample');
  resolve({ code: 0, stdout: '{"pane":"pg"}' }); await task;
  assert.equal(sharedState.get('herd.gridPanes').tab.pane, 'pg');
  assert.equal(view.gridBusy, false);
});

test('restored sidebar state times are available to a new grid before the first reader finishes', () => {
  const at = Date.now() - 60000;
  const { view, seat } = harness(new Map([['herd.states', JSON.stringify({ t1: { status: 'idle', at } })]]));
  view.scan = () => {}; view.refreshMetadata = () => {}; view.refreshAsks = () => {};
  view.init({}, { spawn() {}, timer: { every() {} } });
  assert.equal(facts.consumeFacts([seat], Date.now()).history.t1.at, at);
  view.close();
});

test('return awaits zoom and focus, then closes only the grid as its last host action', async () => {
  const commands = [];
  const { view, native, calls } = harness(new Map(), async (...args) => { commands.push(args); return { code: 0, stdout: '{"ok":true}' }; });
  native.panes.push({ pane: 'pg', mod: 'herd', tab: 'tab', zoomed: true });
  const record = { institution: 'sample', space: 's1', tab: 'tab', pane: 'pg', focusPane: 'p1', zoomPane: null };
  let task;
  const cx = { notify() { assert.ok(!calls.some(call => call[0] === 'pane.close'), 'no cx use after closing'); }, spawn(body) { task = body(cx); } };
  view.returnGrid(record, cx); await task;
  assert.deepEqual(commands.map(command => command[1][1]), ['pane.zoom', 'pane.focus']);
  assert.deepEqual(calls, [['pane.close', { pane: 'pg' }]]);
});

test('a tile defaults to focus in the preserved terminal split and closes only its grid', async () => {
  const record = { institution: 'sample', space: 's1', tab: 'tab', pane: 'pg', focusPane: 'p1', zoomPane: null, token: 'fixture' };
  const commands = [];
  const { view, seat, native, sharedState, calls } = harness(new Map(), async (...args) => {
    commands.push(args); return { code: 0, stdout: '{"ok":true}' };
  }, 'C:/Users/example', { grid: record });
  native.panes.push({ pane: 'pg', mod: 'herd', tab: 'tab', zoomed: true });
  sharedState.set('herd.gridPanes', { tab: record });
  let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
  view.openGridSeat(seat, cx); await task;
  assert.deepEqual(commands.map(call => [call[1][1], JSON.parse(call[1][2])]), [['pane.zoom', { pane: 'pg' }], ['pane.focus', { pane: 'p1' }]]);
  assert.deepEqual(calls, [['pane.close', { pane: 'pg' }]]);
});

test('the fallback handoff receives only validated owned grids and preserves current terminal focus', async () => {
  const commands = [];
  const { view, native, sharedState, calls } = harness(new Map(), async (...args) => { commands.push(args); return { code: 0 }; });
  native.panes.push({ pane: 'pg', mod: 'herd', tab: 'tab', zoomed: false });
  const record = { institution: 'sample', space: 's1', tab: 'tab', pane: 'pg', focusPane: 'p1', zoomPane: null, token: 'fixture' };
  sharedState.set('herd.gridPanes', { tab: record, forged: { ...record, pane: 'p1' } });
  sharedState.set('layout', 'herd'); // Native close still sees the layout it is leaving.
  view.factOwner = {};
  await view.close();
  assert.equal(commands.length, 1); assert.equal(commands[0][0], 'node');
  assert.ok(commands[0][1][0].endsWith('/grid-exit.mjs'));
  assert.deepEqual(JSON.parse(commands[0][1][1]), { panes: ['pg'], focus: null, zooms: [] });
  assert.deepEqual(calls, []);
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


test('Open terminal checks the script before launching one ID-labelled tab in a personal space', async () => {
  const commands = [], owner = 'C:/Users/example/Project/sample';
  const { view, seat } = harness(new Map(), async (command, args) => {
    commands.push({ command, args });
    if (command === 'node') return { code: 0, stdout: JSON.stringify({ project: owner, commit: 'a'.repeat(40), digest: 'b'.repeat(64), token: 'fixture_encoded_request' }) };
    return { code: 0, stdout: '{"tab":"new-tab","terminal":"fixture"}' };
  });
  seat.space = 'personal'; view.viewSpace = 'personal';
  view.askerGroups = [{ key: 'sample', workspace: 'sample', seats: [seat] }];
  view.allSpaces = [{ id: 'personal', folder: owner }, { id: 'work', folder: 'C:/Users/example/Work/example' }];
  const ask = { id: 'sample:run', from: 'sample/guide', to: 'al', state: 'open', question: 'Run this?', owner_project: owner, run: 'tools/setup.ps1' };
  view.askList = [ask];
  let task, cooldown; const cx = { notify() {}, spawn(body) { task = body(cx); }, timer: { after(ms, body) { assert.equal(ms, 1500); cooldown = body; } } };
  const button = find(view.render(), 'herd-run-' + ask.id);
  button.click({}, cx); button.click({}, cx);
  assert.equal(commands.length, 1, 'rapid clicks cannot start another validation or tab');
  await task;
  assert.equal(commands.length, 2);
  assert.equal(commands[0].args[1], 'check');
  const tab = JSON.parse(commands[1].args[2]);
  assert.deepEqual([commands[1].command, ...commands[1].args.slice(0, 2)], ['herdr-app', 'do', 'tab.new']);
  assert.equal(tab.space, 'personal'); assert.equal(tab.name, ask.id); assert.equal(tab.folder, owner);
  assert.equal(tab.argv[0], 'node'); assert.equal(tab.argv[2], 'launch');
  assert.equal(tab.argv[3], 'fixture_encoded_request');
  assert.equal(view.scriptStates[ask.id].opened, true);
  view.openAskTerminal(ask, cx);
  assert.equal(commands.length, 2, 'the short cooldown still refuses a duplicate');
  cooldown(cx);
  assert.equal(find(view.render(), 'herd-run-' + ask.id).childNodes[0], 'Reopen terminal');
  view.openAskTerminal(ask, cx); await task;
  assert.equal(commands.length, 4, 'an intentional reopen validates again and opens another tab');
});

test('a changed script or a space that becomes Work cannot open a terminal', async () => {
  for (const changed of [true, false]) {
    const commands = [];
    const { view } = harness(new Map(), async (...args) => {
      commands.push(args);
      if (!changed) view.personalView = false;
      return changed ? { code: 1, stderr: 'The script differs from HEAD.' } : { code: 0, stdout: JSON.stringify({ project: 'C:/Users/example/Project/sample', commit: 'a'.repeat(40), digest: 'b'.repeat(64), token: 'fixture_encoded_request' }) };
    });
    const ask = { id: 'sample:run', owner_project: 'C:/Users/example/Project/sample', run: 'tools/setup.ps1' };
    let task; const cx = { notify() {}, spawn(body) { task = body(cx); } };
    view.openAskTerminal(ask, cx); await task;
    assert.equal(commands.length, 1); assert.ok(view.scriptStates[ask.id].error);
  }
});


test('Work-to-Project scope change starts the full inbox immediately, without a render-side task or minute wait', async () => {
  const commands = [];
  const asks = Array.from({ length: 9 }, (_, i) => ({ id:'sample:scope'+i, from:'sample/guide', to:'al', state:'open', question:'Fixture question?', opened_at:'2026-11-09T06:00:00Z', owner_project:'C:/Users/example/Project/sample' }));
  const {view,seat}=harness(new Map(),async(...args)=>{commands.push(args);return {code:0,stdout:JSON.stringify(asks)};});
  let scope='work';
  view.snapshot=()=>{view.viewSpace=scope;view.personalView=scope!=='work';return [{key:'sample',workspace:'sample',seats:[seat]}];};
  view.scan=()=>{};view.refreshMetadata=()=>{};
  const tasks=[];const cx={notify(){},spawn(body){tasks.push(body(cx));}};
  view.refreshAsks(cx);view.readerSpace='work';assert.equal(commands.length,0);
  scope='project';view.refreshScope(cx);await Promise.all(tasks);
  assert.equal(commands.length,1);assert.equal(view.asks.length,9);assert.equal(view.asksBusy,false);
  view.refreshScope(cx);assert.equal(commands.length,1,'same-space file events do not bypass cache');
  scope='work';view.refreshScope(cx);assert.equal(commands.length,1,'Work transition makes no reader calls');
});

test('a changed personal scope during an inbox read discards that result and immediately serves the new scope', async () => {
  let scope='first',finish;const commands=[];
  const {view,seat}=harness(new Map(),async(...args)=>{commands.push(args);if(commands.length===1)return new Promise(done=>{finish=done;});return {code:0,stdout:'[]'};});
  view.snapshot=()=>{view.viewSpace=scope;view.personalView=true;return [{key:'sample',workspace:'sample',seats:[seat]}];};
  const tasks=[];const cx={notify(){},spawn(body){tasks.push(body(cx));}};
  view.refreshAsks(cx);scope='second';view.snapshot();view.asksChecked=0;
  finish({code:0,stdout:'[]'});await tasks[0];await Promise.all(tasks);
  assert.equal(commands.length,2);assert.equal(view.asksBusy,false);assert.ok(view.asksChecked);
});

test('a personal space without a usable institution reports unavailable instead of endless initial Loading',()=>{
  const {view}=harness();view.snapshot=()=>[];view.personalView=true;
  view.refreshAsks({notify(){},spawn(){assert.fail('no guessed owner or reader');}});
  assert.equal(view.asksError,true);
});


test('fresh open ledger entries clear persisted sent receipts instead of silently hiding open asks',async()=>{
 const ask={id:'sample:reopened',from:'sample/guide',to:'al',state:'open',question:'Fixture?',opened_at:'2026-11-09T06:00:00Z'};
 const {view,sharedState}=harness(new Map(),async()=>({code:0,stdout:JSON.stringify([ask])}));
 sharedState.set('herd.askOutcomes',{[ask.id]:'sample/guide'});view.answerStates[ask.id]={sent:ask.from};
 let task;const cx={notify(){},spawn(body){task=body(cx);}};view.refreshAsks(cx);await task;
 assert.equal(view.visibleAsks().length,1);assert.equal(sharedState.get('herd.askOutcomes')[ask.id],undefined);assert.equal(view.answerStates[ask.id],undefined);
});

test('a stale in-flight read cannot resurrect a newly sent answer',async()=>{
 const ask={id:'sample:race',from:'sample/guide',to:'al',state:'open',question:'Fixture?',opened_at:'2026-11-09T06:00:00Z'};
 let view;const h=harness(new Map(),async()=>{await new Promise(done=>setTimeout(done,3));view.answerSent(ask);return {code:0,stdout:JSON.stringify([ask])};});view=h.view;
 let task;const cx={notify(){},spawn(body){task=body(cx);}};view.refreshAsks(cx);await task;
 assert.equal(view.visibleAsks().length,0);assert.equal(h.sharedState.get('herd.askOutcomes')[ask.id].from,ask.from);
});


const albumImage = (n) => ({status:'ready',image:'herd-cache/'+String(n).repeat(64)+'.png',width:800,height:400,commit:'a'.repeat(40),path:'docs/'+n+'.png'});

test('an ask image opens only that ask\'s validated cached images at the clicked slide; Work cannot open it',()=>{
 const {view,calls}=harness();const ask={id:'sample:album',from:'sample/guide',to:'al',state:'open',question:'Paragraph\n\n- Choice one\n- Choice two\n\ndocs/1.png docs/2.png',owner_project:'C:/Users/example/Project/sample'};
 view.askList=[ask];view.evidence={};for(const n of [1,2])view.evidence[ask.id+'|'+ask.owner_project+'|docs/'+n+'.png']=albumImage(n);
 const image=find(view.render(),'herd-evidence-'+ask.id+'-docs/2.png');image.childNodes[0].click({},{});
 assert.equal(calls[0][0],'overlay');assert.equal(calls[0][1].props.album.length,2);assert.equal(calls[0][1].props.albumAt,1);
 view.personalView=false;view.showAskAlbum(ask,'docs/1.png');assert.equal(calls.length,1);
});

test('album has no readers; arrows, zoom, fit and Escape use the actual view callbacks',()=>{
 const {view,calls}=harness(new Map(),async()=>assert.fail('album has no reader'),'C:/Users/example',{album:[albumImage(1),albumImage(2)],albumAt:0,overlay:'fixture-album'});
 let focus=0;view.init({}, {focus_handle(){return {focus(){focus++;}};},spawn(){assert.fail('album cannot spawn');},timer:{every(){assert.fail('album cannot poll');}}});
 assert.equal(focus,1);const cx={notify(){},stop_propagation(){}};
 find(view.render(),'herd-album-next').click({},cx);assert.equal(view.albumAt,1);
 find(view.render(),'herd-album-in').click({},cx);assert.equal(view.albumZoom,1.5);
 view.render().values.on_key_down({key:'left'},cx);assert.equal(view.albumAt,0);assert.equal(view.albumZoom,1);
 view.render().values.on_key_down({key:'+'},cx);assert.equal(view.albumZoom,1.5);
 find(view.render(),'herd-album-fit').click({},cx);assert.equal(view.albumZoom,1);
 view.render().values.on_key_down({key:'escape'},cx);assert.deepEqual(calls,[['closeOverlay','fixture-album']]);
});

test('opening an album waits for the remaining previews and cancels across a Work transition',async()=>{
 for (const switchToWork of [false,true]) {
  let finish;const {view,calls}=harness(new Map(),()=>new Promise(resolve=>{finish=resolve;}));
  const ask={id:'sample:pending',from:'sample/guide',question:'docs/1.png docs/2.png',owner_project:'C:/Users/example/Project/sample'};
  view.askList=[ask];view.evidence[ask.id+'|'+ask.owner_project+'|docs/1.png']=albumImage(1);
  let task;const cx={notify(){},spawn(body){task=body(cx);}};
  view.showAskAlbum(ask,'docs/1.png',cx);assert.deepEqual(calls,[]);assert.ok(view.pendingAlbum);
  if(switchToWork){view.personalView=false;view.viewSpace='work';view.refreshAsks=()=>{};view.refreshMetadata=()=>{};view.scan=()=>{};view.refreshScope(cx);}
  finish({code:0,stdout:JSON.stringify(albumImage(2))});await task;
  assert.equal(view.pendingAlbum,null);assert.equal(calls.length,switchToWork?0:1);
  if(!switchToWork)assert.equal(calls[0][1].props.album.length,2);
 }
});

test('album fit compensates native size events for app zoom at narrow width',()=>{
 const {view}=harness(new Map(),undefined,undefined,{album:[albumImage(1)]},{zoom:2});
 view.init({}, {focus_handle(){return {focus(){}};}});
 view.render().values.on_size_change({width:500,height:700},{notify(){}});
 const content=find(view.render(),'herd-album-viewport').childNodes[0];
 assert.equal(content.values.w,210);assert.equal(content.childNodes[0].values.w,210);assert.equal(content.childNodes[0].values.h,105);
});
