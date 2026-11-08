import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_MS, pathKey, canReadScreen, safeAvatar, projectHerd, stateHistory, detectPrompt, screenText, promptCandidates, currentPrompts } from './model.mjs';

const userHome = 'C:/Users/example';
const quiet = { address: 't1', role: 'maker', status: 'idle', cwd: userHome + '/Project/sample' };
const trust = 'Do you trust the files in this folder?\n\n❯ 1. Yes, I trust this folder\n  2. No, exit\nEnter to confirm';
const approval = 'Would you like to run the following command?\n\n  echo sample\n\n› 1. Yes, proceed (y)\n  2. No, and tell Codex what to do differently (esc)';

test('screen scope handles Windows, Git Bash and WSL paths and excludes Work even with overrides', () => {
  assert.equal(canReadScreen(quiet, userHome), true);
  for (const cwd of ['C:\\Users\\example\\Project\\sample', '/c/Users/example/Project/sample', '/mnt/c/Users/example/Project/sample']) {
    assert.equal(canReadScreen({ ...quiet, cwd }, userHome), true);
  }
  for (const cwd of [userHome + '/Work/sample', userHome + '/Project/../Work/sample', userHome + '/Project//../Work/sample', userHome + '/Project-other', userHome + '/Projects/sample', '', '/tmp/sample']) {
    assert.equal(canReadScreen({ ...quiet, cwd }, userHome, [userHome + '/Work']), false, cwd);
  }
  assert.equal(canReadScreen({ ...quiet, cwd: '/home/example/project/sample' }, '/home/example'), false);
  assert.equal(canReadScreen({ ...quiet, address: 'remote/t1' }, userHome), false);
  assert.equal(canReadScreen({ ...quiet, status: 'working' }, userHome), false);
  assert.equal(canReadScreen({ ...quiet, role: '' }, userHome), false);
  assert.equal(pathKey('C:/Users/example/Project/./sample'), 'c:/users/example/project/sample');
});

test('avatars stay relative to the app avatar directory', () => {
  assert.equal(safeAvatar('avatars/sample/face.png'), 'avatars/sample/face.png');
  for (const path of ['C:/private/face.png', 'avatars/../private.png', '../face.png', 'https://example.com/f.png']) assert.equal(safeAvatar(path), null);
});

test('institutions span tabs, keep quiet and unreported seats, and preserve non-seat agents', () => {
  const snapshot = {
    terminals: [
      { address: 't1', state: 'live', cwd: quiet.cwd, status: 'idle', labels: { seats: 'sample', role: 'maker', moniker: 'Quiet', 'herdr.space': 's1' } },
      { address: 't2', state: 'live', cwd: quiet.cwd, labels: { seats: 'sample', role: 'guide', moniker: 'Unreported', 'herdr.space': 's2' } },
      { address: 'old', state: 'exited', labels: { seats: 'sample', role: 'old' } },
    ],
    agents: [{ address: 't3', space: 's3', status: 'working', program: { name: 'An agent' } }],
    panes: [{ terminal: 't1', pane: 'p1', cwd: quiet.cwd }],
    spaces: [{ id: 's3', name: 'Another space' }],
  };
  const groups = projectHerd(snapshot);
  assert.equal(groups.length, 2);
  const group = groups.find(g => g.name === 'sample');
  assert.deepEqual(group.seats.map(s => s.name), ['Quiet', 'Unreported']);
  assert.deepEqual(group.seats.map(s => s.status), ['idle', 'unknown']);
  assert.equal(group.quiet, true);
  assert.equal(group.seats[0].pane, 'p1');
  assert.equal(groups[0].name, 'Another space');
});

test('measured state time survives repeats and changes only on a state transition', () => {
  const start = stateHistory({}, [quiet], 1000);
  assert.deepEqual(stateHistory(start, [quiet], 9000), start);
  assert.equal(stateHistory(start, [{ ...quiet, status: 'working' }], 9000).t1.at, 9000);
  assert.equal(stateHistory(start, [quiet], 500).t1.at, 500);
});

test('two active prompt menus are recognized, with a literal quote and no automatic action', () => {
  const found = detectPrompt('\u001b[32m' + trust + '\u001b[0m', 'claude-code');
  assert.equal(found.id, 'claude-trust');
  assert.equal(found.quote, 'Do you trust the files in this folder?');
  assert.equal(found.key, 'Enter');
  assert.equal(detectPrompt(approval, 'codex').id, 'codex-approval');
  assert.equal(detectPrompt(trust, '').id, 'claude-trust');
  assert.equal(detectPrompt(trust + '\n'.repeat(60), 'claude-code').id, 'claude-trust');
  assert.equal(detectPrompt(approval, 'claude-code'), null);
  for (const text of ['We should add a trust this folder detector.', 'Would you like to run the following command?', 'All done.', trust + '\n'.repeat(30) + 'Finished']) assert.equal(detectPrompt(text), null);
  assert.equal(screenText(JSON.stringify({ text: trust })), trust);
  assert.equal(screenText('not json'), '');
});

test('cache rotates oldest quiet seats and invalidates moved, working, expired or removed prompts', () => {
  const now = 200000;
  const prompt = detectPrompt(trust);
  const cache = { t1: { checked: now - 1000, cwd: pathKey(quiet.cwd), prompt } };
  assert.equal(promptCandidates([quiet], cache, now, userHome).length, 0);
  assert.equal(currentPrompts([quiet], cache, now, userHome).length, 1);
  assert.equal(currentPrompts([{ ...quiet, status: 'working' }], cache, now, userHome).length, 0);
  assert.equal(currentPrompts([{ ...quiet, cwd: userHome + '/Work/sample' }], cache, now, userHome).length, 0);
  assert.equal(currentPrompts([{ ...quiet, cwd: userHome + '/Project/other' }], cache, now, userHome).length, 0);
  assert.equal(currentPrompts([quiet], cache, now + CACHE_MS, userHome).length, 0);
  assert.equal(currentPrompts([], cache, now, userHome).length, 0);
  assert.equal(promptCandidates([quiet, { ...quiet, address: 't2' }], cache, now + CACHE_MS, userHome)[0].address, 't2');
});
