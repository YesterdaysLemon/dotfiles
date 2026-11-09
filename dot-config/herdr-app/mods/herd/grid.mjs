// Native grid structure and navigation, independent of paint and readers.
const id = value => typeof value === 'string' && value.length > 0 && value.length < 240 && !/[\x00-\x1f]/.test(value);

export function validateGrid(value, pane, panes, spaces) {
  if (!value || !['institution', 'space', 'tab', 'focusPane', 'token'].every(key => id(value[key])) ||
      (value.zoomPane != null && !id(value.zoomPane)) || !id(pane)) return null;
  const own = panes.find(p => p.pane === pane && p.mod === 'herd' && p.tab === value.tab);
  const space = spaces.find(s => s.id === value.space && s.tabs.some(t => t.id === value.tab));
  return own && space && !space.machine ? { institution: value.institution, space: value.space, tab: value.tab,
    focusPane: value.focusPane, zoomPane: value.zoomPane || null, token: value.token, pane } : null;
}

// Mod panes receive only supplied props. Bind the native receipt, never focus.
export function boundGrid(request, records, panes, spaces) {
  const record = records?.[request?.tab];
  if (!record || record.token !== request?.token || record.institution !== request?.institution || record.space !== request?.space) return null;
  return validateGrid(request, record.pane, panes, spaces);
}

export function gridTarget(group, panes, spaces, focus, conductor = '') {
  if (group.machine) return null;
  const candidates = group.seats.flatMap(seat => {
    const pane = panes.find(p => p.terminal === seat.address && p.pane === seat.pane);
    const space = spaces.find(s => s.id === seat.space && !s.machine && s.tabs.some(t => t.id === pane?.tab));
    return pane && space ? [{ seat, pane, space }] : [];
  });
  const local = candidates.filter(c => c.pane.tab === focus?.tab);
  const anchor = local.find(c => c.seat.role === conductor) || local[0] || candidates.find(c => c.seat.role === conductor) || candidates[0];
  if (!anchor) return null;
  const before = panes.filter(p => p.tab === anchor.pane.tab);
  return { institution: group.key, space: anchor.space.id, tab: anchor.pane.tab, anchor: anchor.pane.pane,
    focusPane: before.find(p => p.pane === focus?.pane)?.pane || anchor.pane.pane,
    zoomPane: before.find(p => p.zoomed)?.pane || null };
}

export function gridSeats(group, space) {
  return (group?.seats || []).filter(seat => seat.space === space)
    .sort((a, b) => a.role.localeCompare(b.role) || a.address.localeCompare(b.address));
}

export function restoreGridPlan(record, panes) {
  const own = panes.find(p => p.pane === record?.pane && p.mod === 'herd' && p.tab === record.tab);
  if (!own) return [];
  const remaining = panes.filter(p => p.tab === record.tab && p.pane !== record.pane);
  const focus = remaining.find(p => p.pane === record.focusPane) || remaining.find(p => p.terminal) || remaining[0];
  const desired = remaining.find(p => p.pane === record.zoomPane);
  const current = panes.find(p => p.tab === record.tab && p.zoomed);
  const steps = [];
  if (desired && !desired.zoomed) steps.push({ command: 'pane.zoom', args: { pane: desired.pane } });
  else if (!desired && current) steps.push({ command: 'pane.zoom', args: { pane: current.pane } });
  if (focus) steps.push({ command: 'pane.focus', args: { pane: focus.pane } });
  steps.push({ command: 'pane.close', args: { pane: own.pane } });
  return steps;
}

export async function gridApi(execute, command, args) {
  if (!['pane.split', 'pane.zoom', 'pane.focus'].includes(command)) throw new Error('Unsupported grid command.');
  const result = await execute('herdr-app', ['do', command, JSON.stringify(args)], { timeout: 10000 });
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error('No grid command receipt.'); }
  if (result.code !== 0 || value?.error || (command === 'pane.split' ? !id(value?.pane) : value?.ok !== true)) {
    throw new Error(typeof value?.error === 'string' ? value.error : 'Grid command failed.');
  }
  return value;
}
