// A literal text subset: paragraphs, hard breaks and dash bullets. No HTML/link parser.
export function questionBlocks(text) {
  const blocks = []; let lines = [];
  const flush = () => { if (lines.length) blocks.push({ kind: 'paragraph', lines }); lines = []; };
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) { flush(); continue; }
    const bullet = /^\s*-\s+(.+)$/.exec(line);
    if (bullet) { flush(); blocks.push({ kind: 'bullet', lines: [bullet[1]] }); }
    else lines.push(line);
  }
  flush(); return blocks;
}
