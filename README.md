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

## raycast extensions

raycast installs these itself, so they aren't kept here:
color picker, arc, github, brew, visual studio code, kill process
