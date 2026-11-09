import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAsks, questionExcerpt, answerCommand, acceptedAnswer, askImages, askerProfile, scriptPath, scriptSpace } from './asks.mjs';

const ask = { id: 'sample:20261108T120000Z-123abc', from: 'sample/guide', to: 'al', state: 'open', question: 'Choose the next build?', opened_at: '2026-11-08T12:00:00Z', options: ['one', 'two'], recommendation: 'one', blocks: 'the next build' };
test('the asks lane retains only open asks to Al and preserves the brief fields', () => {
  const items = parseAsks(JSON.stringify([ask, { ...ask, id: 'other:closed', state: 'answered' }, { ...ask, id: 'other:peer', to: 'sample/maker' }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].id, ask.id);
  assert.deepEqual(items[0].options, ['one', 'two']);
  assert.equal(items[0].recommendation, 'one');
  assert.equal(items[0].blocks, 'the next build');
  assert.deepEqual(parseAsks(JSON.stringify([{ ...ask, options: null }]))[0].options, [], 'native props can turn omitted values into null');
  assert.deepEqual(parseAsks(JSON.stringify([{ ...ask, options: undefined }]))[0].options, []);
});

test('answer arguments bind the personal owner and preserve text, including leading option characters', () => {
  const owner_project = 'C:/Users/example/Project/sample';
  const command = answerCommand({ ...ask, owner_project }, '-answer "quoted"; $literal', 'C:/Users/example');
  assert.deepEqual(command, { args: ['--project', owner_project, 'answer', '--from', 'al', '--', ask.id, '-answer "quoted"; $literal'], cwd: owner_project });
  for (const owner of [null, 'C:/Users/example/Work/sample', '/tmp/other']) assert.throws(() => answerCommand({ ...ask, owner_project: owner }, 'answer', 'C:/Users/example'));
  for (const text of ['', '  ', 'a\0b', 'x'.repeat(12001)]) assert.throws(() => answerCommand({ ...ask, owner_project }, text, 'C:/Users/example'));
  assert.equal(acceptedAnswer({ code: 0, stdout: ask.id + '\n' }, ask.id), true);
  for (const result of [{ code: 1, stdout: ask.id }, { code: 0, stdout: 'other:ask' }, { code: 0, stdout: ask.id + '\nextra' }, null]) assert.equal(acceptedAnswer(result, ask.id), false);
});

test('evidence recognizes only literal named relative PNGs, with no traversal, URL or glob', () => {
  assert.deepEqual(askImages({ question: 'Compare (docs/morning/the_look_variants.png), `docs/other.png` and docs/other.png.' }), ['docs/morning/the_look_variants.png', 'docs/other.png']);
  for (const question of ['../outside.png', '/tmp/file.png', 'https://host/file.png', 'C:/Work/file.png', 'docs/*.png', 'docs/[ab].png', '.git/file.png']) assert.deepEqual(askImages({ question }), [], question);
  const images = Array.from({length:15}, (_, i) => `docs/choice-${i}.png`);
  assert.deepEqual(askImages({question:images.concat(images).join(' ')}), images.slice(0,12));
});

test('the asks projection retains raw cards for the shared checker without hiding invalid-card asks', () => {
  const card={schema:'ark-card/1',root:'text',elements:{text:{type:'text',props:{text:'Fixture'}}}};
  assert.deepEqual(parseAsks(JSON.stringify([{...ask,card}]))[0].card,card);
  const oversized=parseAsks(JSON.stringify([{...ask,card:{text:'x'.repeat(70000)}}]))[0];
  assert.equal(oversized.id,ask.id);assert.equal(oversized.card.schema,'card-too-large');
  const owner_project='C:/Users/example/Project/sample';
  assert.equal(answerCommand({...ask,owner_project},' Approve ','C:/Users/example').args.at(-1),' Approve ','card labels remain exact');
});

test('asker faces bind one current personal role holder, with no Work, remote or ambiguous fallback', () => {
  const userHome = 'C:/Users/example', owner_project = userHome + '/Project/sample';
  const question = { ...ask, owner_project };
  const seat = { address: 't1', name: 'Current', role: 'guide', avatar: 'avatars/sample/current.png', cwd: owner_project };
  const group = { key: 'sample', workspace: 'sample', seats: [seat] };
  const profile = askerProfile(question, [group], userHome, true);
  assert.deepEqual(profile, { name: 'Current', role: 'guide', avatar: seat.avatar, party: 'sample/guide' });
  const reject = (questions = question, groups = [group], personal = true) => assert.equal(askerProfile(questions, groups, userHome, personal), null);
  reject(question, [group], false);
  reject({ ...question, owner_project: userHome + '/Work/sample' });
  reject({ ...question, owner_project: null });
  reject({ ...question, from: 'sample' });
  reject({ ...question, from: 'al' });
  reject(question, [{ ...group, seats: [seat, { ...seat, address: 't2' }] }]);
  for (const replacement of [{ ...seat, role: 'maker' }, { ...seat, cwd: userHome + '/Work/sample' }, { ...seat, address: 'remote/t1' }, { ...seat, machine: 'remote' }]) reject(question, [{ ...group, seats: [replacement] }]);
  reject(question, [{ ...group, machine: 'remote' }]);
  assert.equal(askerProfile(question, [{ ...group, seats: [{ ...seat, avatar: '../outside.png' }] }], userHome, true).avatar, null);
  const alias = { ...group, workspace: 'different-workspace' };
  assert.equal(askerProfile(question, [alias], userHome, true).name, 'Current', 'canonical owner path can bind a workspace alias');
  const worktree = { ...alias, seats: [{ ...seat, cwd: userHome + '/Project/sample-feature' }] };
  reject(question, [worktree]);
  assert.equal(askerProfile(question, [worktree], userHome, true, { sample: { info: { project: owner_project } } }).name, 'Current');
});
test('malformed, duplicate, oversized or unknown-state responses never become an all-clear', () => {
  for (const value of ['not json', '{}', JSON.stringify([ask, ask]), JSON.stringify([{ ...ask, state: 'mystery' }]), JSON.stringify(Array(501).fill(ask))]) assert.throws(() => parseAsks(value));
  assert.equal(questionExcerpt({ question: ' a   longer\nquestion for the next build ' }, 16), 'a longer questi…');
});


test('run is a literal optional path, and its destination prefers the owning personal space and excludes Work', () => {
  assert.equal(parseAsks(JSON.stringify([{ ...ask, run: 'tools/setup.ps1' }]))[0].run, 'tools/setup.ps1');
  for (const run of ['../bad.ps1', '/bad.ps1', 'C:/bad.ps1', 'tools\\bad.ps1', 'tools//bad.ps1', '.git/bad.ps1', 'tools/./bad.ps1', 'bad\n.ps1']) {
    assert.equal(scriptPath(run), false); assert.throws(() => parseAsks(JSON.stringify([{ ...ask, run }])));
  }
  const userHome = 'C:/Users/example', owner_project = userHome + '/Project/sample';
  const question = { ...ask, owner_project };
  const seat = { space: 'owner', cwd: owner_project };
  const groups = [{ key: 'sample', workspace: 'sample', seats: [seat] }];
  const all = [{ id: 'owner', folder: owner_project }, { id: 'current', folder: userHome + '/Project/other' }, { id: 'work', folder: userHome + '/Work/other' }, { id: 'remote', machine: 'remote', folder: owner_project }];
  assert.equal(scriptSpace(question, groups, all, 'current', userHome), 'owner');
  assert.equal(scriptSpace(question, [], all, 'current', userHome), 'current');
  assert.equal(scriptSpace(question, [], all, 'work', userHome), null);
  assert.equal(scriptSpace(question, [], all, 'remote', userHome), null);
  groups[0].seats.push({ space: 'owner', cwd: userHome + '/Work/other' });
  assert.equal(scriptSpace(question, groups, all, 'current', userHome), 'current', 'a mixed Work space cannot own the run tab');
});
