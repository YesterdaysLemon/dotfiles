import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCardImage, acceptCardReceipt, cardOptions } from './cards.mjs';

test('only bounded content-addressed card PNG/JPG cache receipts become images',()=>{
  const image={status:'ready',image:'herd-cache/cards/'+'a'.repeat(64)+'.jpg',sha256:'a'.repeat(64),width:800,height:600,path:'art/front.jpeg',commit:'b'.repeat(40)};
  assert.equal(acceptCardImage(image),image);
  for(const change of [{image:'../outside.jpg'},{sha256:'c'.repeat(64)},{width:8193},{height:0},{path:'../outside.jpg'},{commit:'not a commit'}])assert.equal(acceptCardImage({...image,...change}),null);
});

test('the receipt tree is bounded and contains only the shared six types',()=>{
  const card={schema:'ark-card/1',root:'pick',elements:{pick:{type:'options',props:{options:[{label:'Approve',detail:'Read only'}]}}}},value={card,images:[]};
  assert.equal(acceptCardReceipt(value),value);assert.equal(cardOptions(card).options[0].label,'Approve');
  for(const bad of [{...card,root:'missing'},{...card,elements:{pick:{type:'script',props:{}}}},{...card,elements:{pick:{type:'stack',props:{},children:['pick']}}}])assert.throws(()=>acceptCardReceipt({card:bad,images:[]}));
});
