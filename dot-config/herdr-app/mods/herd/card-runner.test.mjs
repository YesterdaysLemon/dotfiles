import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { checkedCard, runCardRequest, cleanCardRequest, CARD_CACHE_COUNT } from './card-runner.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herd-card-')), repo = path.join(root, 'Project/sample'), app = path.join(root, 'app');
  fs.mkdirSync(repo, {recursive:true});fs.mkdirSync(app);fs.mkdirSync(path.join(app,'mods/herd'),{recursive:true});
  fs.writeFileSync(path.join(app,'mods/herd/unchanged.js'),'original');fs.mkdirSync(path.join(root,'Work'));
  const git = (...args) => execFileSync('git',['-C',repo,...args],{stdio:'pipe'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  const data = Buffer.from('synthetic bytes verified by the stub kit');fs.writeFileSync(path.join(repo,'choice.png'),data);git('add','choice.png');git('commit','-qm','Fixture image');
  const card={schema:'ark-card/1',root:'image',elements:{image:{type:'image',props:{path:'choice.png'}}}};
  const manifest={path:'choice.png',file:path.join(repo,'choice.png'),sha256:hash(data),bytes:data.length,width:4,height:3,mime:'image/png'};
  const request={project:repo,home:root,appHome:app,card,options:['Approve','Deny'],recommendation:'Approve'};
  const calls=[];const options={invocation:{command:'stub-seats',prefix:[]},run(command,args,settings){calls.push({command,args,settings});return JSON.stringify({card,owner_project:repo,images:[manifest]});}};
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,repo,app,card,manifest,request,options,calls,data};
}

test('the bridge uses the shared checker with stdin and argv, verifies bytes, and never changes mods on a miss or hit',async t=>{
  const f=fixture(t), first=await checkedCard(f.request,f.options);
  assert.equal(f.calls[0].command,'stub-seats');assert.deepEqual(f.calls[0].args,['--project',f.repo,'_asks-card-check','--options','Approve|Deny','--rec','Approve']);
  assert.deepEqual(JSON.parse(f.calls[0].settings.input),f.card);assert.equal(f.calls[0].settings.shell,undefined);
  const preview=first.images[0],file=path.join(f.app,preview.image);assert.equal(hash(fs.readFileSync(file)),f.manifest.sha256);
  const before=fs.statSync(file).mtimeMs;await checkedCard(f.request,f.options);assert.equal(fs.statSync(file).mtimeMs,before);
  assert.equal(fs.readFileSync(path.join(f.app,'mods/herd/unchanged.js'),'utf8'),'original');assert.deepEqual(fs.readdirSync(path.join(f.app,'mods/herd')),['unchanged.js']);
  assert.deepEqual(fs.readdirSync(path.join(f.app,'cache/herd-locks')),[]);
  f.request.options=[];f.request.recommendation=null;await checkedCard(f.request,f.options);assert.deepEqual(f.calls.at(-1).args,['--project',f.repo,'_asks-card-check']);
});

test('Work, foreign images, changed copied bytes and changed rendered hashes refuse cards before use',async t=>{
  const f=fixture(t);await assert.rejects(checkedCard({...f.request,project:path.join(f.root,'Work')},f.options));assert.equal(f.calls.length,0);
  f.manifest.file=path.join(f.root,'Work/foreign.png');await assert.rejects(checkedCard(f.request,f.options));
  f.manifest.file=path.join(f.repo,'choice.png');f.manifest.sha256='a'.repeat(64);await assert.rejects(checkedCard(f.request,f.options),/changed after validation/);
  f.manifest.sha256=hash(f.data);await assert.rejects(checkedCard({...f.request,expectedImages:[{path:'choice.png',sha256:'b'.repeat(64)}]},f.options),/changed/);
  const gate={...f.options,run(){throw {stderr:Buffer.from('card refused: elements.pick: invalid option')};}};await assert.rejects(checkedCard(f.request,gate),/invalid option/);
});

test('temporary requests are removed in finally on success and refusal; cleanup cannot target other files or mods',async t=>{
  const f=fixture(t),file=path.join(f.app,'.herd-card-request-fixture.json');fs.writeFileSync(file,JSON.stringify(f.request));
  await runCardRequest(f.root,f.app,file,f.options);assert.equal(fs.existsSync(file),false);
  fs.writeFileSync(file,'invalid JSON');await assert.rejects(runCardRequest(f.root,f.app,file,f.options));assert.equal(fs.existsSync(file),false);
  for(const wrong of [path.join(f.app,'settings.json'),path.join(f.app,'mods/herd/.herd-card-request-fixture.json')])assert.throws(()=>cleanCardRequest(f.root,f.app,wrong));
});

test('card image cache trims only owned regular images, keeping the current card',async t=>{
  const f=fixture(t),cache=path.join(f.app,'herd-cache/cards');fs.mkdirSync(cache,{recursive:true});
  for(let i=0;i<CARD_CACHE_COUNT+2;i++)fs.writeFileSync(path.join(cache,i.toString(16).padStart(64,'0')+'.jpg'),'old');
  fs.writeFileSync(path.join(cache,'keep.txt'),'unrelated');await checkedCard(f.request,f.options);
  assert.equal(fs.readdirSync(cache).filter(name=>/\.(png|jpg)$/.test(name)).length,CARD_CACHE_COUNT);assert.equal(fs.readFileSync(path.join(cache,'keep.txt'),'utf8'),'unrelated');
});
