// Cloned from seat-agents. Institution-first projection, without a model.
import { View, div, image, svg } from 'gpui-kit';
import { v_flex, h_flex } from 'gpui-base';
import { agents, terminals, panes, spaces, focused, run, theme, shared, home, appHome, hc, props, nextCommand, exec, watchFolder, openOverlay, closeOverlay, window } from 'herdr';
import { CACHE_MS, projectHerd, withPromptStates, stateHistory, duration, promptCandidates, currentPrompts, detectPrompt, screenText, pathKey, canReadScreen } from './model.mjs';
import { INFO_TTL, personalFolder, artifactSource, acceptInfo, acceptArtifact, fitArtifact, configChanges, seatsExecutable } from './artifacts.mjs';
import { ASK_TTL, parseAsks, questionExcerpt } from './asks.mjs';
import { spaceHerd, orderSpaceGroups } from './spaces.mjs';
import { SCREEN_READ_LIMIT, canReadCodexQuote, detectCodexQuote, quoteState, recentReadTimes, screenCandidates, screenIdentity } from './sentences.mjs';

const STATE = { working: 'Working', blocked: 'Needs you', done: 'Done', idle: 'Quiet', unknown: 'No report' };
const stored = () => { try { return JSON.parse(localStorage.getItem('herd.states') || '{}'); } catch { return {}; } };

