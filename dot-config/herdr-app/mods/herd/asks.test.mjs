import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAsks, questionExcerpt, answerCommand, acceptedAnswer, askImages } from './asks.mjs';

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
});
test('malformed, duplicate, oversized or unknown-state responses never become an all-clear', () => {
  for (const value of ['not json', '{}', JSON.stringify([ask, ask]), JSON.stringify([{ ...ask, state: 'mystery' }]), JSON.stringify(Array(501).fill(ask))]) assert.throws(() => parseAsks(value));
  assert.equal(questionExcerpt({ question: ' a   longer\nquestion for the next build ' }, 16), 'a longer questi…');
});
