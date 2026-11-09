import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from './model.mjs';
import * as artifacts from './artifacts.mjs';
import * as asks from './asks.mjs';

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

function harness(storage = new Map(), execute = async () => ({ code: 1 })) {
  const calls = [];
  const names = ['CACHE_MS', 'projectHerd', 'withPromptStates', 'stateHistory', 'duration', 'promptCandidates', 'currentPrompts', 'detectPrompt', 'screenText', 'pathKey', 'canReadScreen',
    'INFO_TTL', 'personalFolder', 'artifactSource', 'acceptInfo', 'acceptArtifact', 'fitArtifact', 'configChanges', 'seatsExecutable', 'ASK_TTL', 'parseAsks', 'questionExcerpt'];
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class Herd', 'return class Herd');
  const Herd = new Function('View', 'div', 'image', 'svg', 'v_flex', 'h_flex', 'run', 'theme', 'shared', 'home', 'localStorage', 'props', 'exec', 'appHome', 'openOverlay', 'window', 'hc', ...names, source)(
    class {}, element, element, element, element, element,
    (...args) => calls.push(args), () => new Proxy({}, { get: (_, key) => String(key) }), () => [], () => 'C:/Users/example',
    { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) ?? null },
    () => ({}), execute, () => 'C:/Users/example/.config/herdr-app', value => calls.push(['overlay', value]),
    () => ({ platform: 'linux' }),
    args => execute('hc', args),
    ...names.map(name => ({ ...model, ...artifacts, ...asks })[name]),
  );
  const view = new Herd();
  const seat = { address: 't1', pane: 'p1', name: 'Sample', role: 'maker', status: 'idle', cwd: 'C:/Users/example/Project/sample', institution: 'sample' };
  view.snapshot = () => [{ key: 'sample', name: 'Sample institution', workspace: 'sample', status: 'idle', quiet: true, seats: [seat] }];
  view.history = {};
  view.personalView = true;
  view.width = 340;
  view.lastCheck = Date.now();
  view.cache = { t1: { checked: Date.now(), cwd: model.pathKey(seat.cwd), prompt: { id: 'claude-trust', title: 'Folder trust', key: 'Enter', quote: 'Do you trust the files in this folder?' } } };
  return { view, seat, calls, storage };
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
  assert.deepEqual(commands[0].slice(0, 2), ['seats', ['--project', seat.cwd, 'asks', '--to', 'al', '--all', '--json']]);
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
