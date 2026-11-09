# Personal dotfiles

Native Herdr mods live in `dot-config/herdr-app/mods/`; the running app's generated `AGENTS.md`,
`herdr.d.ts` and `gpui-kit.d.ts` under its app home are the current API contract. Read them before mod changes.
Use the user-level frontend-quality skill for visual work. GPUI is native JavaScript, without a DOM or Node APIs.

`seat-agents` and `layouts/seats-main.json` are the existing fallback. The new `herd` mod and `layouts/herd.json`
provide institution cards, nested seat tiles and a needs-you strip. Prompt rules and pure metadata projections live
in `herd/model.mjs`; the asks lane is a phase-1 stub. No model is used. Never bake personal names, paths or secrets
into this public repository. Screen checks exclude Work, remote terminals and working seats; reads are cached and
retain only a recognized quote. They never send keystrokes or approve a prompt.

Work in a separate worktree. Cross-lab review is required before implementation reaches the default branch.
Use explicit owned paths when staging/committing. Preserve unrelated configurations and the live fallback.
Run the tests and native check below, then inspect `herdr-app status` and a real `herdr-app shot`.
The native check cannot validate deferred UI states. The herd follows the focused space (or explicit `props.space`
for a scoped pane). Identify synthetic fixtures plainly and restore the prior layout after review. Space membership
and pinned access come from live labels, never private institution names. Non-personal views use metadata only,
without faces or any reader; local liaison cards lead. Test both space scopes with a neutral body, not Work screens.

<!-- al-stack:project:start -->
## Al-stack project

Project: dotfiles. Profile: general. Status: experimental.

Personal configuration files and native Herdr mods.

`al-stack.toml` records this project's setup and dependencies. Work from the checkout selected for the task; other branches/worktrees are optional history. Use `al-stack register .` once when starting work here. Local registration does not change the project's lifecycle.

Project commands:
- check-herd: `herdr-app check dot-config/herdr-app/mods/herd`
- test-herd: `node --test dot-config/herdr-app/mods/herd/*.test.mjs`

Declared tools (verify availability in the intended agent):
- herdr-app (cli): `herdr-app`.
- node (cli): `node`.

Edit project guidance outside this managed section. Use `al-stack configure` for its fields and `al-stack check .` for setup checks. Run the actual project checks for behavioral validation.
<!-- al-stack:project:end -->
