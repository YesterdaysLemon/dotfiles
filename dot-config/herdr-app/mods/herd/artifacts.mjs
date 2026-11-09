import { pathKey } from './model.mjs';
import { personalFolder } from './spaces.mjs';
export { personalFolder } from './spaces.mjs';

export const INFO_TTL = 120000;
export const seatsExecutable = platform => platform === 'windows' ? 'seats.cmd' : 'seats';
export function artifactSource(group, userHome) {
  if (!group.workspace || group.machine) return null;
  // Urgency sorts seat rows, but must not change the institution's metadata source.
  return group.seats.filter(seat => seat.role && seat.address && !seat.address.includes('/') && personalFolder(seat.cwd, userHome))
    .sort((a, b) => pathKey(a.cwd).localeCompare(pathKey(b.cwd)) || a.address.localeCompare(b.address))[0]?.cwd ?? null;
}

export function acceptInfo(info, group, userHome) {
  if (!info || info.schema_version !== 1 || info.workspace !== group.workspace || !personalFolder(info.project, userHome) || !personalFolder(info.config_dir, userHome)) return null;
  return info;
}

export function acceptArtifact(value) {
  if (!value || value.status !== 'ready' || !/^herd-cache\/[0-9a-f]{64}\.png$/.test(value.image ?? '')) return null;
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 32768 || value.height > 32768 || value.width * value.height > 32_000_000) return null;
  if (!/^[0-9a-f]{40,64}$/.test(value.commit ?? '') || typeof value.path !== 'string') return null;
  return value;
}

export function fitArtifact(value, availableWidth, maxHeight = 160) {
  const scale = Math.min(Math.max(20, availableWidth) / value.width, maxHeight / value.height, 1);
  return { width: Math.max(1, Math.round(value.width * scale)), height: Math.max(1, Math.round(value.height * scale)) };
}

export function configChanges(paths, folder) {
  const root = pathKey(folder);
  const relevant = new Set(['seats.conf', 'roles', 'names', 'asks.jsonl', 'ask-routes']);
  return paths.some(path => pathKey(path) === root || relevant.has(pathKey(path).split('/').at(-1)));
}
