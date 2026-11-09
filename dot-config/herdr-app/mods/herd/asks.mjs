// Current-state projection and guarded explicit answer arguments. No shell text.
import { personalFolder } from './spaces.mjs';
export const ASK_TTL = 120000;

export function parseAsks(stdout) {
  if (typeof stdout !== 'string' || stdout.length > 2 * 1024 * 1024) throw new Error('invalid ask response');
  const value = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length > 500) throw new Error('invalid ask response');
  const seen = new Set();
  const result = [];
  for (const ask of value) {
    if (!ask || !/^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/.test(ask.id ?? '') || seen.has(ask.id) ||
        !['open', 'answered', 'withdrawn'].includes(ask.state) || typeof ask.from !== 'string' ||
        typeof ask.question !== 'string' || !ask.question.trim() || ask.question.length > 12000 || !Number.isFinite(Date.parse(ask.opened_at))) throw new Error('invalid ask response');
    seen.add(ask.id);
    if (ask.state !== 'open' || ask.to !== 'al') continue;
    // Native overlay props can round-trip an omitted optional value as null.
    if (ask.options != null && (!Array.isArray(ask.options) || ask.options.length > 30 || ask.options.some(option => typeof option !== 'string' || option.length > 2000))) throw new Error('invalid ask options');
    if ((typeof ask.recommendation === 'string' && ask.recommendation.length > 2000) || (typeof ask.blocks === 'string' && ask.blocks.length > 4000)) throw new Error('invalid ask details');
    result.push({ id: ask.id, from: ask.from, to: 'al', state: 'open', opened_at: ask.opened_at,
      question: ask.question, options: ask.options || [],
      recommendation: typeof ask.recommendation === 'string' ? ask.recommendation : null,
      blocks: typeof ask.blocks === 'string' ? ask.blocks : null,
      parent: typeof ask.parent === 'string' ? ask.parent : null,
      owner_project: typeof ask.owner_project === 'string' ? ask.owner_project : null });
  }
  return result.sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.id.localeCompare(b.id));
}

export function askGroups(items) {
  const groups = new Map();
  for (const ask of items) {
    const owner = ask.id.split(':')[0];
    if (!groups.has(owner)) groups.set(owner, { owner, asks: [] });
    groups.get(owner).asks.push(ask);
  }
  return [...groups.values()].sort((a, b) => a.owner.localeCompare(b.owner));
}

export function answerCommand(ask, text, userHome) {
  if (!ask || !/^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/.test(ask.id || '') || ask.to !== 'al' || ask.state !== 'open' ||
      !personalFolder(ask.owner_project, userHome)) throw new Error('The owning personal project is unavailable. Refresh this inbox.');
  if (typeof text !== 'string' || !text.trim() || text.length > 12000 || text.includes('\0')) throw new Error('Enter an answer of up to 12,000 characters.');
  return { args: ['--project', ask.owner_project, 'answer', '--from', 'al', '--', ask.id, text.trim()], cwd: ask.owner_project };
}

export function acceptedAnswer(result, id) {
  return result?.code === 0 && typeof result.stdout === 'string' && result.stdout.trim() === id;
}

export function askImages(ask) {
  // Only literal repo-relative PNG references in this ask, never URLs or globs.
  const paths = String(ask.question || '').match(/[^\s`"'<>()[\]{}]+\.png\b/gi) || [];
  return [...new Set(paths.filter(value => value.length <= 512 && !/[\\:*?\x00-\x1f$]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git') && value.endsWith('.png')))].slice(0, 3);
}

export function questionExcerpt(ask, limit = 140) {
  const text = ask.question.replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
}
