#!/usr/bin/env bash
# Herdr app (the GUI, `herdr-app`): put my layout, agents panel, keys and settings in its home, and show the layout.
#
#   scripts/herdr-app.sh           install: link (macOS/Linux) or copy (Windows) the files, then show seats-main
#   scripts/herdr-app.sh capture   Windows: copy the live files back here after changing them in the app
#
# Safe to re-run. The app writes everything else in its home itself (state, generated types, its shipped mods), so
# only these files live here, and stow skips this folder (.stowrc).
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/dot-config/herdr-app"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
layout="seats-main"
files=(settings.json keys.json layouts/seats-main.json mods/seat-agents/main.js mods/seat-agents/mod.json
  layouts/herd.json layouts/herd.svg mods/herd/main.js mods/herd/mod.json mods/herd/model.mjs
  mods/herd/artifacts.mjs mods/herd/artifact-reader.mjs mods/herd/spaces.mjs mods/herd/asks.mjs mods/herd/answer-runner.mjs mods/herd/sentences.mjs mods/herd/script-runner.mjs mods/herd/ask-text.mjs
  mods/herd/grid.mjs mods/herd/facts.mjs mods/herd/grid-exit.mjs mods/herd/pins.mjs)
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) windows=1 ;; *) windows=0 ;; esac
app() { MSYS2_ARG_CONV_EXCL='*' herdr-app "$@"; }

if [[ "${1:-install}" == capture ]]; then
  for f in "${files[@]}"; do [[ -L "$home/$f" ]] || cp "$home/$f" "$src/$f"; done
  git -C "$repo" status --short -- dot-config/herdr-app
  exit 0
fi

for f in "${files[@]}"; do
  mkdir -p "$(dirname "$home/$f")"
  # Keep a different existing file once, beside it, rather than overwriting it silently.
  if [[ -e "$home/$f" && ! -L "$home/$f" ]] && ! cmp -s "$src/$f" "$home/$f"; then cp "$home/$f" "$home/$f.before-dotfiles"; fi
  if ((windows)); then cp "$src/$f" "$home/$f"; else ln -sfn "$src/$f" "$home/$f"; fi
done

# Which layout shows is Herdr's own state (shared.json "layout"), not a setting, so this script picks it:
# live through the running window, otherwise in the state the app reads when it next starts.
if command -v herdr-app >/dev/null 2>&1 && app status >/dev/null 2>&1; then
  for name in seat-agents herd; do
    mod="$home/mods/$name"
    ((windows)) && mod="$(cygpath -w "$mod")" # the app is a Windows program; it can't read Git Bash paths
    app check "$mod" >/dev/null
  done
  app do layout.switch --name "$layout" >/dev/null
  echo "herdr-app: files in place; showing $layout"
else
  if ((windows)); then py="$(command -v python)"; else py="$(command -v python3 || command -v python)"; fi
  "$py" - "$home/shared.json" "$layout" <<'PY'
import json, os, sys
path, name = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
data["layout"] = name
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
PY
  echo "herdr-app: files in place; $layout shows when the app starts"
fi
