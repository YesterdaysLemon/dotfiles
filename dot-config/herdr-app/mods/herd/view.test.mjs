import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from './model.mjs';

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
    ...names.map(name => ({ ...model })[name]),
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
  await Promise.all(tasks);
  assert.deepEqual(commands, []);
  assert.equal(find(view.render(), 'herd-refresh'), null);
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
