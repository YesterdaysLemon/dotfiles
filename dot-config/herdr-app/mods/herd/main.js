// Cloned from seat-agents. Institution-first projection, without a model.
import { View, div, image, svg } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input } from 'gpui-base';
import { agents, terminals, panes, spaces, focused, run, theme, shared, setShared, home, appHome, hc, props, nextCommand, exec, watchFolder, openOverlay, closeOverlay, window, settings } from 'herdr';
import { CACHE_MS, projectHerd, withPromptStates, stateHistory, duration, promptCandidates, currentPrompts, detectPrompt, screenText, pathKey, canReadScreen } from './model.mjs';
import { INFO_TTL, personalFolder, artifactSource, acceptInfo, acceptArtifact, fitArtifact, configChanges, seatsExecutable } from './artifacts.mjs';
import { ASK_TTL, parseAsks, questionExcerpt, askGroups, askerProfile, answerCommand, acceptedAnswer, askImages, scriptSpace } from './asks.mjs';
import { spaceHerd, orderSpaceGroups } from './spaces.mjs';
import { SCREEN_READ_LIMIT, canReadCodexQuote, detectCodexQuote, quoteState, recentReadTimes, screenCandidates, screenIdentity } from './sentences.mjs';
import { publishFacts, consumeFacts, forgetFacts } from './facts.mjs';
import { validateGrid, boundGrid, gridTarget, gridSeats, restoreGridPlan, gridApi, gridGeometry } from './grid.mjs';
import { questionBlocks } from './ask-text.mjs';
import { PIN_STORE, readPins, pinKey, personalPinGroup, makePin, resolvePin, matchingPin, togglePin } from './pins.mjs';

const STATE = { working: 'Working', blocked: 'Needs you', done: 'Done', idle: 'Quiet', unknown: 'No report' };
const stored = () => { try { return JSON.parse(localStorage.getItem('herd.states') || '{}'); } catch { return {}; } };

