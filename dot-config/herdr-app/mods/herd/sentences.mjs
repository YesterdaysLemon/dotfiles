// Conservative literal screen quotes. No model, command execution or persistence.
import { CACHE_MS, canReadScreen, detectPrompt, pathKey, promptCandidates, screenIdentity } from './model.mjs';
import { personalFolder } from './spaces.mjs';
export { screenIdentity } from './model.mjs';

export const SCREEN_READ_LIMIT = 4;
export const SCREEN_READ_WINDOW = 45000;

export function canReadCodexQuote(seat, userHome, activeSpace) {
  return Boolean(typeof activeSpace === 'string' && activeSpace && seat.pane && seat.space === activeSpace && !seat.machine &&
    /^codex(?:\.exe)?$/i.test(seat.app || seat.program?.key || '') &&
    personalFolder(seat.cwd, userHome) && canReadScreen({ ...seat, status: 'idle' }, userHome));
}

export function recentReadTimes(times, now) {
  return (times || []).filter(time => Number.isFinite(time) && time <= now && now - time < SCREEN_READ_WINDOW).slice(-SCREEN_READ_LIMIT);
}

function sameScreen(entry, seat) {
  return entry && entry.cwd === pathKey(seat.cwd) && entry.app === screenIdentity(seat) &&
    entry.pane === seat.pane && entry.space === seat.space;
}

// Oldest checks rotate across both routes. Waiting prompt seats lead; prompt
// checks win equal-age ties. One quiet Codex read can serve both routes.
export function screenCandidates(seats, cache, now, userHome, extraRoots, activeSpace) {
  const prompts = new Set(promptCandidates(seats, cache, now, userHome, extraRoots).map(seat => seat.address));
  const eligible = seats.filter(seat => prompts.has(seat.address) ||
    (canReadCodexQuote(seat, userHome, activeSpace) && (!sameScreen(cache[seat.address], seat) || cache[seat.address].checked > now || now - cache[seat.address].checked >= CACHE_MS)));
  const unique = new Map(eligible.map(seat => [seat.address, seat]));
  return [...unique.values()].sort((a, b) =>
    Number(b.status === 'blocked' && prompts.has(b.address)) - Number(a.status === 'blocked' && prompts.has(a.address)) ||
    (cache[a.address]?.checked ?? 0) - (cache[b.address]?.checked ?? 0) ||
    Number(prompts.has(b.address)) - Number(prompts.has(a.address)) || a.address.localeCompare(b.address));
}

const commentary = /^(?:I(?:\b|['’](?:m|ll|ve|d)\b)|We(?:\b|['’](?:re|ll|ve|d)\b)|The\b|This\b|Both\b|All\b)/;
const speculative = /^(?:I|We) (?:think|need|should|might|wonder|must)\b/i;
const sensitive = /(?:api[_ -]?key|access[_ -]?token|password|secret|token)\s*[:=]|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}|-----BEGIN .*PRIVATE KEY-----/i;

export function detectCodexQuote(text) {
  const lines = String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').trimEnd().split('\n').slice(-24);
  const tail = lines.join('\n');
  // Queued input occupies the same bullet surface; its text is not narration.
  if (/^•\s+Queued follow[- ]up\b/im.test(tail) || detectPrompt(tail, 'codex') ||
      /^(?:\s*)(?:Would you like to run the following command|Do you approve running)\b/im.test(tail)) return null;
  let quote = null;
  for (let index = 0; index < lines.length; index++) {
    const marker = /^• (.+)$/.exec(lines[index]);
    if (!marker || !commentary.test(marker[1]) || speculative.test(marker[1])) continue;
    const parts = [marker[1].trim()];
    for (let next = index + 1; next < Math.min(lines.length, index + 4); next++) {
      // Codex wraps assistant prose by two spaces. Deeper tool bodies and UI
      // decorations never become part of a quotation.
      if (!/^  \S/.test(lines[next]) || /^  [└↳›❯•]/.test(lines[next])) break;
      parts.push(lines[next].trim());
    }
    const paragraph = parts.join(' ');
    if (sensitive.test(paragraph)) continue;
    const sentence = /^(.{8,160}?[.!?])(?:\s|$)/u.exec(paragraph)?.[1];
    if (sentence) quote = { text: sentence, rule: 'codex-commentary' };
  }
  return quote;
}

export function quoteState(seat, cache, now, userHome, activeSpace) {
  if (!canReadCodexQuote(seat, userHome, activeSpace)) return null;
  const entry = cache[seat.address];
  if (!sameScreen(entry, seat) || !Number.isFinite(entry.checked) || entry.checked > now) return { kind: 'pending' };
  if (now - entry.checked >= CACHE_MS) return { kind: 'expired', checked: entry.checked };
  if (entry.error) return { kind: 'unavailable', checked: entry.checked };
  return entry.quote?.text ? { kind: 'quote', text: entry.quote.text, checked: entry.checked } : { kind: 'unrecognized', checked: entry.checked };
}
