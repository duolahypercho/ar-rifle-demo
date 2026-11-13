#!/bin/sh
# Publishes a playable build of the last commit to GitHub Pages (branch gh-pages of origin).
#
#   sh tools/deploy_pages.sh
#
# What it does:
#   1. exports HEAD (the committed files only, so nothing ignored or half-edited goes online),
#   2. builds it with Vite under the site's base path,
#   3. refuses to go on if the build contains this machine's account name,
#   4. writes the build as one commit and force-pushes it to gh-pages (the branch holds only the
#      latest build; models already pushed on main are not uploaded again).
# The site updates only when this script is run: pushing to main does not change it.
#
# BASE is the path the site is served under: /<repository name>/ for a project site.
set -e
BASE=${BASE:-/ar-rifle-demo/}
REMOTE=${REMOTE:-origin}
root=$(git rev-parse --show-toplevel)
cd "$root"
head=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git archive HEAD | tar -x -C "$tmp"
ln -s "$root/node_modules" "$tmp/node_modules"
(cd "$tmp" && npx vite build --base="$BASE" >"$tmp/build.log" 2>&1) || { tail -20 "$tmp/build.log"; exit 1; }
touch "$tmp/dist/.nojekyll"

name=$(id -un)
if grep -r -a -l -e "$name" "$tmp/dist" >/dev/null 2>&1; then
  echo "deploy: the build contains the account name '$name':" >&2
  grep -r -a -l -e "$name" "$tmp/dist" >&2
  exit 1
fi

# one commit holding the build, made with a private index so the working tree and the real index are untouched
export GIT_INDEX_FILE="$tmp/index"
git --work-tree="$tmp/dist" add -A -f .
tree=$(git write-tree)
unset GIT_INDEX_FILE
commit=$(git commit-tree "$tree" -m "Playable build of $head

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>")
git push -f "$REMOTE" "$commit:refs/heads/gh-pages"
echo "deployed build of $head ($(du -sh "$tmp/dist" | cut -f1)) to $REMOTE gh-pages under $BASE"
