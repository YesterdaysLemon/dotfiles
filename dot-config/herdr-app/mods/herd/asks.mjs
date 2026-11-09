// Parse only the read-only current-state array returned by the personal seats kit.
export const ASK_TTL = 120000;

export function parseAsks(stdout) {
  if (typeof stdout !== 'string' || stdout.length > 2 * 1024 * 1024) throw new Error('invalid ask response');
  const value = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length > 500) throw new Error('invalid ask response');
  const seen = new Set();
  const result = [];
  for (const ask of value) {
    if (!ask || !/^[a-z][a-z0-9-]*:[A-Za-z0-9-]+$/.test(ask.id ?? '') || seen.has(ask.id) ||
        !['open', 'answered', 'withdrawn'].includes(ask.state) || typeof ask.from !== 'string' ||
        typeof ask.question !== 'string' || !ask.question.trim() || ask.question.length > 12000 || !Number.isFinite(Date.parse(ask.opened_at))) throw new Error('invalid ask response');
    seen.add(ask.id);
    if (ask.state !== 'open' || ask.to !== 'al') continue;
    if (ask.options !== undefined && (!Array.isArray(ask.options) || ask.options.length > 30 || ask.options.some(option => typeof option !== 'string' || option.length > 2000))) throw new Error('invalid ask options');
    if ((typeof ask.recommendation === 'string' && ask.recommendation.length > 2000) || (typeof ask.blocks === 'string' && ask.blocks.length > 4000)) throw new Error('invalid ask details');
    result.push({ id: ask.id, from: ask.from, to: 'al', state: 'open', opened_at: ask.opened_at,
      question: ask.question, options: ask.options,
      recommendation: typeof ask.recommendation === 'string' ? ask.recommendation : null,
      blocks: typeof ask.blocks === 'string' ? ask.blocks : null,
      parent: typeof ask.parent === 'string' ? ask.parent : null });
  }
  return result.sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.id.localeCompare(b.id));
}

export function questionExcerpt(ask, limit = 140) {
  const text = ask.question.replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
}
