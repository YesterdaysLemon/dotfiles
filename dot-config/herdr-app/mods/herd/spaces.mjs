import { RANK, pathKey } from './model.mjs';

const under = (path, root) => path === root || path.startsWith(root + '/');
export function personalFolder(value, userHome) {
  const folder = pathKey(value);
  return Boolean(folder && under(folder, pathKey(userHome + '/Project')) && !under(folder, pathKey(userHome + '/Work')));
}

export function orderSpaceGroups(groups) {
  return [...groups].sort((a, b) => Number(a.outsidePin) - Number(b.outsidePin) ||
    Number(b.liaison) - Number(a.liaison) || RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name));
}

// Space IDs and live seat labels are authoritative. A space's folder can belong
// to an unrelated shell, so do not use it to override its seated institutions.
export function spaceHerd(groups, spaces, activeSpace, userHome) {
  const space = spaces.find(s => s.id === activeSpace);
  const local = groups.flatMap(g => g.seats).filter(s => s.space === activeSpace);
  const workRoot = pathKey(userHome + '/Work');
  const workFolder = cwd => pathKey(cwd) === workRoot || pathKey(cwd).startsWith(workRoot + '/');
  const personal = Boolean(space && !space.machine && (local.length
    ? local.some(s => personalFolder(s.cwd, userHome)) && local.every(s => !s.machine && !workFolder(s.cwd))
    : personalFolder(space.folder, userHome)));
  const visible = groups.map(group => {
    const seats = group.seats.filter(s => s.space === activeSpace || s.pinned).map(seat => ({
      ...seat, avatar: personal && personalFolder(seat.cwd, userHome) && !seat.machine ? seat.avatar : null,
    }));
    return { ...group, seats,
      outsidePin: !seats.some(s => s.space === activeSpace),
      liaison: seats.some(s => s.space === activeSpace && s.role === 'liaison'),
      quiet: seats.every(s => ['idle', 'unknown'].includes(s.status)),
      status: seats.reduce((top, seat) => RANK[seat.status] > RANK[top] ? seat.status : top, 'unknown') };
  }).filter(g => g.seats.length);
  return { groups: orderSpaceGroups(visible), personal, spaceName: space?.name || '' };
}
