// Ephemeral facts shared by copies of this mod. No host calls or persistence.
import { CACHE_MS, RANK, pathKey, screenIdentity } from './model.mjs';
const sources = new Map();

export function publishFacts(owner, cache, history, now) {
  if (!owner) return;
  const screens = {};
  for (const [address, entry] of Object.entries(cache || {})) {
    if (!Number.isFinite(entry.checked) || entry.checked > now || now - entry.checked >= CACHE_MS) continue;
    screens[address] = { checked: entry.checked, cwd: entry.cwd, app: entry.app, pane: entry.pane, space: entry.space,
      error: Boolean(entry.error), quote: entry.quote ? { text: entry.quote.text } : null,
      prompt: entry.prompt ? { id: entry.prompt.id, title: entry.prompt.title, key: entry.prompt.key, quote: entry.prompt.quote } : null };
  }
  const states = Object.fromEntries(Object.entries(history || {}).filter(([, entry]) => entry?.status in RANK && Number.isFinite(entry.at) && entry.at <= now)
    .map(([address, entry]) => [address, { status: entry.status, at: entry.at }]));
  sources.delete(owner);
  sources.set(owner, { at: now, cache: screens, history: states });
  while (sources.size > 4) sources.delete(sources.keys().next().value);
}

export function forgetFacts(owner) { sources.delete(owner); }

export function consumeFacts(seats, now) {
  for (const [owner, entry] of sources) if (entry.at > now || now - entry.at > CACHE_MS + 30000) sources.delete(owner);
  const cache = {}, history = {};
  for (const source of [...sources.values()].sort((a, b) => a.at - b.at)) {
    for (const seat of seats) {
      const entry = source.cache[seat.address];
      if (entry && entry.checked <= now && now - entry.checked < CACHE_MS && entry.cwd === pathKey(seat.cwd) &&
          entry.app === screenIdentity(seat) && entry.pane === seat.pane && entry.space === seat.space &&
          (!cache[seat.address] || entry.checked >= cache[seat.address].checked)) cache[seat.address] = entry;
      if (source.history[seat.address]?.status === seat.status) history[seat.address] = source.history[seat.address];
    }
  }
  return { cache, history };
}
