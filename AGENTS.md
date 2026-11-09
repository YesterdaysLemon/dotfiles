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

`asks.mjs` validates `seats asks --to al --all --open --json`. Clicking any teaser opens the full inbox, grouped by
institution. Explicit operator clicks can answer through an args array, with the owning personal project and
`--from al`. Disable the card while sending. Exit 0 plus the exact stdout ID confirms sent; after any send failure,
read only the owning ledger and require the same ID, Al as answerer and the exact submitted text before showing sent.
An unavailable check keeps a Check delivery action that reads without resending. Test writes only against scratch
fixture ledgers, never real asks. The kit routes notifications.
`answer-runner.mjs` uses Node to preserve arbitrary text; Windows invokes the installed Bash seats script through
Git Bash with an args array, bypassing cmd.exe's multiline restriction. Never interpolate answers into shell code.
Inbox reads allow 120 seconds and show Checking while retaining the last list; send/confirmation helpers allow 90
seconds inside a 100-second exec. Preserve the last list with a stale indicator on refresh failure. Ask evidence uses only explicitly named committed
PNG paths within the owning project, through the existing bounded reader and app-home cache; no writes under mods/.

Question details render a literal Markdown subset: paragraphs, hard line breaks and dash bullets, with no HTML or
active links. Ask evidence supports up to 12 explicitly named committed PNGs. A click opens that ask's loaded
images in an album (arrows/left-right, zoom, Fit, Esc); it waits for the ask's remaining previews before opening.
Album views read only validated cache metadata and start no readers or timers. Test the actual click/key handlers.
While Al uses the live window, never flip its layout or close overlays for verification. Install reviewed files
and let the mod reload; ask through the steward or liaison before requesting a fresh visible copy.

The rough ask terminal card preserves the optional kit `run` path. An explicit Open terminal click validates the
owning personal repository through the kit's read-only `_asks-run-check` gate, HEAD regular-file mode and unchanged working bytes, then opens an ask-ID-labelled tab
in the owning institution's personal space or the current personal space. Never Work or remote. The initial card
supports `.ps1` scripts only: Windows PowerShell on Windows, `pwsh` elsewhere. `script-runner.mjs` rechecks HEAD and
the file digest inside the terminal before launching with inherited stdio and argv, never a shell command string.
No live renewal or real-ask execution in tests; use a harmless committed scratch script. Include the helper in install.

`sentences.mjs` recognizes bounded literal Codex assistant prose. It skips queued input, menus, tool bodies,
credential-like assignments and ambiguous frames. A missing/expired quote stays unavailable on hover only; never invent
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
