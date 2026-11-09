import test from 'node:test';
import assert from 'node:assert/strict';
import { questionBlocks } from './ask-text.mjs';

test('questions preserve paragraphs, hard breaks and dash bullets as literal text', () => {
  assert.deepEqual(questionBlocks('First paragraph\r\nsecond line\r\n\r\n- First choice\n- Second choice\n\nFinal paragraph'), [
    { kind: 'paragraph', lines: ['First paragraph', 'second line'] },
    { kind: 'bullet', lines: ['First choice'] }, { kind: 'bullet', lines: ['Second choice'] },
    { kind: 'paragraph', lines: ['Final paragraph'] },
  ]);
  assert.deepEqual(questionBlocks('<b>literal</b> [link](https://example.invalid)'), [{kind:'paragraph',lines:['<b>literal</b> [link](https://example.invalid)']}]);
  assert.deepEqual(questionBlocks(' \n\n'), []);
});
