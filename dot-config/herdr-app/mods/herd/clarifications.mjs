// A readable question envelope over the kit's existing parent relationship.
import { personalFolder } from './spaces.mjs';
import { pathKey } from './model.mjs';

const party = /^([a-z][a-z0-9_-]*)(?:\/([a-z][a-z0-9_-]*))?$/;
const askId = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]+$/;
export function clarificationQuestion(option, question) {
  if (typeof option !== 'string' || !option.trim() || option.length > 2000 || option.includes('\0') ||
      typeof question !== 'string' || !question.trim() || question.length > 4000 || question.includes('\0')) throw new Error('Enter one question of up to 4,000 characters.');
  return `About option ${JSON.stringify(option)}:\n\n${question.trim()}`;
}

function history(info) {
  const events = info?.renames ?? [];
  if (!Array.isArray(events) || events.length > 10000) throw new Error('Role history is unavailable.');
  let previous = -Infinity;
  for (const event of events) {
    const at = Date.parse(event?.at);
    if (!party.test(event?.from || '') || event.from.includes('/') || !party.test(event?.to || '') || event.to.includes('/') ||
        typeof event.at !== 'string' || !Number.isFinite(at) || at < previous) throw new Error('Role history is unavailable.');
    previous = at;
  }
  return events;
}

function currentRole(role, opened, info) {
  for (const event of history(info)) if (Date.parse(event.at) >= opened && event.from === role) role = event.to;
  return role;
}

export function clarificationTarget(parent, info, userHome) {
  if (!parent || !askId.test(parent.id || '') || parent.to !== 'al' || parent.state !== 'open' ||
      !personalFolder(parent.owner_project, userHome) || info?.schema_version !== 1 ||
      pathKey(info.project) !== pathKey(parent.owner_project) || !personalFolder(info.config_dir, userHome)) throw new Error('The owning personal institution is unavailable.');
  const from = party.exec(parent.from || ''), opened = Date.parse(parent.opened_at);
  if (!from || from[1] !== parent.id.split(':')[0] || !Number.isFinite(opened)) throw new Error('The asking seat is outside the owning institution.');
  history(info);
  const role = from[2] ? currentRole(from[2], opened, info) : info.conductor;
  const roles = info.roles;
  if (!party.test(role || '') || role.includes('/') || !Array.isArray(roles) || roles.filter(entry => entry?.role === role).length !== 1) throw new Error('The asking role is unavailable. Refresh to check again.');
  const seat = roles.find(entry => entry.role === role);
  if (!personalFolder(seat.cwd, userHome)) throw new Error('The asking role is outside the personal project scope.');
  return { party: `${from[1]}/${role}`, role, name: typeof seat.name === 'string' && seat.name ? seat.name : role };
}

export function clarificationCards(parent, items, info, userHome) {
  if (!personalFolder(parent.owner_project, userHome) || pathKey(info?.project) !== pathKey(parent.owner_project)) throw new Error('Invalid clarification owner.');
  const from = party.exec(parent.from || ''), cards = [];
  if (!from || from[1] !== parent.id.split(':')[0]) throw new Error('Invalid clarification asker.');
  const role = from[2] ? currentRole(from[2], Date.parse(parent.opened_at), info) : null;
  for (const child of items) {
    if (child?.parent !== parent.id || child.from !== 'al' || !askId.test(child.id || '') || child.id.split(':')[0] !== parent.id.split(':')[0] ||
        pathKey(child.owner_project) !== pathKey(parent.owner_project)) continue;
    const to = party.exec(child.to || ''), opened = Date.parse(child.opened_at);
    if (!to?.[2] || to[1] !== parent.id.split(':')[0] || !Number.isFinite(opened) || opened < Date.parse(parent.opened_at) ||
        (role && currentRole(to[2], opened, info) !== role)) continue;
    if (!['open', 'answered', 'withdrawn'].includes(child.state) || typeof child.question !== 'string') throw new Error('Invalid clarification state.');
    const option = (parent.options || []).find(option => child.question.startsWith(`About option ${JSON.stringify(option)}:\n\n`));
    if (option == null) continue; // Ordinary child asks are not inferred to be option clarifications.
    const question = child.question.slice(`About option ${JSON.stringify(option)}:\n\n`.length);
    if (clarificationQuestion(option, question) !== child.question) continue;
    if (child.state === 'answered' && (typeof child.answer !== 'string' || child.answer.length > 12000 || !party.test(child.answered_by || ''))) throw new Error('Invalid clarification answer.');
    cards.push({ id: child.id, option, question, state: child.state, opened_at: child.opened_at,
      answer: child.state === 'answered' ? child.answer : null, answered_by: child.state === 'answered' ? child.answered_by : null,
      reason: child.state === 'withdrawn' && typeof child.reason === 'string' ? child.reason.slice(0, 4000) : null });
  }
  return cards.sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.id.localeCompare(b.id));
}

export function parseClarificationResponse(stdout, parents) {
  if (typeof stdout !== 'string' || stdout.length > 2 * 1024 * 1024) throw new Error('Invalid clarification response.');
  const value = JSON.parse(stdout);
  if (value?.schema !== 1 || !Array.isArray(value.parents) || value.parents.length > 500) throw new Error('Invalid clarification response.');
  const seen = new Set();
  for (const row of value.parents) {
    const parent = parents.find(parent => parent.id === row?.id);
    if (!parent || seen.has(row.id) || !Array.isArray(row.items) || row.items.length > 10000 ||
        (row.target != null && (!party.test(row.target.party || '') || !row.target.party.startsWith(parent.id.split(':')[0] + '/') || typeof row.target.name !== 'string')) ||
        (row.error != null && typeof row.error !== 'string')) throw new Error('Invalid clarification response.');
    seen.add(row.id);
    for (const card of row.items) if (!askId.test(card?.id || '') || !parent.options.includes(card.option) ||
        typeof card.question !== 'string' || card.question.length > 4000 || !['open', 'answered', 'withdrawn'].includes(card.state) ||
        (card.state === 'answered' && (typeof card.answer !== 'string' || card.answer.length > 12000))) throw new Error('Invalid clarification response.');
  }
  return value;
}