export default class Herd extends View {
  init(_props, cx) {
    this.gridRequested = props()?.grid != null;
    this.albumRequested = props()?.album != null;
    if (this.albumRequested) {
      this.album = Array.isArray(props().album) ? props().album.slice(0, 12).map(acceptArtifact).filter(Boolean) : [];
      this.albumAt = Math.max(0, Math.min(this.album.length - 1, Number.isInteger(props().albumAt) ? props().albumAt : 0));
      this.albumZoom = 1; this.albumWidth = 1000; this.albumHeight = 720;
      this.albumFocus = cx.focus_handle(); this.albumFocus.focus();
      return; // Album copies use validated cached images only, never start readers.
    }
    this.askList = Array.isArray(props()?.askList) ? parseAsks(JSON.stringify(props().askList)) : null;
    this.preview = acceptArtifact(props()?.artifactPreview);
    if (this.preview) return;
    this.history = stored();
    this.historyDirty = false;
    this.cache = {};
    this.readTimes = [];
    this.width = 340;
    this.scanning = false;
    this.lastCheck = 0;
    this.artifacts = {};
    this.infos = {};
    this.watchedConfigs = new Set();
    this.metadataBusy = false;
    this.asks = [];
    this.asksChecked = 0;
    this.asksError = false;
    this.asksBusy = false;
    this.askSource = props()?.askSource || null;
    this.answerStates = {};
    this.scriptStates = {};
    this.askInputs = {};
    this.evidence = {};
    this.evidenceBusy = false;
    this.gridBusy = false;
    this.gridError = null;
    if (this.gridRequested) {
      this.grid = boundGrid(props().grid, shared('herd.gridPanes'), panes(), spaces());
      cx.timer.every(30000, cx => cx.notify());
      return; // Grid copies consume facts, never start readers.
    }
    if (this.askList) {
      this.prepareAskInputs();
      this.loadEvidence(cx);
      cx.timer.every(60000, cx => this.refreshAsks(cx));
      return;
    }
    this.factOwner = {};
    publishFacts(this.factOwner, {}, this.history, Date.now());
    this.scan(cx);
    this.refreshMetadata(cx);
    this.refreshAsks(cx);
    this.watchScope(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === 'refresh') { this.scan(cx); this.refreshMetadata(cx); this.refreshAsks(cx); }
        if (command === 'refresh-asks') { this.asksChecked = 0; this.refreshAsks(cx); }
      }
    });
    // Persist observed state outside render. These are data/clock timers, not animation.
    cx.timer.every(30000, cx => { this.saveHistory(); cx.notify(); });
    cx.timer.every(45000, cx => this.scan(cx));
    cx.timer.every(60000, cx => this.refreshMetadata(cx));
    cx.timer.every(60000, cx => this.refreshAsks(cx));
  }

  refreshAsks(cx) {
    if (this.asksBusy || (this.asksChecked && Date.now() - this.asksChecked < ASK_TTL)) return;
    const groups = this.snapshot();
    if (!this.personalView) return;
    const project = this.askList && personalFolder(this.askSource, home()) ? this.askSource : groups.map(group => {
      const source = artifactSource(group, home());
      return source ? this.infos?.[group.key]?.info?.project || source : null;
    }).find(Boolean);
    if (!project) { this.asksError = true; cx.notify(); return; } // No personal institution: no aggregate reads or endless Loading.
    const readingSpace = this.viewSpace;
    const readingAt = Date.now();
    this.asksBusy = true;
    this.asksError = false;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await exec(seatsExecutable(window()?.platform), ['--project', project, 'asks', '--to', 'al', '--all', '--open', '--json'], { timeout: 120000 });
        if (result.code !== 0) throw new Error('asks unavailable');
        const items = parseAsks(result.stdout).filter(ask => !ask.owner_project || personalFolder(ask.owner_project, home()));
        this.snapshot();
        if (!this.personalView || this.viewSpace !== readingSpace) return;
        const outcomes = shared('herd.askOutcomes') || {}, next = { ...outcomes };
        for (const ask of items) {
          // A fresh open ledger entry overrides old receipts. Preserve a send
          // completed after this read began, so an in-flight snapshot cannot undo it.
          if (next[ask.id] && !(next[ask.id]?.at > readingAt)) delete next[ask.id];
          if (this.answerStates[ask.id]?.sent && !(this.answerStates[ask.id].at > readingAt)) delete this.answerStates[ask.id];
        }
        if (Object.keys(next).length !== Object.keys(outcomes).length) setShared('herd.askOutcomes', next);
        if (this.askList) { this.askList = items; this.prepareAskInputs(); this.loadEvidence(cx); }
        else this.asks = items;
        this.askSource = project;
        this.asksChecked = Date.now();
        this.asksError = false;
      } catch { this.asksError = true; } // Retain the last successful list, visibly marked stale.
      finally {
        this.asksBusy = false;
        if (this.personalView && this.viewSpace !== readingSpace) this.refreshAsks(cx);
        cx.notify();
      }
    });
  }

  refreshScope(cx) {
    this.snapshot();
    if (this.readerSpace === this.viewSpace) return;
    this.readerSpace = this.viewSpace;
    if (!this.personalView) this.pendingAlbum = null;
    this.asksChecked = 0;
    this.refreshAsks(cx);
    this.refreshMetadata(cx);
    this.scan(cx);
    cx.notify();
  }

  watchScope(cx) {
    this.readerSpace = this.viewSpace;
    cx.spawn(async cx => {
      try {
        for (;;) {
          // Herdr owns this screen's selected space in view.json. Watch its event,
          // not Project/Work files, and do not create tasks from render.
          const paths = await watchFolder(appHome());
          if (paths.some(path => pathKey(path).split('/').at(-1) === 'view.json')) this.refreshScope(cx);
        }
      } catch { /* Existing clock/manual refresh remains available if the watch is unavailable. */ }
    });
  }

  watchConfig(folder, cx) {
    if (this.watchedConfigs.has(folder) || this.watchedConfigs.size >= 24 || !personalFolder(folder, home())) return;
    this.watchedConfigs.add(folder);
    cx.spawn(async cx => {
      try {
        for (;;) {
          const changed = await watchFolder(folder);
          if (!configChanges(changed, folder)) continue;
          for (const entry of Object.values(this.infos)) if (entry.info?.config_dir === folder) entry.checked = 0;
          this.asksChecked = 0;
          // The one-second pause coalesces bursts of mail/name/config writes.
          await cx.sleep(1000);
          this.refreshMetadata(cx);
          this.refreshAsks(cx);
        }
      } catch { this.watchedConfigs.delete(folder); } // Slow polling remains available.
    });
  }

  refreshMetadata(cx) {
    if (this.metadataBusy) return;
    this.metadataBusy = true;
    cx.spawn(async cx => {
      try {
        const scoped = this.snapshot();
        if (!this.personalView) return;
        const groups = this.pinMetadataGroups(scoped);
        const candidates = groups.map(group => ({ group, cwd: artifactSource(group, home()) }))
          .filter(({ group, cwd }) => cwd && (!this.infos[group.key] || this.infos[group.key].cwd !== cwd || Date.now() - this.infos[group.key].checked >= INFO_TTL))
          .sort((a, b) => (this.infos[a.group.key]?.checked ?? 0) - (this.infos[b.group.key]?.checked ?? 0)).slice(0, 4);
        for (const { group, cwd } of candidates) {
          const before = this.pinMetadataGroups(this.snapshot()).find(g => g.key === group.key);
          if (!this.personalView) break;
          if (!before || artifactSource(before, home()) !== cwd) continue;
          let info = null;
          let artifact = null;
          try {
            const result = await exec(seatsExecutable(window()?.platform), ['--project', cwd, 'info', '--json'], { timeout: 20000 });
            if (result.code === 0) info = acceptInfo(JSON.parse(result.stdout), group, home());
            this.snapshot();
            if (!this.personalView) break;
            // An explicit personal pin adds curated kit metadata only, never an artifact reader.
            const visible = this.snapshot().some(g => g.key === group.key);
            if (visible && info?.artifact_state === 'ready' && typeof info.artifact === 'string' && info.artifact) {
              const preview = await exec('node', [appHome() + '/mods/herd/artifact-reader.mjs', '--repo', info.project, '--glob', info.artifact,
                '--home', home(), '--app-home', appHome()], { timeout: 15000 });
              if (preview.code === 0) artifact = acceptArtifact(JSON.parse(preview.stdout));
            }
          } catch { /* Missing metadata support deliberately leaves the label-only fallback. */ }
          const live = this.pinMetadataGroups(this.snapshot()).find(g => g.key === group.key);
          if (!this.personalView || !live || artifactSource(live, home()) !== cwd) continue;
          this.infos[group.key] = { checked: Date.now(), cwd, info };
          this.artifacts[group.key] = artifact;
          if (info) this.watchConfig(info.config_dir, cx);
        }
        const eligible = new Set(this.pinMetadataGroups(this.snapshot()).filter(g => artifactSource(g, home())).map(g => g.key));
        for (const key of Object.keys(this.infos)) if (!eligible.has(key)) { delete this.infos[key]; delete this.artifacts[key]; }
      } finally {
        this.metadataBusy = false;
        this.refreshAsks(cx);
        cx.notify();
      }
    });
  }

  showArtifact(artifact) {
    openOverlay({ mod: 'herd', kind: 'dialog', width: 820, height: 650, props: { artifactPreview: artifact } });
  }

  showAskAlbum(ask, selected, cx) {
    this.snapshot();
    if (!this.personalView || !personalFolder(ask.owner_project, home())) return;
    const paths = askImages(ask);
    if (paths.some(path => !this.evidence?.[`${ask.id}|${ask.owner_project}|${path}`])) {
      this.pendingAlbum = { ask, selected };
      if (cx) { this.loadEvidence(cx); cx.notify(); }
      return;
    }
    const images = paths.map(path => {
      const image = acceptArtifact(this.evidence?.[`${ask.id}|${ask.owner_project}|${path}`]);
      return image?.path === path ? image : null;
    }).filter(Boolean);
    if (!images.length) return;
    openOverlay({ mod: 'herd', kind: 'dialog', width: 0.94, height: 0.92,
      props: { album: images, albumAt: Math.max(0, images.findIndex(image => image.path === selected)) } });
  }

  albumMove(delta, cx) {
    if (!this.album?.length) return;
    this.albumAt = (this.albumAt + delta + this.album.length) % this.album.length;
    this.albumZoom = 1; cx.notify();
  }

  albumScale(delta, cx) { this.albumZoom = Math.max(1, Math.min(4, this.albumZoom + delta)); cx.notify(); }

  albumKey(event, cx) {
    if (event.key === 'escape') closeOverlay(props().overlay);
    else if (event.key === 'right') this.albumMove(1, cx);
    else if (event.key === 'left') this.albumMove(-1, cx);
    else if (event.key === '+' || event.key === '=') this.albumScale(0.5, cx);
    else if (event.key === '-') this.albumScale(-0.5, cx);
    else if (event.key === '0') { this.albumZoom = 1; cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  albumView(t) {
    const current = this.album?.[this.albumAt];
    if (!current) return div().p(20).child('These images are unavailable.');
    // Native size events include the app zoom; explicit image dimensions scale again.
    const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    const width = Math.max(100, this.albumWidth / zoom - 40), height = Math.max(100, this.albumHeight / zoom - 120);
    const fit = fitArtifact(current, width, height);
    return v_flex().id('herd-album').size_full().min_w(0).min_h(0).p(16).gap(10).bg(t.canvas)
      .track_focus(this.albumFocus).on_key_down((event, cx) => this.albumKey(event, cx))
      .on_size_change((size, cx) => { if (size.width !== this.albumWidth || size.height !== this.albumHeight) {
        this.albumWidth = size.width; this.albumHeight = size.height; cx.notify();
      } })
      .child(h_flex().items_center().gap(8).flex_wrap()
        .child(this.askButton('herd-album-prev', '←', cx => this.albumMove(-1, cx), t, this.album.length < 2))
        .child(div().text_size(12).text_color(t.foreground).child(`${this.albumAt + 1} / ${this.album.length}`))
        .child(this.askButton('herd-album-next', '→', cx => this.albumMove(1, cx), t, this.album.length < 2))
        .child(div().flex_1())
        .child(this.askButton('herd-album-out', '−', cx => this.albumScale(-0.5, cx), t, this.albumZoom <= 1))
        .child(div().text_size(11).text_color(t.muted).child(this.albumZoom === 1 ? 'Fit' : `${this.albumZoom}×`))
        .child(this.askButton('herd-album-in', '+', cx => this.albumScale(0.5, cx), t, this.albumZoom >= 4))
        .child(this.askButton('herd-album-fit', 'Fit', cx => { this.albumZoom = 1; cx.notify(); }, t))
        .child(this.askButton('herd-album-close', 'Close · Esc', () => closeOverlay(props().overlay), t)))
      .child(div().id('herd-album-viewport').flex_1().min_w(0).min_h(0).overflow_x_scrollbar().overflow_y_scrollbar()
        .child(h_flex().w(Math.max(fit.width * this.albumZoom, width)).h(Math.max(fit.height * this.albumZoom, height))
          .items_center().justify_center().child(image(current.image).w(fit.width * this.albumZoom).h(fit.height * this.albumZoom))))
      .child(div().text_size(11).text_color(t.muted).truncate().child(current.path));
  }

  questionView(text, t) {
    return v_flex().gap(9).children(questionBlocks(text).map(block => block.kind === 'bullet'
      ? h_flex().gap(7).items_start().child(div().text_color(t.muted).child('•'))
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(block.lines[0]))
      : v_flex().gap(2).children(block.lines.map(line => div().text_size(12).text_color(t.foreground).child(line)))));
  }

  visibleAsks(items = this.asks) {
    const sent = shared('herd.askOutcomes') || {};
    return (items || []).filter(ask => !sent[ask.id] && !this.answerStates?.[ask.id]?.sent);
  }

  showAsks() {
    openOverlay({ mod: 'herd', kind: 'dialog', width: 800, height: 650, props: { askList: this.visibleAsks(), askSource: this.askSource } });
  }

  prepareAskInputs() {
    for (const ask of this.askList || []) if (!this.askInputs[ask.id]) {
      const input = InputState.new({ placeholder: ask.options?.length ? 'Optional note, or write your own answer' : 'Your answer' });
      input.on('change', (_event, cx) => cx.notify());
      this.askInputs[ask.id] = input;
    }
  }

  answerAsk(ask, option, cx) {
    if (this.answerStates?.[ask.id]?.sending || this.answerStates?.[ask.id]?.sent || this.answerStates?.[ask.id]?.closed || !this.visibleAsks([ask]).length) return;
    this.snapshot();
    if (!this.personalView) return;
    const note = this.askInputs?.[ask.id]?.value().trim() || '';
    let command;
    const pending = this.answerStates?.[ask.id]?.unconfirmed;
    try { command = answerCommand(ask, pending || (option ? option + (note ? '\n\n' + note : '') : note), home()); }
    catch (error) { this.answerStates[ask.id] = { error: error.message }; cx.notify(); return; }
    this.answerStates[ask.id] = { sending: true }; // Synchronous guard before spawning: rapid clicks cannot duplicate a write.
    cx.notify();
    cx.spawn(async cx => {
      try {
        if (pending) throw new Error('Check the previous delivery without sending again.');
        const result = await exec('node', [appHome() + '/mods/herd/answer-runner.mjs', JSON.stringify({ project: command.cwd, id: ask.id,
          answer: command.args.at(-1), home: home() })], { cwd: command.cwd, timeout: 100000 });
        if (!acceptedAnswer(result, ask.id)) throw new Error(result.stderr?.trim().slice(0, 400) || 'No matching answer receipt. Refresh before trying again.');
        this.answerSent(ask);
      } catch {
        this.answerStates[ask.id] = { sending: true, checking: true };
        cx.notify();
        try {
          const result = await exec('node', [appHome() + '/mods/herd/answer-runner.mjs', JSON.stringify({ mode: 'confirm', project: command.cwd,
            id: ask.id, answer: command.args.at(-1), home: home() })], { cwd: command.cwd, timeout: 100000 });
          if (result.code !== 0) throw new Error('Delivery check unavailable.');
          const state = JSON.parse(result.stdout).state;
          if (state === 'sent') this.answerSent(ask);
          else if (state === 'open') this.answerStates[ask.id] = { error: 'The owning ledger still shows this ask open. Your answer was not recorded.' };
          else if (state === 'closed') this.answerStates[ask.id] = { closed: true, error: 'This ask is already closed with a different outcome. Refresh the inbox.' };
          else throw new Error('Invalid delivery check.');
        } catch {
          this.answerStates[ask.id] = { unconfirmed: command.args.at(-1), error: 'Delivery is unconfirmed. Check delivery before sending again.' };
        }
      }
      finally { cx.notify(); }
    });
  }

  answerSent(ask) {
    const at = Date.now();
    this.answerStates[ask.id] = { sent: ask.from, at };
    const outcomes = shared('herd.askOutcomes') || {};
    setShared('herd.askOutcomes', Object.fromEntries([...Object.entries(outcomes).slice(-99), [ask.id, { from: ask.from, at }]]));
    this.asksChecked = 0;
  }

  openAskTerminal(ask, cx) {
    if (this.scriptStates?.[ask.id]?.busy || this.scriptStates?.[ask.id]?.cooldown) return;
    this.snapshot();
    if (!this.personalView || !ask.run || !personalFolder(ask.owner_project, home())) return;
    this.scriptStates[ask.id] = { busy: true };
    cx.notify();
    cx.spawn(async cx => {
      try {
        const helper = appHome() + '/mods/herd/script-runner.mjs';
        const request = { id: ask.id, run: ask.run, project: ask.owner_project, home: home() };
        const result = await exec('node', [helper, 'check', JSON.stringify(request)], { timeout: 120000 });
        if (result.code !== 0) throw new Error(result.stderr?.trim().slice(0, 250) || 'The committed script is unavailable.');
        const script = JSON.parse(result.stdout);
        if (!personalFolder(script.project, home()) || !/^[0-9a-f]{40,64}$/.test(script.commit) || !/^[0-9a-f]{64}$/.test(script.digest) ||
            typeof script.token !== 'string' || !/^[A-Za-z0-9_-]{1,16000}$/.test(script.token)) throw new Error('Invalid script check.');
        this.snapshot();
        const target = this.personalView && scriptSpace(ask, this.askerGroups || [], this.allSpaces || [], this.viewSpace, home(), this.infos);
        if (!target) throw new Error('Open this ask in a personal space to run its script.');
        const reply = await exec('herdr-app', ['do', 'tab.new', JSON.stringify({ space: target, folder: script.project, name: ask.id,
          argv: ['node', helper, 'launch', script.token] })], { timeout: 10000 });
        const created = reply.code === 0 && JSON.parse(reply.stdout);
        if (!created?.tab || !created?.terminal || created.error) throw new Error('The terminal did not open.');
        const state = { opened: true, cooldown: true };
        this.scriptStates[ask.id] = state;
        cx.timer.after(1500, cx => { if (this.scriptStates[ask.id] === state) { state.cooldown = false; cx.notify(); } });
        if (props()?.overlay) closeOverlay(props().overlay);
      } catch (error) { this.scriptStates[ask.id] = { error: String(error.message || 'The terminal did not open.').slice(0, 250) }; }
      finally { cx.notify(); }
    });
  }

  loadEvidence(cx) {
    if (this.evidenceBusy || !this.askList) return;
    this.evidenceBusy = true;
    cx.spawn(async cx => {
      try {
        for (const ask of this.askList) {
          this.snapshot();
          if (!this.personalView) break;
          if (!personalFolder(ask.owner_project, home())) continue;
          for (const path of askImages(ask)) {
            const key = `${ask.id}|${ask.owner_project}|${path}`;
            if (this.evidence[key]) continue;
            let preview = null;
            try {
              const result = await exec('node', [appHome() + '/mods/herd/artifact-reader.mjs', '--repo', ask.owner_project, '--path', path,
                '--home', home(), '--app-home', appHome()], { timeout: 15000 });
              if (result.code === 0) preview = acceptArtifact(JSON.parse(result.stdout));
            } catch { /* Missing/uncommitted images stay unavailable. */ }
            this.snapshot();
            if (!this.personalView) return;
            this.evidence[key] = preview || { status: 'unavailable' };
            if (this.pendingAlbum?.ask.id === ask.id && askImages(ask).every(path => this.evidence[`${ask.id}|${ask.owner_project}|${path}`])) {
              const pending = this.pendingAlbum; this.pendingAlbum = null;
              this.showAskAlbum(pending.ask, pending.selected, cx);
            }
            cx.notify();
          }
        }
      } finally { this.evidenceBusy = false; cx.notify(); }
    });
  }

  askButton(id, label, action, t, disabled = false, recommended = false) {
    return div().id(id).px(10).py(7).rounded(6).border(1).border_color(recommended ? t.accent : t.input)
      .bg(t.surface).text_size(11.5).text_color(t.foreground).opacity(disabled ? 0.45 : 1)
      .when(!disabled, el => el.cursor_pointer().hover(el => el.bg(t.hover)))
      .on_click((_event, cx) => { if (!disabled) action(cx); }).child(label);
  }

  askRow(ask, t, detail = false) {
    const writable = this.personalView && personalFolder(ask.owner_project, home());
    const asker = askerProfile(ask, this.askerGroups || [], home(), this.personalView, this.infos);
    return v_flex().id(`herd-ask-${ask.id}`).p(detail ? 12 : 8).gap(5).rounded(7).bg(t.raised)
      .when(!detail, el => el.cursor_pointer().hover(el => el.bg(t.hover)).on_click(() => this.showAsks()))
      .child(h_flex().gap(7).items_center().tooltip(asker ? `Current holder of ${ask.from}` : ask.from)
        .child(this.face(asker || { name: ask.from }, t, detail ? 32 : 26))
        .child(v_flex().min_w(0).gap(2)
          .child(div().truncate().text_size(detail ? 12 : 10.5).text_color(t.muted).child(asker ? `${asker.name} · ${asker.role}` : ask.from))
          .when(Boolean(asker), el => el.child(div().truncate().text_size(9).text_color(t.dim).child(ask.from)))))
      .child(detail ? this.questionView(ask.question, t) : div().text_size(10.5).text_color(t.foreground).child(questionExcerpt(ask)))
      .when(detail, el => el
        .children(askImages(ask).map(path => {
          const evidence = this.evidence?.[`${ask.id}|${ask.owner_project}|${path}`];
          return v_flex().id(`herd-evidence-${ask.id}-${path}`).gap(3)
            .when(evidence?.status === 'ready', el => el.child(this.artifactView(evidence, t, Math.max(180, this.width - 64), 260, 'Image', cx => this.showAskAlbum(ask, path, cx))))
            .when(evidence?.status !== 'ready', el => el.child(div().text_size(10).text_color(t.dim).child(`${path} · ${evidence ? 'preview unavailable' : 'loading preview…'}`)));
        }))
        .when(this.pendingAlbum?.ask.id === ask.id, el => el.child(div().text_size(11).text_color(t.muted).child('Loading images…')))
        .when(Boolean(ask.blocks), el => el.child(div().text_size(11).text_color(t.muted).child(`Waiting: ${ask.blocks}`)))
        .when(Boolean(ask.run), el => el.child(h_flex().gap(8).items_center()
          .child(this.askButton(`herd-run-${ask.id}`, this.scriptStates?.[ask.id]?.busy ? 'Checking script…' : this.scriptStates?.[ask.id]?.cooldown ? 'Opened terminal' : this.scriptStates?.[ask.id]?.opened ? 'Reopen terminal' : 'Open terminal', cx => this.openAskTerminal(ask, cx), t,
            Boolean(!writable || this.scriptStates?.[ask.id]?.busy || this.scriptStates?.[ask.id]?.cooldown)))
          .child(div().text_size(10).text_color(t.dim).child(ask.run))))
        .when(Boolean(this.scriptStates?.[ask.id]?.error), el => el.child(div().text_size(11).text_color(t.blocked).child(this.scriptStates[ask.id].error)))
        .when(Boolean(ask.recommendation && !ask.options?.length), el => el.child(div().text_size(11).text_color(t.muted).child(`Recommended: ${ask.recommendation}`)))
        .when(Boolean(this.askInputs?.[ask.id]), el => el.child(Input.new(this.askInputs[ask.id]).id(`herd-answer-input-${ask.id}`).h(36).px(9).rounded(6).border(1).border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)
          .disabled(Boolean(this.answerStates?.[ask.id]?.sending || this.answerStates?.[ask.id]?.unconfirmed || this.answerStates?.[ask.id]?.closed || !writable))))
        .child(h_flex().gap(6).flex_wrap().children((ask.options || []).map((option, index) => this.askButton(`herd-answer-option-${ask.id}-${index}`,
          option + (option === ask.recommendation ? ' · recommended' : ''), cx => this.answerAsk(ask, option, cx), t,
          Boolean(this.answerStates?.[ask.id]?.sending || this.answerStates?.[ask.id]?.unconfirmed || this.answerStates?.[ask.id]?.closed || !writable), option === ask.recommendation)))
          .child(this.askButton(`herd-answer-send-${ask.id}`, this.answerStates?.[ask.id]?.checking ? 'Checking delivery…' : this.answerStates?.[ask.id]?.sending ? 'Sending…' : this.answerStates?.[ask.id]?.unconfirmed ? 'Check delivery' : 'Send answer', cx => this.answerAsk(ask, null, cx), t,
            Boolean(this.answerStates?.[ask.id]?.sending || this.answerStates?.[ask.id]?.closed || !writable || (!this.answerStates?.[ask.id]?.unconfirmed && !this.askInputs?.[ask.id]?.value().trim())))))
        .when(!writable, el => el.child(div().text_size(10.5).text_color(t.muted).child('Read-only: owning personal project unavailable. Refresh to check again.')))
        .when(Boolean(this.answerStates?.[ask.id]?.error), el => el.child(div().text_size(11).text_color(t.blocked).child(this.answerStates[ask.id].error)))
        .child(div().text_size(9.5).text_color(t.dim).child(ask.id)));
  }

  askListView(t) {
    this.snapshot();
    const items = this.personalView ? this.visibleAsks(this.askList) : [];
    return v_flex().size_full().min_h(0).p(16).gap(12).bg(t.surface)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(`Asks to you · ${items.length}`))
        .child(div().id('herd-close-asks').p(6).text_color(t.muted).cursor_pointer().on_click(() => closeOverlay(props().overlay)).child('Close')))
      .child(h_flex().gap(8).items_center()
        .child(this.askButton('herd-refresh-asks', this.asksBusy ? 'Checking…' : 'Refresh', cx => { this.asksChecked = 0; this.refreshAsks(cx); }, t, this.asksBusy))
        .when(this.asksError && !this.asksBusy, el => el.child(div().text_size(11).text_color(t.blocked).child('Could not refresh · showing last known asks'))))
      .children(Object.values(this.answerStates || {}).filter(state => state.sent).slice(-3).map(state => div().text_size(11).text_color(t.done).child(`Sent to ${state.sent}`)))
      .child(v_flex().id('herd-ask-details').flex_1().min_h(0).gap(12).overflow_y_scrollbar()
        .when(!this.personalView, el => el.child(div().text_size(12).text_color(t.muted).child('Personal asks are available in Project.')))
        .when(this.personalView && !items.length, el => el.child(div().text_size(12).text_color(t.muted).child('No open asks.')))
        .children(askGroups(items).map(group => v_flex().gap(8)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child(`${group.owner.replace(/[-_]+/g, ' ')} · ${group.asks.length}`))
          .children(group.asks.map(ask => this.askRow(ask, t, true))))));
  }

  artifactView(artifact, t, width, maxHeight, label = 'Latest artifact', onClick = null) {
    const fit = fitArtifact(artifact, width, maxHeight);
    return v_flex().gap(4)
      .when(Boolean(onClick), el => el.cursor_pointer().tooltip('Open image album').on_click((_event, cx) => onClick(cx)))
      .child(h_flex().w_full().justify_center().rounded(7).bg(t.canvas).overflow_hidden()
        .child(image(artifact.image).w(fit.width).h(fit.height)))
      .child(div().text_size(9.5).text_color(t.dim).truncate().child(`${label} · ${artifact.commit.slice(0, 7)}`));
  }

  previewView(t) {
    const artifact = this.preview;
    return v_flex().size_full().p(16).gap(12).bg(t.surface)
      .child(h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).truncate().child(artifact.path))
        .child(div().id('herd-close-preview').p(6).text_color(t.muted).cursor_pointer().on_click(() => closeOverlay(props().overlay)).child('Close')))
      .child(this.artifactView(artifact, t, 760, 520))
      .child(div().text_size(10.5).text_color(t.muted).child('Selected by the institution’s declared showcase glob.'));
  }

  snapshot() {
    const allSpaces = spaces();
    this.allSpaces = allSpaces;
    this.livePanes = panes();
    this.liveSpaces = allSpaces;
    this.liveFocus = focused();
    const groups = projectHerd({ agents: agents(), terminals: terminals(), panes: this.livePanes, spaces: allSpaces });
    this.askerGroups = groups;
    this.viewSpace = this.grid?.space || props()?.space || this.liveFocus?.space;
    const view = spaceHerd(groups, allSpaces, this.viewSpace, home());
    this.personalView = view.personal;
    this.spaceName = view.spaceName;
    return orderSpaceGroups(view.personal ? withPromptStates(view.groups, this.cache, Date.now(), home(), this.roots()) : view.groups);
  }

  saveHistory() {
    if (this.factOwner) publishFacts(this.factOwner, this.personalView ? this.cache : {}, this.history, Date.now());
    if (!this.historyDirty) return;
    localStorage.setItem('herd.states', JSON.stringify(this.history));
    this.historyDirty = false;
  }

  async close() {
    this.saveHistory();
    if (this.factOwner) forgetFacts(this.factOwner);
    if (this.factOwner) {
      const all = panes(), allSpaces = spaces();
      const owned = Object.values(shared('herd.gridPanes') || {}).map(record => validateGrid(record, record?.pane, all, allSpaces)).filter(Boolean);
      if (owned.length) {
        const current = focused()?.pane;
        const active = owned.find(record => record.pane === current);
        const focus = active && (all.find(pane => pane.pane === active.focusPane && pane.tab === active.tab)?.pane ||
          all.find(pane => pane.tab === active.tab && pane.terminal)?.pane) || null;
        const zooms = owned.filter(record => all.find(pane => pane.pane === record.pane)?.zoomed).map(record => ({ pane: record.pane,
          target: all.find(pane => pane.pane === record.zoomPane && pane.tab === record.tab)?.pane || record.pane }));
        // close sees the old layout snapshot. The helper checks fresh native status.
        // An already started exec survives the closing copy's 250 ms cleanup budget.
        await exec('node', [appHome() + '/mods/herd/grid-exit.mjs', JSON.stringify({ panes: owned.map(record => record.pane), focus, zooms })], { timeout: 15000 });
      }
    }
    // The receipt belongs to the Core pane, which can outlive this View (layout/reload/quit).
    // Stale IDs are harmless: every use validates against live panes and the map is bounded.
  }

  gridState(group) {
    const target = gridTarget(group, this.livePanes || [], this.liveSpaces || [], this.liveFocus, this.infos?.[group.key]?.info?.conductor);
    if (!target) return null;
    const raw = shared('herd.gridPanes')?.[target.tab];
    const record = raw && validateGrid(raw, raw.pane, this.livePanes || [], this.liveSpaces || []);
    return { target, record, shown: Boolean(record && record.institution === group.key && this.liveFocus?.tab === record.tab &&
      this.livePanes?.find(p => p.pane === record.pane)?.zoomed) };
  }

  openGrid(group, cx) {
    if (this.gridBusy) return;
    const fresh = this.snapshot().find(g => g.key === group.key);
    const state = fresh && this.gridState(fresh);
    if (!state) return;
    if (state.shown) { this.returnGrid(state.record, cx); return; }
    if (state.record && state.record.institution !== group.key) {
      this.gridError = 'This tab already has a grid. Return to terminals first.'; cx.notify(); return;
    }
    this.gridBusy = true; this.gridError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        if (state.record) {
          if (!this.livePanes.find(p => p.pane === state.record.pane)?.zoomed) await gridApi(exec, 'pane.zoom', { pane: state.record.pane });
          await gridApi(exec, 'pane.focus', { pane: state.record.pane });
        } else {
          const before = new Set(this.livePanes.map(p => p.pane));
          const target = { ...state.target, token: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };
          const created = await gridApi(exec, 'pane.split', { pane: target.anchor, direction: 'right', mod: 'herd', props: { grid: target } });
          if (before.has(created.pane)) throw new Error('The grid did not receive a new pane.');
          const records = shared('herd.gridPanes') || {};
          setShared('herd.gridPanes', Object.fromEntries([...Object.entries(records).slice(-63), [target.tab, { ...target, pane: created.pane }]]));
          if (!panes().find(p => p.pane === created.pane)?.zoomed) run('pane.zoom', { pane: created.pane });
        }
      } catch (error) { this.gridError = String(error.message || 'Could not open the grid.').slice(0, 300); }
      finally { this.gridBusy = false; cx.notify(); }
    });
  }

  returnGrid(record, cx) {
    if (this.gridBusy) return;
    const steps = restoreGridPlan(record, panes());
    if (!steps.length) return;
    this.gridBusy = true; this.gridError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        for (const step of steps.slice(0, -1)) await gridApi(exec, step.command, step.args);
      } catch (error) {
        this.gridBusy = false; this.gridError = String(error.message || 'Could not restore terminals.').slice(0, 300); cx.notify(); return;
      }
      this.gridBusy = false;
      cx.notify();
      // Closing this copy is the last host call; restore its prior zoom/focus first.
      run('pane.close', steps.at(-1).args);
    });
  }

  openGridSeat(seat, cx) {
    if (this.gridBusy) return;
    const pane = panes().find(p => p.pane === seat.pane && p.terminal === seat.address);
    if (!pane) { this.jump(seat); return; }
    this.gridBusy = true; this.gridError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        if (!pane.zoomed) await gridApi(exec, 'pane.zoom', { pane: pane.pane });
        await gridApi(exec, 'pane.focus', { pane: pane.pane });
        // Keep the hidden grid and its original return record for Grid / Terminals.
      } catch (error) { this.gridError = String(error.message || 'Could not open this seat.').slice(0, 300); }
      finally { this.gridBusy = false; cx.notify(); }
    });
  }

  gridView(t) {
    const actual = boundGrid(props()?.grid, shared('herd.gridPanes'), panes(), spaces());
    if (!actual) return div().size_full().p(24).bg(t.canvas).text_color(t.muted).child('This grid is no longer attached to its institution tab.');
    this.grid = actual;
    let group = this.snapshot().find(g => g.key === actual.institution);
    let seats = gridSeats(group, actual.space);
    const now = Date.now();
    this.cache = this.personalView ? consumeFacts(seats, now).cache : {};
    group = this.snapshot().find(g => g.key === actual.institution);
    seats = gridSeats(group, actual.space);
    const history = consumeFacts(seats, now).history;
    this.history = stateHistory({ ...this.history, ...history }, seats, now);
    this.historyDirty = true;
    const zoom = Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    const geometry = gridGeometry(seats.length, this.gridArea ? this.gridArea.width / zoom : this.width / zoom - 12,
      this.gridArea ? this.gridArea.height / zoom : 600);
    return v_flex().id('herd-grid').size_full().min_w(0).min_h(0).p(6).gap(6).bg(t.canvas)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().gap(12).items_center().flex_wrap()
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().truncate().text_size(16).font_semibold().text_color(t.foreground).child(group?.name || 'Institution'))
          .child(div().text_size(11).text_color(t.dim).child(`${seats.length} seats · ${this.personalView ? 'live state and sourced sentences' : 'metadata only'}`)))
        .child(this.askButton('herd-grid-terminals', 'Terminals', cx => this.returnGrid(actual, cx), t, this.gridBusy)))
      .when(Boolean(this.gridError), el => el.child(div().text_size(11).text_color(t.blocked).child(this.gridError)))
      .child(v_flex().id('herd-grid-scroll').flex_1().min_w(0).min_h(0).overflow_y_scrollbar()
        .on_size_change((size, cx) => { if (this.gridArea?.width !== size.width || this.gridArea?.height !== size.height) { this.gridArea = size; cx.notify(); } })
        .when(!seats.length, el => el.child(div().p(12).text_size(13).text_color(t.muted).child('No seats remain in this institution.')))
        .child(h_flex().gap(geometry.gutter).flex_wrap().items_start().children(seats.map(seat => {
          const quote = this.personalView ? quoteState(seat, this.cache, now, home(), actual.space) : null;
          const sentence = quote?.kind === 'quote' ? quote.text : seat.statusLine;
          const age = duration(now - (this.history[seat.address]?.at ?? now));
          return v_flex().id(`herd-grid-seat-${seat.address}`).w(geometry.width).h(geometry.height).p(12).gap(8).rounded(6).bg(t.surface).border(1).border_color(t.border)
            .when(['idle', 'unknown'].includes(seat.status), el => el.opacity(0.68))
            .hover(el => el.bg(t.hover).border_color(t.accent).shadow_md().opacity(1)).cursor_pointer()
            .tooltip(`${seat.name} · ${seat.role}\nShow only this terminal. Grid in the sidebar brings the tiles back; Terminals restores the original splits.`)
            .on_click((_event, cx) => this.openGridSeat(seat, cx))
            .child(h_flex().gap(10).items_center()
              .when(this.personalView, el => el.child(this.face(seat, t, 42).id(`herd-grid-face-${seat.address}`)))
              .child(v_flex().flex_1().min_w(0).gap(5)
                .child(div().truncate().text_size(13).font_semibold().text_color(t.foreground).child(`${seat.name}${seat.role ? ' · ' + seat.role : ''}`))
                .child(h_flex().gap(6).items_center().child(this.stateMark(seat, t)).child(div().text_size(11).text_color(t.muted).child(`${STATE[seat.status]} · ${age}`)))))
            .when(Boolean(sentence), el => el.child(v_flex().flex_1().gap(7).justify_center()
              .child(div().id(`herd-grid-sentence-${seat.address}`).text_size(14).text_color(t.foreground).text_center().child(sentence))
              .child(div().text_size(9.5).text_color(t.dim).text_center().child(quote?.kind === 'quote' ? `screen · ${duration(now - quote.checked)}` : 'reported · terminal metadata'))));
        }))));
  }

  roots() {
    const value = shared('herd.screenRoots');
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
  }

  scan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async cx => {
      try {
        const seats = this.snapshot().flatMap(g => g.seats);
        if (!this.personalView) return;
        this.readTimes = recentReadTimes(this.readTimes, Date.now());
        const candidates = screenCandidates(seats, this.cache, Date.now(), home(), this.roots(), this.viewSpace)
          .slice(0, SCREEN_READ_LIMIT - this.readTimes.length);
        for (const candidate of candidates) {
          // Recheck live scope/status just before each read: a pane may have moved.
          const seat = this.snapshot().flatMap(g => g.seats).find(s => s.address === candidate.address);
          if (!this.personalView || !seat || !(canReadScreen(seat, home(), this.roots()) || canReadCodexQuote(seat, home(), this.viewSpace))) continue;
          this.readTimes = recentReadTimes(this.readTimes, Date.now());
          if (this.readTimes.length >= SCREEN_READ_LIMIT) break;
          this.readTimes.push(Date.now()); // Failed attempts count too; refresh cannot bypass the shared budget.
          let prompt = null;
          let quote = null;
          let error = false;
          try {
            const result = await hc(['read', seat.address, '--json', '--lines', '0']);
            const fresh = this.snapshot().flatMap(g => g.seats).find(s => s.address === seat.address);
            if (!this.personalView || !fresh || !(canReadScreen(fresh, home(), this.roots()) || canReadCodexQuote(fresh, home(), this.viewSpace)) ||
                pathKey(fresh.cwd) !== pathKey(seat.cwd) || fresh.pane !== seat.pane || fresh.space !== seat.space || screenIdentity(fresh) !== screenIdentity(seat)) {
              delete this.cache[seat.address];
              continue;
            }
            error = result.code !== 0;
            if (!error) {
              const text = screenText(result.stdout);
              if (canReadScreen(fresh, home(), this.roots())) prompt = detectPrompt(text, fresh.app);
              if (canReadCodexQuote(fresh, home(), this.viewSpace)) quote = detectCodexQuote(text);
            }
          } catch { error = true; }
          this.cache[seat.address] = { checked: Date.now(), cwd: pathKey(seat.cwd), app: screenIdentity(seat),
            pane: seat.pane, space: seat.space, prompt, quote, error };
        }
        // Cache only the recognized quote; never retain raw terminal screens.
        const live = new Set(seats.map(s => s.address));
        for (const address of Object.keys(this.cache)) if (!live.has(address)) delete this.cache[address];
        this.lastCheck = Date.now();
      } finally {
        this.scanning = false;
        this.saveHistory();
        cx.notify();
      }
    });
  }

  jump(seat) {
    if (seat.pane) run('pane.focus', { pane: seat.pane });
    else run('terminal.peek', { terminal: seat.address });
  }

  pinPreferences() { return readPins(shared(PIN_STORE), home()); }

  pinMetadataGroups(scoped) {
    const pins = this.pinPreferences(), all = this.askerGroups || scoped;
    const visible = new Set(scoped.map(group => group.key));
    return all.filter(group => visible.has(group.key) || (personalPinGroup(group, home()) && pins.some(pin => pin.workspace === group.workspace)));
  }

  pinTarget(groupKey, address) {
    const group = (this.askerGroups || []).find(group => group.key === groupKey);
    const seat = address ? group?.seats.find(seat => seat.address === address) : null;
    return address && !seat ? null : makePin(group, seat, this.infos, home());
  }

  changePin(groupKey, address, cx) {
    this.snapshot();
    if (!this.personalView) return;
    const target = this.pinTarget(groupKey, address);
    if (!target) return;
    setShared(PIN_STORE, { version: 1, items: togglePin(this.pinPreferences(), target, this.askerGroups || [], this.infos, home()) });
    this.refreshMetadata(cx); cx.notify();
  }

  removePin(pin, cx) {
    setShared(PIN_STORE, { version: 1, items: this.pinPreferences().filter(item => pinKey(item) !== pinKey(pin)) });
    cx.notify();
  }

  openPin(pin) {
    this.snapshot();
    if (!this.personalView) return;
    const current = resolvePin(pin, this.askerGroups || [], this.infos, home());
    if (current.state === 'ready') this.jump(current.seat);
  }

  pinButton(groupKey, address, t, compact) {
    const target = this.pinTarget(groupKey, address);
    const pinned = matchingPin(this.pinPreferences(), target, this.askerGroups || [], this.infos, home());
    return this.askButton(`herd-pin-toggle-${groupKey}-${address || 'institution'}`, compact ? (pinned ? '−' : '+') : (pinned ? 'Unpin' : 'Pin'), cx => {
      cx.stop_propagation(); this.changePin(groupKey, address, cx);
    }, t, !target).px(compact ? 3 : 6).py(compact ? 2 : 4).text_size(compact ? 9 : 10)
      .tooltip(target ? `${pinned ? 'Unpin' : 'Pin'} ${address ? (target.kind === 'conductor' ? 'the institution’s front desk; follows role renames and rotations' : 'this seat; follows rotations and recorded role renames') : 'this institution'}` : 'Waiting for personal institution metadata');
  }

  pinnedShelf(t, compact) {
    const pins = this.pinPreferences();
    if (!pins.length || !this.personalView) return null;
    return v_flex().id('herd-pinned').px(compact ? 4 : 10).pb(8).gap(4).flex_none()
      .child(div().px(3).text_size(compact ? 9 : 10).font_semibold().text_color(t.muted).child('PINNED'))
      .child(v_flex().id('herd-pinned-scroll').h(Math.min(compact ? 150 : 180, pins.length * (compact ? 66 : 52))).min_h(0).gap(4).overflow_y_scrollbar()
        .children(pins.map((pin, index) => {
          const current = resolvePin(pin, this.askerGroups || [], this.infos, home());
          const ready = current.state === 'ready';
          const name = pin.kind === 'institution' ? current.group?.name || pin.workspace : ready ? current.seat.name : pin.kind === 'conductor' ? 'Front desk' : pin.role;
          const context = pin.kind === 'institution' ? (ready ? `${current.group.seats.length} seats` : 'Not running') : ready ? `${current.seat.role} · ${current.group.name}` : pin.workspace;
          return (compact ? v_flex() : h_flex()).id(`herd-pinned-row-${index}`).px(compact ? 2 : 7).py(5).gap(compact ? 2 : 7).items_center()
            .flex_none().rounded(7).bg(t.surface).border(1).border_color(t.border)
            .child((compact ? v_flex() : h_flex()).id(`herd-pinned-open-${index}`).flex_1().min_w(0).gap(7).items_center()
              .when(compact, el => el.flex_none())
              .when(ready, el => el.cursor_pointer().hover(el => el.bg(t.hover)))
              .tooltip(`${name} · ${context}${ready ? '\nOpen the current terminal' : current.state === 'ambiguous' ? '\nMore than one live seat matches; refresh before opening' : '\nNot running or metadata unavailable'}`)
              .on_click(() => this.openPin(pin))
              .when(ready && pin.kind !== 'institution', el => el.child(this.face(current.seat, t, compact ? 23 : 28)))
              .when(pin.kind === 'institution' || !ready, el => el.child(div().size(compact ? 23 : 28).rounded(6).bg(t.raised).text_size(10).text_color(t.muted).flex().items_center().justify_center().child(pin.kind === 'institution' ? name.slice(0, 2) : '·')))
              .when(!compact, el => el.child(v_flex().flex_1().min_w(0).gap(2)
                .child(div().truncate().text_size(11.5).text_color(ready ? t.foreground : t.muted).child(name))
                .child(div().truncate().text_size(9.5).text_color(t.dim).child(ready ? context : current.state === 'ambiguous' ? 'Multiple live matches' : `Not running · ${context}`)))))
            .child(this.askButton(`herd-pinned-remove-${index}`, compact ? '−' : 'Unpin', cx => { cx.stop_propagation(); this.removePin(pin, cx); }, t)
              .px(compact ? 3 : 5).py(compact ? 2 : 4).text_size(compact ? 9 : 10));
        })));
  }

  face(seat, t, size = 30) {
    if (seat.avatar) return image(seat.avatar).w(size).h(size).flex_none();
    if (seat.program?.icon) return (seat.program.tint ? svg(seat.program.icon).text_color(t.muted) : image(seat.program.icon)).w(size - 6).h(size - 6).flex_none();
    return div().w(size).h(size).rounded(9).bg(t.raised).flex_none().flex().items_center().justify_center()
      .text_size(size * 0.44).text_color(t.muted).child(seat.name.slice(0, 1).toUpperCase());
  }

  stateMark(seat, t) {
    if (seat.status === 'working') return svg('mods/workspace-chrome/spinner.svg').size(10).text_color(t.working).spin(1100);
    return div().size(6).rounded(3).when(seat.status === 'idle' || seat.status === 'unknown', el => el.border(1).border_color(t.dim))
      .when(seat.status !== 'idle' && seat.status !== 'unknown', el => el.bg(t[seat.status] || t.dim));
  }

  sentenceRow(sentence, label, tip, address, t, now) {
    return v_flex().gap(2).min_w(0)
      .child(div().id(`herd-quote-${address}`).truncate().text_size(10.5).text_color(sentence.kind === 'quote' ? t.muted : t.dim)
        .tooltip(`${label}\n${tip}`).child(label))
      .when(sentence.kind === 'quote', el => el.child(div().text_size(9).text_color(t.dim).child(`screen · ${duration(now - sentence.checked)}`)));
  }

  seatRow(seat, t, now, compact) {
    const age = duration(now - (this.history[seat.address]?.at ?? now));
    const quiet = ['idle', 'unknown'].includes(seat.status) && !seat.focused;
    const label = seat.role ? `${seat.name} · ${seat.role}` : seat.name;
    const sentence = this.personalView ? quoteState(seat, this.cache, now, home(), this.viewSpace) : null;
    const quoteLabel = sentence?.kind === 'quote' ? sentence.text : {
      pending: 'Screen quote pending', expired: 'Screen quote expired', unavailable: 'Screen unavailable', unrecognized: 'No current screen quote',
    }[sentence?.kind];
    const quoteTip = sentence ? `${sentence.kind === 'quote' ? 'Literal visible screen quote' : quoteLabel}${sentence.checked ? ` · checked ${duration(now - sentence.checked)} ago` : ''}. Rules can miss progress text.` : '';
    return (compact ? v_flex() : h_flex()).id(`herd-seat-${seat.address}`).px(compact ? 3 : 7).py(6).gap(compact ? 2 : 9).rounded(7).items_center().cursor_pointer()
      .when(seat.focused, el => el.bg(t.selected))
      .when(quiet, el => el.opacity(0.68))
      .hover(el => el.bg(t.hover).opacity(1))
      .tooltip(`${label}\n${STATE[seat.status]} · ${age} since observed state change${seat.promptWait ? `\nRecognized screen prompt (reported state: ${STATE[seat.reportedStatus] || 'unknown'}).` : ''}${seat.fixture ? '\nPreview fixture' : ''}${sentence ? `\n${quoteLabel}\n${quoteTip}` : ''}`)
      .on_click(() => this.jump(seat))
      .child(this.face(seat, t, compact ? 24 : 32))
      .when(!compact, el => el.child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().truncate().text_size(12).text_color(t.foreground).child(label))
        .child(h_flex().gap(5).items_center()
          .child(this.stateMark(seat, t))
          .child(div().text_size(10.5).text_color(t.muted).child(`${STATE[seat.status]} · ${age}`))
          .when(seat.promptWait, el => el.child(div().text_size(9).text_color(t.dim).child('screen')))
          .when(seat.fixture, el => el.child(div().text_size(9).text_color(t.dim).child('fixture'))))
        .when(Boolean(seat.statusLine && seat.statusLine !== seat.role && seat.statusLine !== seat.name), el => el.child(div().truncate().text_size(10).text_color(t.dim).tooltip('Self-reported terminal metadata').child(seat.statusLine)))
        .when(sentence?.kind === 'quote', el => el.child(this.sentenceRow(sentence, quoteLabel, quoteTip, seat.address, t, now)))))
      .when(this.personalView, el => el.child(this.pinButton(seat.institution, seat.address, t, compact)))
      .when(!compact && !this.personalView, el => el.child(div().text_size(11).text_color(t.dim).child('›')));
  }

  card(group, t, now, compact) {
    const grid = this.gridState(group);
    const source = artifactSource(group, home());
    const artifact = this.personalView && source && pathKey(this.infos?.[group.key]?.cwd) === pathKey(source) ? this.artifacts?.[group.key] : null;
    const counts = ['blocked', 'working', 'done'].map(status => {
      const count = group.seats.filter(s => s.status === status).length;
      return count ? `${count} ${STATE[status].toLowerCase()}` : null;
    }).filter(Boolean);
    const quietCount = group.seats.filter(s => ['idle', 'unknown'].includes(s.status)).length;
    if (quietCount) counts.push(`${quietCount} quiet`);
    const summary = counts.join(' · ');
    const lead = group.seats.find(s => s.status === group.status) || group.seats[0];
    return v_flex().id(`herd-card-${group.key}`).p(compact ? 3 : 8).gap(3).rounded(10).bg(t.surface).border(1).border_color(t.border)
      .child(h_flex().id(`herd-institution-${group.key}`).px(compact ? 0 : 5).py(4).gap(compact ? 2 : 6).flex_wrap().items_center().cursor_pointer()
        .hover(el => el.bg(t.hover))
        .tooltip(`${group.name}${group.machine ? ' · ' + group.machine : ''}\n${summary}`)
        .on_click(() => this.jump(lead))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(compact ? 10 : 13).text_color(group.quiet ? t.muted : t.foreground).child(compact ? group.name.slice(0, 2) : group.name))
        .when(!compact, el => el.child(div().text_size(10).text_color(t.dim).child(String(group.seats.length))))
        .when(this.personalView, el => el.child(this.pinButton(group.key, null, t, compact)))
        .when(Boolean(grid), el => el.child(this.askButton(`herd-grid-open-${group.key}`, compact ? (grid?.shown ? 'T' : 'G') : (grid?.shown ? 'Terminals' : 'Grid'), cx => {
          cx.stop_propagation(); this.openGrid(group, cx);
        }, t, this.gridBusy).when(compact, el => el.px(3).py(2).text_size(9)))))
      .when(!compact, el => el.child(div().px(5).pb(4).text_size(10).text_color(t.dim).child(summary)))
      .when(!compact && Boolean(artifact), el => el.child(div().id(`herd-artifact-${group.key}`).px(5).py(4).cursor_pointer()
        .tooltip(`${artifact.path}\nCommit ${artifact.commit}\nOpen cached preview`)
        .on_click((_event, cx) => { cx.stop_propagation(); this.showArtifact(artifact); })
        .child(this.artifactView(artifact, t, this.width - 52, 160))))
      .children(group.seats.map(seat => this.seatRow(seat, t, now, compact)));
  }

  promptRow(prompt, t, now) {
    return v_flex().id(`herd-prompt-${prompt.address}`).p(8).gap(4).rounded(7).bg(t.raised).cursor_pointer()
      .hover(el => el.bg(t.hover))
      .tooltip(`Screen quote, checked ${duration(now - prompt.checked)} ago. Open the terminal and review before confirming. Nothing is sent automatically.`)
      .on_click(() => this.jump(prompt))
      .child(h_flex().gap(5).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(t.foreground).child(`${prompt.name}${prompt.role ? ' · ' + prompt.role : ''}`))
        .child(div().px(4).py(2).rounded(3).border(1).border_color(t.input).text_size(9).text_color(t.muted).child(prompt.key)))
      .child(div().text_size(10.5).text_color(t.muted).child(prompt.quote))
      .child(div().text_size(9.5).text_color(t.dim).child(`${prompt.title} · open to review${prompt.fixture ? ' · fixture' : ''}`));
  }

  needsView(t, prompts, inbox, coverage, compact) {
    const now = Date.now();
    if (compact) return div().id('herd-needs').px(4).pb(6).flex_none()
      .child(this.askButton('herd-compact-asks', `! ${inbox.length + prompts.length}`, () => this.showAsks(), t)
        .tooltip(`Needs you: ${inbox.length} asks · ${prompts.length} terminal prompts`));
    return v_flex().id('herd-needs').px(10).pb(8).gap(6).flex_none()
      .child(h_flex().px(3).items_center().justify_between()
        .child(div().text_size(10.5).font_semibold().text_color(t.muted).child('NEEDS YOU'))
        .child(div().id('herd-refresh').p(3).text_size(10).text_color(t.dim).cursor_pointer().hover(el => el.text_color(t.foreground))
          .tooltip('Share up to four screen reads per 45 seconds between quiet prompts and Project Codex quotes; reuse cached checks for 90 seconds.')
          .on_click((_event, cx) => this.scan(cx)).child(this.scanning ? 'Checking…' : '↻')))
      .child(v_flex().id('herd-needs-scroll').h(Math.min(240, 128 + prompts.length * 84 + Math.min(inbox.length, 2) * 60 + (inbox.length ? 24 : 0))).min_h(0).gap(5).overflow_y_scrollbar()
        .child(v_flex().gap(5).p(7).rounded(9).border(1).border_color(prompts.length ? t.input : t.border)
          .child(h_flex().justify_between()
            .child(div().text_size(10.5).text_color(t.muted).child('At the terminal'))
            .child(div().text_size(10).text_color(t.dim).child(String(prompts.length))))
          .when(!prompts.length, el => el.child(div().text_size(10.5).text_color(t.dim).child(this.lastCheck ? `No recognized prompts · ${coverage}` : 'Checking quiet personal seats…')))
          .children(prompts.map(prompt => this.promptRow(prompt, t, now))))
        .child(v_flex().p(8).gap(4).rounded(9).border(1).border_color(t.border)
          .child(h_flex().justify_between()
            .child(div().text_size(10.5).text_color(t.muted).child('Asks to you'))
            .child(div().text_size(10).text_color(t.dim).child(String(inbox.length))))
          .when(this.asksBusy, el => el.child(div().text_size(10).text_color(t.muted).child('Checking… · showing last known asks')))
          .when(this.asksError && !this.asksBusy, el => el.child(div().text_size(10).text_color(t.muted).child('Could not refresh · showing last known asks')))
          .when(!this.asks?.length && !this.asksError, el => el.child(div().text_size(10.5).text_color(t.dim).child(this.asksChecked ? 'No open asks in the configured institutions.' : 'Loading personal asks…')))
          .children(inbox.slice(0, 2).map(ask => this.askRow(ask, t)))
          .when(Boolean(inbox.length), el => el.child(div().id('herd-all-asks').py(5).text_size(10.5).text_color(t.muted).cursor_pointer()
            .hover(el => el.text_color(t.foreground)).on_click(() => this.showAsks()).child(`View all ${inbox.length} asks →`)))));
  }

  render() {
    const t = theme();
    if (this.gridRequested) return this.gridView(t);
    if (this.albumRequested) return this.albumView(t);
    if (this.askList) return this.askListView(t);
    if (this.preview) return this.previewView(t);
    const groups = this.snapshot();
    const seats = groups.flatMap(group => group.seats);
    const now = Date.now();
    const next = stateHistory(this.history, seats, now);
    if (JSON.stringify(next) !== JSON.stringify(this.history)) {
      this.history = next;
      this.historyDirty = true;
      if (this.factOwner) publishFacts(this.factOwner, this.personalView ? this.cache : {}, this.history, now);
    }
    const prompts = this.personalView ? currentPrompts(seats, this.cache, now, home(), this.roots()) : [];
    const localGroups = groups.filter(group => !group.outsidePin);
    const outsidePins = groups.filter(group => group.outsidePin).flatMap(group => group.seats);
    const compact = this.width < 180;
    const eligible = seats.filter(s => canReadScreen(s, home(), this.roots()));
    const recent = eligible.map(s => this.cache[s.address]).filter(entry => entry && now - entry.checked < CACHE_MS);
    const checked = recent.filter(entry => !entry.error).length;
    const unavailable = recent.filter(entry => entry.error).length;
    const pending = eligible.length - recent.length;
    const inbox = this.visibleAsks();
    const coverage = `${checked} checked${unavailable ? ` · ${unavailable} unavailable` : ''}${pending ? ` · ${pending} pending` : ''}`;
    return v_flex().id('herd-root').size_full().min_h(0).bg(t.chrome)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().px(compact ? 7 : 16).pt(14).pb(10).items_center().gap(8)
        .child(div().flex_1().text_size(compact ? 11 : 15).font_semibold().text_color(t.foreground).child('Herd'))
        .when(!compact, el => el.child(div().max_w(180).truncate().text_size(10).text_color(t.dim).child(this.spaceName || `${localGroups.length} institutions`))))
      .when(Boolean(this.gridError), el => el.child(div().px(16).pb(6).text_size(10.5).text_color(t.blocked).child(this.gridError)))
      .when(this.personalView, el => el.child(this.needsView(t, prompts, inbox, coverage, compact)))
      .when(this.personalView && this.pinPreferences().length > 0, el => el.child(this.pinnedShelf(t, compact)))
      .when(!compact && outsidePins.length > 0, el => el.child(h_flex().px(12).pb(7).gap(5).flex_wrap().items_center()
        .child(div().text_size(9).text_color(t.dim).child('Terminal pins'))
        .children(outsidePins.map(seat => div().id(`herd-pin-${seat.address}`).px(5).py(3).rounded(4).bg(t.surface).text_size(10).text_color(t.muted)
          .cursor_pointer().tooltip(`${seat.name} · ${seat.role}`).on_click(() => this.jump(seat)).child(`${seat.name} · ${seat.role}`)))))
      .child(v_flex().id('herd-scroll').flex_1().min_h(0).px(compact ? 4 : 10).gap(9).overflow_y_scrollbar().mode('always')
        .when(!groups.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child('No seats are running here yet.')))
        .children((compact ? groups : localGroups).map(group => this.card(group, t, now, compact)))
        .child(div().h(8)))
      .when(!compact, el => el.child(div().px(14).py(9).text_size(9.5).text_color(t.dim).child('Quiet seats stay in view.')));
  }
}
