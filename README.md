# dotfiles
my dotfiles

## new mac

```sh
# homebrew, then everything in the Brewfile
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew bundle --file ~/dotfiles/Brewfile

# link configs into ~ (dot-foo becomes .foo)
cd ~/dotfiles && stow --dotfiles .
```

wezterm is the nightly build from https://github.com/wezterm/wezterm/releases/tag/nightly
herdr: `curl -fsSL https://herdr.dev/install.sh | sh`, then `herdr integration install claude`

## raycast extensions

raycast installs these itself, so they aren't kept here:
color picker, arc, github, brew, visual studio code, kill process
