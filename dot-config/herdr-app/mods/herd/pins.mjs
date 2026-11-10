// UI preferences and live metadata resolution only. No readers or terminal actions.
import { pathKey } from './model.mjs';
import { personalFolder } from './spaces.mjs';
import { artifactSource } from './artifacts.mjs';

export const PIN_STORE = 'herd.pins.v1';
const word = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f]/.test(value);

export function pinKey(pin) { return JSON.stringify([pin.workspace, pin.project, pin.kind, pin.role || '', pin.after || 0]); }

export function readPins(value, userHome) {
  if (value?.version !== 1 || !Array.isArray(value.items)) return [];
  const seen = new Set();
  return value.items.slice(0, 128).flatMap(item => {
    if (!item || !text(item.workspace) || !text(item.project) || !personalFolder(item.project, userHome) ||
        !['institution', 'conductor', 'seat'].includes(item.kind) || (item.kind === 'seat' && (!word(item.role) ||
          (item.after != null && (!Number.isInteger(item.after) || item.after < 0 || item.after > 10000))))) return [];
    const pin = { workspace: item.workspace, project: pathKey(item.project), kind: item.kind,
      ...(item.kind === 'seat' ? { role: item.role, after: item.after || 0 } : {}) };
    const key = pinKey(pin);
    if (seen.has(key)) return [];
    seen.add(key); return [pin];
  });
}

export function personalPinGroup(group, userHome) {
  return Boolean(group?.workspace && !group.machine && group.seats?.length && group.seats.every(seat =>
    seat.address && !seat.address.includes('/') && !seat.machine && personalFolder(seat.cwd, userHome)));
}

export function pinInfo(group, infos, userHome) {
  const info = infos?.[group?.key]?.info;
  return personalPinGroup(group, userHome) && info?.schema_version === 1 && info.workspace === group.workspace &&
    Array.isArray(info.roles) &&
    pathKey(infos[group.key].cwd) === pathKey(artifactSource(group, userHome)) &&
    personalFolder(info.project, userHome) && personalFolder(info.config_dir, userHome) ? info : null;
}

// Follow ordered kit events after this pin was made. A reused old role name is
// a different seat; replaying all historic aliases would silently pick the wrong one.
export function currentPinRole(role, info, after = 0) {
  const renames = info?.renames ?? [];
  if (!word(role) || !Array.isArray(renames) || renames.length > 10000 || after > renames.length) return null;
  if (renames.some(event => !word(event?.from) || !word(event?.to) || !text(event.at) || !Number.isFinite(Date.parse(event.at)))) return null;
  for (const event of renames.slice(after)) if (event.from === role) role = event.to;
  return (Array.isArray(info?.roles) ? info.roles : []).filter(entry => entry?.role === role).length === 1 ? role : null;
}

export function makePin(group, seat, infos, userHome) {
  const info = pinInfo(group, infos, userHome);
  if (!info) return null;
  const base = { workspace: group.workspace, project: pathKey(info.project) };
  if (!seat) return { ...base, kind: 'institution' };
  if (!group.seats.some(live => live.address === seat.address) || !word(seat.role) ||
      !(info.roles || []).some(entry => entry.role === seat.role)) return null;
  const after = Array.isArray(info.renames) ? info.renames.length : 0;
  return seat.role === info.conductor ? { ...base, kind: 'conductor' } : { ...base, kind: 'seat', role: seat.role, after };
}

export function resolvePin(pin, groups, infos, userHome) {
  const candidates = groups.flatMap(group => {
    const info = pinInfo(group, infos, userHome);
    return info && group.workspace === pin.workspace && pathKey(info.project) === pin.project ? [{ group, info }] : [];
  });
  if (candidates.length !== 1) return { pin, state: 'unavailable' };
  const { group, info } = candidates[0];
  const role = pin.kind === 'conductor' ? info.conductor : pin.kind === 'seat' ? currentPinRole(pin.role, info, pin.after || 0) : null;
  const matches = pin.kind === 'institution' ? group.seats : group.seats.filter(seat => role && seat.role === role);
  if (!matches.length) return { pin, group, state: 'unavailable' };
  if (pin.kind !== 'institution' && matches.length !== 1) return { pin, group, state: 'ambiguous' };
  const conductors = matches.filter(seat => seat.role === info.conductor);
  const seat = pin.kind === 'institution' ? (conductors.length === 1 ? conductors[0] : matches[0]) : matches[0];
  return { pin, group, seat, state: 'ready' };
}

export function matchingPin(pins, target, groups, infos, userHome) {
  if (!target) return null;
  return pins.find(pin => {
    if (pin.workspace !== target.workspace || pin.project !== target.project) return false;
    if (pinKey(pin) === pinKey(target)) return true;
    if (pin.kind === 'institution' || target.kind === 'institution') return false;
    const old = resolvePin(pin, groups, infos, userHome), next = resolvePin(target, groups, infos, userHome);
    return old.state === 'ready' && next.state === 'ready' && old.seat.address === next.seat.address;
  }) || null;
}

export function togglePin(pins, target, groups, infos, userHome) {
  const current = matchingPin(pins, target, groups, infos, userHome);
  return current ? pins.filter(pin => pinKey(pin) !== pinKey(current)) : [...pins, target].slice(0, 128);
}