export default class Herd extends View {
  init(_props, cx) {
    this.askList = Array.isArray(props()?.askList) ? parseAsks(JSON.stringify(props().askList)) : null;
    if (this.askList) return;
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
    this.scan(cx);
    this.refreshMetadata(cx);
    this.refreshAsks(cx);
    cx.spawn(async cx => {
      for (;;) {
        if (await nextCommand() === 'refresh') { this.scan(cx); this.refreshMetadata(cx); this.refreshAsks(cx); }
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
    const project = groups.map(group => {
      const source = artifactSource(group, home());
      return source ? this.infos?.[group.key]?.info?.project || source : null;
    }).find(Boolean);
    if (!project) { this.asksError = Boolean(this.asks?.length || this.asksChecked); return; } // No personal institution: no aggregate reads.
    this.asksBusy = true;
    cx.spawn(async cx => {
      try {
        const result = await exec(seatsExecutable(window()?.platform), ['--project', project, 'asks', '--to', 'al', '--all', '--json'], { timeout: 30000 });
        if (result.code !== 0) throw new Error('asks unavailable');
        this.asks = parseAsks(result.stdout);
        this.asksChecked = Date.now();
        this.asksError = false;
      } catch { this.asksError = true; } // Retain the last successful list, visibly marked stale.
      finally { this.asksBusy = false; cx.notify(); }
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
        const groups = this.snapshot();
        if (!this.personalView) return;
        const candidates = groups.map(group => ({ group, cwd: artifactSource(group, home()) }))
          .filter(({ group, cwd }) => cwd && (!this.infos[group.key] || this.infos[group.key].cwd !== cwd || Date.now() - this.infos[group.key].checked >= INFO_TTL))
          .sort((a, b) => (this.infos[a.group.key]?.checked ?? 0) - (this.infos[b.group.key]?.checked ?? 0)).slice(0, 4);
        for (const { group, cwd } of candidates) {
          const before = this.snapshot().find(g => g.key === group.key);
          if (!this.personalView) break;
          if (!before || artifactSource(before, home()) !== cwd) continue;
          let info = null;
          let artifact = null;
          try {
            const result = await exec(seatsExecutable(window()?.platform), ['--project', cwd, 'info', '--json'], { timeout: 20000 });
            if (result.code === 0) info = acceptInfo(JSON.parse(result.stdout), group, home());
            this.snapshot();
            if (!this.personalView) break;
            if (info?.artifact_state === 'ready' && typeof info.artifact === 'string' && info.artifact) {
              const preview = await exec('node', [appHome() + '/mods/herd/artifact-reader.mjs', '--repo', info.project, '--glob', info.artifact,
                '--home', home(), '--app-home', appHome()], { timeout: 15000 });
              if (preview.code === 0) artifact = acceptArtifact(JSON.parse(preview.stdout));
            }
          } catch { /* Missing metadata support deliberately leaves the label-only fallback. */ }
          const live = this.snapshot().find(g => g.key === group.key);
          if (!this.personalView || !live || artifactSource(live, home()) !== cwd) continue;
          this.infos[group.key] = { checked: Date.now(), cwd, info };
          this.artifacts[group.key] = artifact;
          if (info) this.watchConfig(info.config_dir, cx);
        }
        const eligible = new Set(this.snapshot().filter(g => artifactSource(g, home())).map(g => g.key));
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

  showAsks(items = this.asks) {
    openOverlay({ mod: 'herd', kind: 'dialog', width: 740, height: 700, props: { askList: items } });
  }

  askRow(ask, t, detail = false) {
    return v_flex().id(`herd-ask-${ask.id}`).p(detail ? 12 : 8).gap(5).rounded(7).bg(t.raised)
      .when(!detail, el => el.cursor_pointer().hover(el => el.bg(t.hover)).on_click(() => this.showAsks([ask])))
      .child(div().text_size(9.5).text_color(t.dim).child(ask.from))
      .child(div().text_size(detail ? 12 : 10.5).text_color(t.foreground).child(detail ? ask.question : questionExcerpt(ask)))
      .when(detail, el => el
        .when(Boolean(ask.options?.length), el => el.child(div().text_size(11).text_color(t.muted).child(`Options: ${ask.options?.join(' · ')}`)))
        .when(Boolean(ask.recommendation), el => el.child(div().text_size(11).text_color(t.muted).child(`Recommended: ${ask.recommendation}`)))
        .when(Boolean(ask.blocks), el => el.child(div().text_size(11).text_color(t.muted).child(`Waiting: ${ask.blocks}`)))
        .child(div().text_size(9.5).text_color(t.dim).child(ask.id)));
  }

  askListView(t) {
    return v_flex().size_full().min_h(0).p(16).gap(12).bg(t.surface)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(`Asks to you · ${this.askList.length}`))
        .child(div().id('herd-close-asks').p(6).text_color(t.muted).cursor_pointer().on_click(() => closeOverlay(props().overlay)).child('Close')))
      .child(v_flex().id('herd-ask-details').flex_1().min_h(0).gap(9).overflow_y_scrollbar().children(this.askList.map(ask => this.askRow(ask, t, true))))
      .child(div().text_size(10.5).text_color(t.muted).child('Answers go through your liaison.'));
  }

  artifactView(artifact, t, width, maxHeight) {
    const fit = fitArtifact(artifact, width, maxHeight);
    return v_flex().gap(4)
      .child(h_flex().w_full().justify_center().rounded(7).bg(t.canvas).overflow_hidden()
        .child(image(artifact.image).w(fit.width).h(fit.height)))
      .child(div().text_size(9.5).text_color(t.dim).truncate().child(`Latest artifact · ${artifact.commit.slice(0, 7)}`));
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
    const groups = projectHerd({ agents: agents(), terminals: terminals(), panes: panes(), spaces: allSpaces });
    this.viewSpace = props()?.space || focused()?.space;
    const view = spaceHerd(groups, allSpaces, this.viewSpace, home());
    this.personalView = view.personal;
    this.spaceName = view.spaceName;
    return orderSpaceGroups(view.personal ? withPromptStates(view.groups, this.cache, Date.now(), home(), this.roots()) : view.groups);
  }

  saveHistory() {
    if (!this.historyDirty) return;
    localStorage.setItem('herd.states', JSON.stringify(this.history));
    this.historyDirty = false;
  }

  close() { this.saveHistory(); }

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
    return h_flex().id(`herd-seat-${seat.address}`).px(compact ? 3 : 7).py(6).gap(9).rounded(7).items_center().cursor_pointer()
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
        .when(Boolean(sentence), el => el.child(this.sentenceRow(sentence, quoteLabel, quoteTip, seat.address, t, now)))))
      .when(!compact, el => el.child(div().text_size(11).text_color(t.dim).child('›')));
  }

  card(group, t, now, compact) {
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
      .child(h_flex().id(`herd-institution-${group.key}`).px(5).py(4).gap(6).items_center().cursor_pointer()
        .hover(el => el.bg(t.hover))
        .tooltip(`${group.name}${group.machine ? ' · ' + group.machine : ''}\n${summary}`)
        .on_click(() => this.jump(lead))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(compact ? 10 : 13).text_color(group.quiet ? t.muted : t.foreground).child(compact ? group.name.slice(0, 2) : group.name))
        .when(!compact, el => el.child(div().text_size(10).text_color(t.dim).child(String(group.seats.length)))))
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

  render() {
    const t = theme();
    if (this.askList) return this.askListView(t);
    if (this.preview) return this.previewView(t);
    const groups = this.snapshot();
    const seats = groups.flatMap(group => group.seats);
    const now = Date.now();
    const next = stateHistory(this.history, seats, now);
    if (JSON.stringify(next) !== JSON.stringify(this.history)) {
      this.history = next;
      this.historyDirty = true;
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
    const coverage = `${checked} checked${unavailable ? ` · ${unavailable} unavailable` : ''}${pending ? ` · ${pending} pending` : ''}`;
    return v_flex().id('herd-root').size_full().min_h(0).bg(t.chrome)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().px(compact ? 7 : 16).pt(14).pb(10).items_center().gap(8)
        .child(div().flex_1().text_size(compact ? 11 : 15).font_semibold().text_color(t.foreground).child('Herd'))
        .when(!compact, el => el.child(div().max_w(180).truncate().text_size(10).text_color(t.dim).child(this.spaceName || `${localGroups.length} institutions`))))
      .when(!compact && outsidePins.length > 0, el => el.child(h_flex().px(12).pb(7).gap(5).flex_wrap().items_center()
        .child(div().text_size(9).text_color(t.dim).child('Pinned'))
        .children(outsidePins.map(seat => div().id(`herd-pin-${seat.address}`).px(5).py(3).rounded(4).bg(t.surface).text_size(10).text_color(t.muted)
          .cursor_pointer().tooltip(`${seat.name} · ${seat.role}`).on_click(() => this.jump(seat)).child(`${seat.name} · ${seat.role}`)))))
      .child(v_flex().id('herd-scroll').flex_1().min_h(0).px(compact ? 4 : 10).gap(9).overflow_y_scrollbar().mode('always')
        .when(!compact && this.personalView, el => el.child(v_flex().gap(6).mb(3)
          .child(h_flex().px(3).items_center().justify_between()
            .child(div().text_size(10.5).font_semibold().text_color(t.muted).child('NEEDS YOU'))
            .child(div().id('herd-refresh').p(3).text_size(10).text_color(t.dim).cursor_pointer().hover(el => el.text_color(t.foreground))
              .tooltip('Share up to four screen reads per 45 seconds between quiet prompts and Project Codex quotes; reuse cached checks for 90 seconds.')
              .on_click((_event, cx) => this.scan(cx)).child(this.scanning ? 'Checking…' : '↻')))
          .child(v_flex().gap(5).p(7).rounded(9).border(1).border_color(prompts.length ? t.input : t.border)
            .child(h_flex().justify_between()
              .child(div().text_size(10.5).text_color(t.muted).child('At the terminal'))
              .child(div().text_size(10).text_color(t.dim).child(String(prompts.length))))
            .when(!prompts.length, el => el.child(div().text_size(10.5).text_color(t.dim).child(this.lastCheck ? `No recognized prompts · ${coverage}` : 'Checking quiet personal seats…')))
            .children(prompts.map(prompt => this.promptRow(prompt, t, now))))
          .child(v_flex().p(8).gap(4).rounded(9).border(1).border_color(t.border)
            .child(h_flex().justify_between()
              .child(div().text_size(10.5).text_color(t.muted).child('Asks to you'))
              .child(div().text_size(10).text_color(t.dim).child(String(this.asks?.length ?? 0))))
            .when(this.asksError, el => el.child(div().text_size(10).text_color(t.muted).child('Could not refresh · showing last known asks')))
            .when(!this.asks?.length && !this.asksError, el => el.child(div().text_size(10.5).text_color(t.dim).child(this.asksChecked ? 'No open asks in the configured institutions.' : 'Loading personal asks…')))
            .children((this.asks ?? []).slice(0, 2).map(ask => this.askRow(ask, t)))
            .when(Boolean(this.asks?.length), el => el.child(div().id('herd-all-asks').py(5).text_size(10.5).text_color(t.muted).cursor_pointer()
              .hover(el => el.text_color(t.foreground)).on_click(() => this.showAsks()).child(`View all ${this.asks.length} asks →`))))))
        .when(!groups.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child('No seats are running here yet.')))
        .children((compact ? groups : localGroups).map(group => this.card(group, t, now, compact)))
        .child(div().h(8)))
      .when(!compact, el => el.child(div().px(14).py(9).text_size(9.5).text_color(t.dim).child('Quiet seats stay in view.')));
  }
}
