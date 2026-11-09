// A bounded handoff survives the closing sidebar while fallback removes grids.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const localId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,240}$/.test(value);
const focusId = value => typeof value === 'string' && /^[A-Za-z0-9_/-]{1,240}$/.test(value);

export function exitGrids(request, run = execFileSync, pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)) {
  if (!request || !Array.isArray(request.panes) || request.panes.length > 64 || request.panes.some(pane => !localId(pane)) ||
      (request.focus != null && !focusId(request.focus)) || (request.zooms != null && (!Array.isArray(request.zooms) || request.zooms.length > 64 ||
        request.zooms.some(zoom => !request.panes.includes(zoom?.pane) || !localId(zoom?.target))))) throw new Error('Invalid grid cleanup request.');
  const failures = [];
  const settings = { encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  const status = () => { try { return JSON.parse(run('herdr-app', ['status'], settings)); } catch { return null; } };
  let live;
  for (let attempt = 0; attempt < 8; attempt++) {
    live = status();
    if (!live || live.layout === 'seats-main') break;
    pause(75);
  }
  if (live?.layout !== 'seats-main') return { closed: 0, failures, skipped: true };
  const owned = [...new Set(request.panes)];
  const invoke = (command, pane) => {
    try {
      const value = JSON.parse(run('herdr-app', ['do', command, '--pane', pane], settings));
      if (value?.ok !== true || value.error) throw new Error('No cleanup receipt.');
      return true;
    } catch { failures.push({ command, pane }); }
  };
  // Focus before removing the active grid; closing an unfocused mod preserves it.
  // Restore zoom explicitly: closing a zoomed grid otherwise zooms the focused terminal.
  for (const zoom of request.zooms || []) {
    if (status()?.layout !== 'seats-main') return { closed: 0, failures, skipped: true };
    invoke('pane.zoom', zoom.target);
  }
  if (request.focus && owned.includes(live.focused_pane)) invoke('pane.focus', request.focus);
  let closed = 0;
  for (const pane of owned) {
    if (status()?.layout !== 'seats-main') break;
    if (invoke('pane.close', pane)) closed++;
  }
  return { closed, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2].length > 20000) throw new Error('Invalid cleanup request.');
    console.log(JSON.stringify(exitGrids(JSON.parse(process.argv[2]))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
