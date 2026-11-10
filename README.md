# dotfiles
my dotfiles

## new mac

```sh
# homebrew, then everything in the Brewfile
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew bundle --file ~/dotfiles/Brewfile

# link configs into ~ (dot-foo becomes .foo)
cd ~/dotfiles && stow --dotfiles .

# the herdr app's layout and panel (see below)
scripts/herdr-app.sh
```

wezterm is the nightly build from https://github.com/wezterm/wezterm/releases/tag/nightly
herdr: `curl -fsSL https://herdr.dev/install.sh | sh`, then `herdr integration install claude`

## herdr app (macOS and Windows)

The herdr GUI (`herdr-app`) keeps its home in `~/.config/herdr-app`, alongside files it writes itself. Only mine live
here, under `dot-config/herdr-app/`: `settings.json`, `keys.json`, the `seats-main` layout and the `seat-agents` panel
(the agents list with one header per seats institution, and rows that read "role · name"). Stow skips that folder;
place it with:

```sh
scripts/herdr-app.sh           # link (macOS) or copy (Windows) the files, then show the seats-main layout;
                               # herd's files are always copied (the app refuses linked modules), so re-run after pulling
scripts/herdr-app.sh capture   # copy in-app changes to copied files back here (all on Windows, herd's everywhere)
```

It's safe to re-run. A different existing file is kept beside its replacement as `*.before-dotfiles`. On Windows, run
it from Git Bash.

The optional **herd** layout puts institutions first: a card for each institution, with familiar faces, names and
roles, current state and time in that state. Quiet seats stay visible. The needs-you strip shows recognized folder
trust and command approval menus alongside open asks. Clicking a seat or prompt opens its terminal; review
and confirm there yourself. The mod never approves anything or sends keystrokes.
While a recognized prompt is current, its seat and institution count as **Needs you**, even if the program has
reported no status. A small screen label and tooltip distinguish that observation from the program's own report.

The herd follows the selected space, using live space IDs and seat labels. Its liaison card comes first; pinned
seats from another space stay reachable above the cards. Work uses labels, state, observed time and any self-reported
terminal metadata only. It shows no familiar faces and runs no metadata, Git, artifact, screen or model readers.
Personal previews, prompt checks and asks are active only in a personal space. No institution names are built in.

**Pin** on a seat or institution adds a compact shortcut below Needs you, ahead of the scrolling herd. **Unpin**
removes it without changing terminal focus. Pins are saved in Herdr's shared state and keep their insertion order;
clicking a shortcut resolves and opens the current terminal. A front-desk pin follows the institution's configured
conductor, including role renames. Other seat pins follow the kit's ordered `renames` metadata after the point the
pin was made, so a reused role name cannot redirect an old pin. That rename field requires a kit version which
provides it; absent history still supports same-role rotation. Missing or ambiguous targets stay removable and
never open an old terminal. Compact widths retain the shortcuts and Unpin controls. These personal pins do not
appear in Work views or add screen, artifact or remote readers. Off-space pins refresh curated personal institution
metadata only. Native terminal pins remain separate and expire with their terminal.

Each institution has a **Grid** button. It opens its seats as native tiles in that institution's tab: familiar,
name and role, state and observed time, and a sourced sentence when available. Quiet seats remain visible and state
changes do not reorder the tiles. Equal tiles fill the pane with small gutters and highlight on hover.
Click a tile to show only that terminal, zoomed; Grid in the sidebar brings the same tiles back.
**Terminals** restores the previous focus, zoom and split layout, removing only the extra grid pane. No terminal
is recreated or stopped. Grid copies reuse the sidebar's in-memory facts and start no readers. Work grids show
metadata without faces or screen quotes. The ordinary seats-main layout remains the fallback.
Switching to seats-main removes the temporary grid panes and returns to the real terminals. It keeps terminal
processes and IDs; the explicit Terminals button also restores the saved zoom and split layout.

The installer includes it while keeping `seats-main` as the default. To try it after installation:

```sh
herdr-app check ~/.config/herdr-app/mods/herd
herdr-app do layout.switch --name herd
# back to the existing sidebar:
herdr-app do layout.switch --name seats-main
```

Prompt checks are local, only for quiet/waiting personal seats under `~/Project`; `~/Work`, remote terminals and
working seats are excluded from prompt checks. Prompt checks and Codex quotes share at most four screen-read
attempts per 45 seconds, cached for 90 seconds; failed attempts and refresh clicks use that same budget.
Only a recognized quote is retained in memory. Unrecognized prompts can be missed; the strip is not an all-clear.
`herd.screenRoots` in local mod shared state can add personal roots, while Work stays excluded. Model summaries
remain a later phase. Run the pure scope/grouping/prompt tests with
`node --test dot-config/herdr-app/mods/herd/*.test.mjs`.

