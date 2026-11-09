# Personal dotfiles

Native Herdr mods live in `dot-config/herdr-app/mods/`; the running app's generated `AGENTS.md`,
`herdr.d.ts` and `gpui-kit.d.ts` under its app home are the current API contract. Read them before mod changes.
Use the user-level frontend-quality skill for visual work. GPUI is native JavaScript, without a DOM or Node APIs.

`seat-agents` and `layouts/seats-main.json` are the existing fallback. The new `herd` mod and `layouts/herd.json`
provide institution cards, nested seat tiles and a needs-you strip. Prompt rules and pure metadata projections live
in `herd/model.mjs`; the asks lane reads the kit's aggregate current-state interface. No model is used. Never bake personal names, paths or secrets
into this public repository. Prompt checks read quiet personal seats. Codex sentence checks also allow working local
Project panes in the selected space; outside pinned panes never qualify for quotes. Both routes exclude Work and
remote terminals and share at most
four attempts per 45 seconds, including refresh and failures, and a 90-second cache. Retain only recognized quotes
in memory; never persist quotes or raw screens. They never send keystrokes or approve a prompt.

Work in a separate worktree. Cross-lab review is required before implementation reaches the default branch.
Use explicit owned paths when staging/committing. Preserve unrelated configurations and the live fallback.
Run the tests and native check below, then inspect `herdr-app status` and a real `herdr-app shot`.
The native check cannot validate deferred UI states. Use a separate Temp `HERDR_APP_HOME` for native QA, never Al's
live window. Create tasks/timers only from init, events or tasks, never render. Keep mutable caches and locks outside
the watched mods tree. The herd follows the focused space (or explicit `props.space` for a scoped pane). Identify
synthetic fixtures plainly and stop only owned fixtures after review. Space membership
and pinned access come from live labels, never private institution names. Non-personal views use metadata only,
without faces or any reader; local liaison cards lead. Test both space scopes with a neutral body, not Work screens.

Artifact metadata comes only from the personal seats kit's `seats info --json` schema v1. `artifacts.mjs` validates
institution identity and local scope; `artifact-reader.mjs` reads the newest committed match of the declared glob and
caches bounded committed PNGs under the application home's `herd-cache/`. Node and Git provide the optional artifact reader; no npm packages or image decoder are required. Keep cache files out of Git. No automatic LFS fetch, shell config parsing in the mod,
uncommitted-image fallback, Work/remote reads or default layout activation. Run the Node checks.

`asks.mjs` validates the read-only `seats asks --to al --all --json` response. No answer, withdrawal or notification
command belongs in this mod. Preserve the last successful list with a stale indicator on refresh failure.

`sentences.mjs` recognizes bounded literal Codex assistant prose. It skips queued input, menus, tool bodies,
credential-like assignments and ambiguous frames. A missing/expired quote stays visibly unavailable; never invent
a summary or derive it from a stale terminal title. Test scope/program/pane changes, read-budget sharing, no quote
persistence, and a real isolated native view. No model, network or additional runtime dependency is used.

<!-- al-stack:project:start -->
## Al-stack project

Project: dotfiles. Profile: general. Status: experimental.

Personal configuration files and native Herdr mods.

`al-stack.toml` records this project's setup and dependencies. Work from the checkout selected for the task; other branches/worktrees are optional history. Use `al-stack register .` once when starting work here. Local registration does not change the project's lifecycle.

Project commands:
- check-herd: `herdr-app check dot-config/herdr-app/mods/herd`
- test-herd: `node --test dot-config/herdr-app/mods/herd/*.test.mjs`
- test-artifacts: `node --test dot-config/herdr-app/mods/herd/artifact-reader.test.mjs`

Declared tools (verify availability in the intended agent):
- herdr-app (cli): `herdr-app`.
- node (cli): `node`.
- git (cli): `git`.

Edit project guidance outside this managed section. Use `al-stack configure` for its fields and `al-stack check .` for setup checks. Run the actual project checks for behavioral validation.
<!-- al-stack:project:end -->
