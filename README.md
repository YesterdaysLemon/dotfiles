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
scripts/herdr-app.sh           # link (macOS) or copy (Windows) the files, then show the seats-main layout
scripts/herdr-app.sh capture   # Windows only: copy changes made in the app back here
```

It's safe to re-run. A different existing file is kept beside its replacement as `*.before-dotfiles`. On Windows, run
it from Git Bash.

The optional **herd** layout puts institutions first: a card for each institution, with familiar faces, names and
roles, current state and time in that state. Quiet seats stay visible. The needs-you strip shows recognized folder
trust and command approval menus above an asks placeholder. Clicking a seat or prompt opens its terminal; review
and confirm there yourself. The mod never approves anything or sends keystrokes.
While a recognized prompt is current, its seat and institution count as **Needs you**, even if the program has
reported no status. A small screen label and tooltip distinguish that observation from the program's own report.

The herd follows the selected space, using live space IDs and seat labels. Its liaison card comes first; pinned
seats from another space stay reachable above the cards. Work uses labels, state, observed time and any self-reported
terminal metadata only. It shows no familiar faces and runs no metadata, Git, artifact, screen or model readers.
Personal prompt checks are active only in a personal space. No institution names are built in.


The installer includes it while keeping `seats-main` as the default. To try it after installation:

```sh
herdr-app check ~/.config/herdr-app/mods/herd
herdr-app do layout.switch --name herd
# back to the existing sidebar:
herdr-app do layout.switch --name seats-main
```

Prompt checks are local, only for quiet/waiting personal seats under `~/Project`; `~/Work`, remote terminals and
working seats are excluded. At most four current screens are checked every 45 seconds, cached for 90 seconds.
Only a recognized quote is retained in memory. Unrecognized prompts can be missed; the strip is not an all-clear.
`herd.screenRoots` in local mod shared state can add personal roots, while Work stays excluded. The asks ledger,
artifact thumbnails and model summaries are later phases. Run the pure scope/grouping/prompt tests with
`node --test dot-config/herdr-app/mods/herd/*.test.mjs`.

## raycast extensions

raycast installs these itself, so they aren't kept here:
color picker, arc, github, brew, visual studio code, kill process
