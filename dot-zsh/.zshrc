# homebrew
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"

# user-level tools (claude, herdr, ...) first, then the wezterm and vs code clis
typeset -U path
path=("$HOME/.local/bin" $path)
[ -d /Applications/WezTerm.app/Contents/MacOS ] && path+=(/Applications/WezTerm.app/Contents/MacOS)
[ -d "/Applications/Visual Studio Code.app/Contents/Resources/app/bin" ] && path+=("/Applications/Visual Studio Code.app/Contents/Resources/app/bin")

# set directory for zinit and plugins
ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"

# download zinit if it's not there yet
if [ ! -d "$ZINIT_HOME" ]; then
   mkdir -p "$(dirname $ZINIT_HOME)"
   git clone https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
fi

# source/load zinit
source "${ZINIT_HOME}/zinit.zsh"

# completions (compinit has to run before fzf-tab)
zinit light zsh-users/zsh-completions
autoload -Uz compinit && compinit
zinit cdreplay -q

# zsh plugins (fzf-tab right after compinit, syntax highlighting last)
zinit light Aloxaf/fzf-tab
zinit light zsh-users/zsh-autosuggestions
zinit light zsh-users/zsh-syntax-highlighting

# keybindings
bindkey -e
autoload -U up-line-or-beginning-search down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
bindkey '^[[A' up-line-or-beginning-search
bindkey '^[[B' down-line-or-beginning-search
bindkey '^p' up-line-or-beginning-search
bindkey '^n' down-line-or-beginning-search

# history
HISTSIZE=5000
HISTFILE="${ZDOTDIR:-$HOME}/.zsh_history"
SAVEHIST=$HISTSIZE
HISTDUP=erase
setopt appendhistory
setopt sharehistory
setopt hist_ignore_space
setopt hist_ignore_all_dups
setopt hist_save_no_dups
setopt hist_ignore_dups
setopt hist_find_no_dups

# completion styling
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
zstyle ':completion:*' menu no
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'ls --color $realpath'
zstyle ':fzf-tab:complete:__zoxide_z:*' fzf-preview 'ls --color $realpath'

# aliases
alias ls='ls --color'
alias ll='ls --color -lhat'

alias ..='cd ..'
alias ...='cd ../../'
alias ....='cd ../../../'

command -v eza >/dev/null && alias ll='eza -lah --icons=auto --git' && alias lt='eza --tree --level=2 --icons=auto'

command -v nvim >/dev/null && alias vim='nvim' && export EDITOR=nvim
command -v lazygit >/dev/null && alias lg='lazygit'

command -v darwin-rebuild >/dev/null && alias switch='darwin-rebuild switch --flake "$(readlink -f ~/.config/nix)#macbook"'

# claude
alias c='claude'
alias cn='claude --continue'
alias cr='claude --resume'

# fzf: ctrl-r history, ctrl-t files, alt-c cd (gruvbox colors)
export FZF_DEFAULT_OPTS="--height 40% --layout=reverse --border=rounded \
--color=fg:#bdae93,fg+:#ebdbb2,bg+:#3c3836,hl:#83a598,hl+:#83a598 \
--color=info:#fabd2f,prompt:#fabd2f,pointer:#8ec07c,marker:#8ec07c,spinner:#8ec07c,header:#83a598,border:#504945"
command -v fzf >/dev/null && source <(fzf --zsh)

# herdr: workspace manager for coding agents (prefix ctrl+b)
command -v herdr >/dev/null && source <(herdr completion zsh)

# zoxide: `z foo` jumps to the folder you use most that matches foo
command -v zoxide >/dev/null && eval "$(zoxide init zsh)"

# starship
eval "$(starship init zsh)"
