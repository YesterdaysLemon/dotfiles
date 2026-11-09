// Pure projections of live Herdr metadata. No file, network or terminal access.
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1, unknown: 0 };
export const CACHE_MS = 90000;

export function pathKey(value) {
  let path = String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  path = path.replace(/^\/(?:mnt\/)?([a-z])\//i, '$1:/');
  const absolute = path.startsWith('/');
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && !/^[a-z]:$/i.test(parts.at(-1))) parts.pop();
    } else parts.push(part);
  }
  path = (absolute ? '/' : '') + parts.join('/');
  return /^[a-z]:/i.test(path) ? path.toLowerCase() : path;
}

const inside = (path, root) => path === root || path.startsWith(root + '/');

export function canReadScreen(seat, userHome, extraRoots = []) {
  if (!seat.address || seat.address.includes('/')) return false;
  if (!seat.role || !['idle', 'blocked', 'done', 'unknown'].includes(seat.status)) return false;
  const cwd = pathKey(seat.cwd);
  const base = pathKey(userHome);
  if (!cwd || !base || inside(cwd, pathKey(userHome + '/Work'))) return false;
  // Overrides are local mod state. They never bypass the Work exclusion.
  const roots = [userHome + '/Project', ...extraRoots].map(pathKey).filter(Boolean);
  return roots.some(root => inside(cwd, root));
}

export function safeAvatar(value) {
  const path = String(value ?? '').replace(/\\/g, '/');
  return /^avatars\/[\w .\/-]+\.(png|webp|jpg|svg)$/i.test(path) && !path.split('/').includes('..') ? path : null;
}

const wordStatus = value => typeof value === 'string' ? value : value?.state;
const basename = value => String(value ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? '';

export function projectHerd(snapshot) {
  const agentByAddress = new Map(snapshot.agents.map(a => [a.address, a]));
  const terminalByAddress = new Map(snapshot.terminals.map(t => [t.address, t]));
  const paneByAddress = new Map(snapshot.panes.filter(p => p.terminal).map(p => [p.terminal, p]));
  const spaces = new Map(snapshot.spaces.map(s => [s.id, s]));
  const addresses = new Set([
    ...snapshot.terminals.filter(t => t.state === 'live' && t.labels?.role).map(t => t.address),
    ...snapshot.agents.map(a => a.address),
  ]);
  const groups = new Map();
  for (const address of addresses) {
    const terminal = terminalByAddress.get(address) ?? {};
    const agent = agentByAddress.get(address) ?? {};
    const pane = paneByAddress.get(address) ?? {};
    const labels = terminal.labels ?? {};
    const machine = address.includes('/') ? address.split('/')[0] : '';
    const localSpace = labels['herdr.space'];
    const space = agent.space ?? (machine && localSpace ? `${machine}/${localSpace}` : localSpace);
    const institution = labels.seats || null;
    const key = institution ? `${machine}:institution:${institution}` : `${machine}:space:${space || 'other'}`;
    const name = institution ? basename(institution).replace(/[-_]+/g, ' ') : spaces.get(space)?.name || agent.space_name || 'Other agents';
    let status = wordStatus(agent.status) || wordStatus(terminal.status) || 'unknown';
    if (status === 'error') status = 'blocked';
    if (!(status in RANK)) status = 'unknown';
    const seat = {
      address, institution: key, pane: agent.pane || pane.pane || null,
      cwd: pane.cwd || terminal.cwd || '', space, machine,
      name: labels.moniker || terminal.name || agent.program?.name || 'Agent',
      role: labels.role || '', avatar: safeAvatar(labels.avatar),
      status, app: agent.app || terminal.report?.app || terminal.program?.key || '',
      program: agent.program || terminal.program || null,
      focused: Boolean(agent.focused || pane.focused),
      pinned: Boolean(agent.pinned || labels['herdr.pinned'] === 'true' || labels['herdr.pinned'] === '1'),
      statusLine: String(terminal.status_line || terminal.report?.status_line || terminal.report?.message ||
        (/claude/i.test(agent.app || terminal.program?.key || '') && agent.title !== agent.program?.name ? agent.title || '' : '')).replace(/[\r\n]+/g, ' ').slice(0, 180),
      fixture: labels['herd.fixture'] === 'true',
    };
    if (!groups.has(key)) groups.set(key, { key, name, machine, workspace: institution, seats: [] });
    groups.get(key).seats.push(seat);
  }
  return [...groups.values()].map(group => ({
    ...group,
    status: group.seats.reduce((top, seat) => RANK[seat.status] > RANK[top] ? seat.status : top, 'unknown'),
    quiet: group.seats.every(s => ['idle', 'unknown'].includes(s.status)),
  })).sort((a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name));
}

export function stateHistory(previous, seats, now) {
  const next = { ...previous };
  for (const seat of seats) {
    if (next[seat.address]?.status !== seat.status || next[seat.address]?.at > now) {
      next[seat.address] = { status: seat.status, at: now };
    }
  }
  const live = new Set(seats.map(s => s.address));
  for (const [address, entry] of Object.entries(next)) {
    if (!live.has(address) && now - entry.at > 30 * 86400000) delete next[address];
  }
  return next;
}

export function duration(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

// Conservative recognition of two active menus; never a command to approve them.
export const PROMPT_RULES = [
  {
    id: 'claude-trust', title: 'Folder trust', key: 'Enter', app: /claude/i,
    marker: /do you trust (?:the files in )?(?:this|the) folder|trust this folder|accessing workspace/i,
    choice: /(?:^|\n)\s*[❯›>]?\s*1[.)]\s*yes,?\s*(?:i trust|proceed)/i,
  },
  {
    id: 'codex-approval', title: 'Command approval', key: 'Enter', app: /codex/i,
    marker: /would you like to run the following command|do you approve running|requires approval/i,
    choice: /(?:^|\n)\s*[❯›>]?\s*1[.)]\s*(?:yes,? proceed|approve once|allow once)/i,
  },
];

