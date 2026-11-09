import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAnswer, confirmAnswer } from './answer-runner.mjs';

test('the real launcher preserves multiline/metacharacter answers through an args array into a stub ledger', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herd-launcher-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(home, 'Project/sample'), bin = path.join(root, 'bin');
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(bin);
  const script = path.join(bin, 'stub.cjs');
  fs.writeFileSync(script, `const fs=require('node:fs');const a=process.argv.slice(2);if(a[0]!=='--project'||a[2]!=='answer'||a[3]!=='--from'||a[4]!=='al'||a[5]!=='--')process.exit(3);fs.writeFileSync('answer.json',JSON.stringify({id:a[6],answer:a[7]}));console.log(a[6]);`, 'utf8');
  const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(bin, 'seats'), `#!/usr/bin/env bash\nexport MSYS2_ARG_CONV_EXCL='*'\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { encoding: 'utf8', mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
  const answer = '-literal "quoted"; $(nope) & %text%\n/exit `literal`';
  assert.equal(runAnswer({ project, home, id: 'sample:fixture', answer }, { env }).trim(), 'sample:fixture');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'answer.json'), 'utf8')), { id: 'sample:fixture', answer });
  const work = path.join(home, 'Work/sample'); fs.mkdirSync(work, { recursive: true });
  assert.throws(() => runAnswer({ project: work, home, id: 'sample:fixture', answer }, { env }));
});

test('delivery confirmation reads only the canonical owner and requires Al, ID and exact submitted text', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herd-confirm-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(home, 'Project/sample');
  fs.mkdirSync(project, { recursive: true });
  const request = { project, home, id: 'sample:fixture', answer: '  A\n\nExact note  ' };
  const ask = { id: request.id, to: 'al', state: 'answered', answered_by: 'al', answer: 'A\n\nExact note' };
  const check = items => confirmAnswer(request, { platform: 'linux', run(command, args, settings) {
    assert.equal(command, 'seats');
    assert.deepEqual(args, ['--project', fs.realpathSync(project), 'asks', '--json']);
    assert.equal(settings.timeout, 90000);
    return JSON.stringify(items);
  } });
  assert.equal(check([ask]), 'sent');
  assert.equal(check([{ ...ask, state: 'open' }]), 'open');
  for (const replacement of [{ answer: 'Different' }, { answered_by: 'sample/guide' }, { state: 'withdrawn' }]) {
    assert.equal(check([{ ...ask, ...replacement }]), 'closed');
  }
  for (const items of [[], {}, [ask, ask], [{ ...ask, id: 'other:fixture' }], [{ ...ask, to: 'sample/guide' }], [{ ...ask, state: 'mystery' }]]) {
    assert.throws(() => check(items));
  }
});
