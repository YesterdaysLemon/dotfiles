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

function harness() {
  const calls = [];
  const names = ['RANK', 'CACHE_MS', 'projectHerd', 'stateHistory', 'duration', 'promptCandidates', 'currentPrompts', 'detectPrompt', 'screenText', 'pathKey', 'canReadScreen'];
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class Herd', 'return class Herd');
  const Herd = new Function('View', 'div', 'image', 'svg', 'v_flex', 'h_flex', 'run', 'theme', 'shared', 'home', 'localStorage', ...names, source)(
    class {}, element, element, element, element, element,
    (...args) => calls.push(args), () => new Proxy({}, { get: (_, key) => String(key) }), () => [], () => 'C:/Users/example', { setItem() {} },
    ...names.map(name => model[name]),
  );
  const view = new Herd();
  const seat = { address: 't1', pane: 'p1', name: 'Sample', role: 'maker', status: 'idle', cwd: 'C:/Users/example/Project/sample', institution: 'sample' };
  view.snapshot = () => [{ key: 'sample', name: 'Sample institution', status: 'idle', quiet: true, seats: [seat] }];
  view.history = {};
  view.width = 340;
  view.lastCheck = Date.now();
  view.cache = { t1: { checked: Date.now(), cwd: model.pathKey(seat.cwd), prompt: { id: 'claude-trust', title: 'Folder trust', key: 'Enter', quote: 'Do you trust the files in this folder?' } } };
  return { view, seat, calls };
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