export function detectPrompt(text, app = '') {
  const lines = String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').trimEnd().split('\n').slice(-24);
  const tail = lines.join('\n');
  for (const rule of PROMPT_RULES) {
    // Unknown programs include first-run trust screens, before any agent report.
    if (app && !/^(program|shell|python|python3|pwsh|powershell)$/i.test(app) && !rule.app.test(app)) continue;
    if (!rule.marker.test(tail) || !rule.choice.test(tail)) continue;
    const quote = lines.find(line => rule.marker.test(line))?.trim().slice(0, 170) || rule.title;
    return { id: rule.id, title: rule.title, key: rule.key, quote };
  }
  return null;
}

export function screenText(stdout) {
  try { return JSON.parse(stdout).text ?? ''; } catch { return ''; }
}

export function promptCandidates(seats, cache, now, userHome, extraRoots = []) {
  return seats.filter(s => canReadScreen(s, userHome, extraRoots))
    .filter(s => !cache[s.address] || cache[s.address].cwd !== pathKey(s.cwd) || now - cache[s.address].checked >= CACHE_MS)
    .sort((a, b) => (cache[a.address]?.checked ?? 0) - (cache[b.address]?.checked ?? 0));
}

export function currentPrompts(seats, cache, now, userHome, extraRoots = []) {
  return seats.flatMap(seat => {
    const entry = cache[seat.address];
    return canReadScreen(seat, userHome, extraRoots) && entry?.prompt && entry.cwd === pathKey(seat.cwd) && now - entry.checked < CACHE_MS
      ? [{ ...seat, ...entry.prompt, checked: entry.checked }] : [];
  });
}

// Effective triage state includes a current recognized menu, without rewriting
// the program's reported state. Expired, moved or working seats lose the overlay.
export function withPromptStates(groups, cache, now, userHome, extraRoots = []) {
  const prompts = new Map(currentPrompts(groups.flatMap(g => g.seats), cache, now, userHome, extraRoots).map(p => [p.address, p]));
  return groups.map(group => {
    const seats = group.seats.map(seat => {
      const prompt = prompts.get(seat.address);
      return prompt ? { ...seat, reportedStatus: seat.status, status: 'blocked', promptWait: true, promptChecked: prompt.checked } : seat;
    });
    return { ...group, seats,
      status: seats.reduce((top, seat) => RANK[seat.status] > RANK[top] ? seat.status : top, 'unknown'),
      quiet: seats.every(s => ['idle', 'unknown'].includes(s.status)),
    };
  }).sort((a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name));
}
