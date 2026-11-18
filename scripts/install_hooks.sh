#!/bin/bash
# Install the repo's git hooks: a symlink from the hooks folder git reads (.git/hooks, or a worktree's own) to each
# hook in scripts/hooks/, so an edit to the hook in the repo is live at once. Safe to run again.
ROOT="$(git rev-parse --show-toplevel)" || exit 1
HOOKS="$(cd "$ROOT" && git rev-parse --git-path hooks)"
case "$HOOKS" in /*) ;; *) HOOKS="$ROOT/$HOOKS" ;; esac
mkdir -p "$HOOKS"
for h in "$ROOT"/scripts/hooks/*; do
  name="$(basename "$h")"
  chmod +x "$h"
  if [ -e "$HOOKS/$name" ] && [ ! -L "$HOOKS/$name" ]; then
    mv "$HOOKS/$name" "$HOOKS/$name.before_install"
    echo "kept the existing $name as $name.before_install"
  fi
  ln -sfn "$h" "$HOOKS/$name"
  echo "installed $name -> $h"
done