Codex tiles can show one literal sentence from visible assistant prose, with a screen label and the age of its
check. This rule-based route also reads working Codex panes, only in the selected personal space under `~/Project`.
It recognizes a conservative top-level prose format and leaves tool-only screens, queued input, menus and ambiguous
frames unquoted. Quotes are capped at 160 characters and kept only in memory; a changed program, folder, pane or
space invalidates them, and they expire after 90 seconds. State continues to come from Herdr and recognized prompts.
No model is used. The rules can miss progress text, so an unavailable quote is not an all-clear.

Institutions can opt into an artifact thumbnail by committing a repo-relative image glob in their tracked
`seats.conf`, for example `SEATS_ARTIFACT='renders/approved/*.png'`. The personal seats kit's `seats info --json`
interface is the only config parser. The herd view caches that metadata, watches its config directory, and uses a
slow polling fallback. Work and remote institutions deliberately retain their live label/state view, without
metadata, Git or image reads. No key, an unavailable metadata command, or an uncommitted config means no thumbnail.

The latest artifact is the newest commit touching the declared selection, with a stable lexical tie break for
multiple images in that commit. Its card shows a content-keyed preview and commit provenance; click it for a larger
preview. The institution owns the declaration's approval meaning. The view neither guesses from modification
times nor independently approves an image. Missing/deleted images and absent local Git LFS data leave an empty slot;
the reader never downloads or hydrates LFS objects.

The optional reader uses Node and Git, with no npm packages or image decoder. This first version accepts PNG
showcase globs. It checks the PNG header's dimensions, caps source files at 16 MiB and 32 million pixels, and
lets GPUI scale the original committed PNG. The application home's `herd-cache/` holds at most 24 copies and 12 MiB; images that
cannot fit leave the slot empty. Concurrent writers use a bounded process lock outside the watched mod tree and atomic file replacement.
Cache misses and hits change no mod asset or directory, so they cannot trigger a reload loop.
Test it with `node --test dot-config/herdr-app/mods/herd/artifact-reader.test.mjs`.
Git must support `--no-lazy-fetch` (verified here with Git 2.51); unsupported versions leave the slot empty instead
of allowing a partial clone to fetch image objects implicitly.

The asks lane reads `seats asks --to al --all --open --json` from a personal institution, using the kit's configured
routes. Any teaser opens the complete inbox, grouped by institution, with options, recommendations and what waits
on each answer. Card headers show the current personal asker's familiar and name from live seat metadata, with an
initial when the holder is missing or ambiguous. Work and remote seats provide no faces. Click an option, optionally
adding a note, or send a free answer. Each explicit click runs one args-array
`seats answer` call as Al in the owning personal project; the kit records and routes it to the asker. The card stays
disabled while sending. Exit 0 and the matching ask ID show Sent. After a failed receipt, the owning ledger confirms
the exact ID, Al as answerer and the submitted text; an unavailable check offers Check delivery without resending.
Answering requires Node; on Windows the launcher passes arguments to the installed Bash seats script through Git Bash,
so multiline notes and shell metacharacters remain literal. Missing owner metadata leaves the ask read-only.
Named committed PNGs appear inline through the same bounded app-home cache, with no writes under mods. Work stays out.
Question details preserve paragraphs, hard line breaks and dash bullets as plain text, with no HTML or active links.
Click an image for its ask's album (up to 12 named committed PNGs): arrows or left/right keys change images, plus/minus
zoom, Fit resets, and Esc closes. The album uses existing cached previews and starts no new readers.
Slow refreshes show Checking and retain the last list for up to 120 seconds; a failed refresh marks it stale.
Confirmed sends disappear across open views; no answers or drafts
are persisted in mod state. Config watchers plus slow polling refresh the per-institution snapshots; they are not globally atomic.

An ask with a committed `.ps1` `run` path gets a plain Open terminal button. It uses the kit's read-only
`_asks-run-check` gate and checks HEAD plus working bytes, then opens a tab labelled with the ask ID in the owning
institution's personal space (or the current personal space). The launcher checks again before running Windows
PowerShell, or `pwsh` on other systems, with inherited terminal input/output. Other suffixes are unsupported in this
first slice. Work/remote spaces, linked paths and modified/uncommitted scripts cannot launch. The launch request
is one encoded argv token, so Herdr's interactive shell preserves its quotes and paths. Running a script does not
answer its ask.

## raycast extensions

raycast installs these itself, so they aren't kept here:
color picker, arc, github, brew, visual studio code, kill process
