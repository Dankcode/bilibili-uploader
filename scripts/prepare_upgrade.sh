#!/bin/sh
# Prepare a separate, source-only release from an intact candidate checkout.
set -eu
umask 077

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 CANDIDATE EXPECTED_COMMIT RELEASES_DIRECTORY" >&2
  exit 2
fi
candidate=$(cd "$1" && pwd -P)
expected=$2
mkdir -p -- "$3"
releases=$(cd "$3" && pwd -P)
case "$releases/" in "$candidate/"*) echo 'Release directory must be outside the candidate checkout' >&2; exit 1;; esac
[ -d "$candidate/.git" ] && [ ! -L "$candidate/.git" ] || { echo 'Candidate must have its own .git directory' >&2; exit 1; }
[ ! -e "$candidate/.git/objects/info/alternates" ] || { echo 'Candidate uses external Git objects; use a self-contained checkout' >&2; exit 1; }
[ -z "$(git -C "$candidate" config --get core.worktree || :)" ] || { echo 'Candidate uses an external Git worktree configuration' >&2; exit 1; }
head=$(git -C "$candidate" rev-parse --verify 'HEAD^{commit}')
[ "$head" = "$expected" ] || { echo "Candidate HEAD $head does not match expected full commit $expected" >&2; exit 1; }
[ -z "$(git -C "$candidate" status --porcelain --untracked-files=normal)" ] || { echo 'Candidate has uncommitted or untracked changes' >&2; exit 1; }
[ ! -e "$candidate/.gitmodules" ] || { echo 'Submodule checkouts are not supported' >&2; exit 1; }
release=$(mktemp -d "$releases/manual-candidate-XXXXXX")
echo "Release copy: $release"
# Copy repository metadata and committed files only, excluding host credentials,
# runtime state, ignored build output, and untracked files.
cp -a "$candidate/.git" "$release/.git"
archive=$(mktemp "$releases/.release-source-XXXXXX")
trap 'rm -f "$archive"' EXIT HUP INT TERM
git -C "$candidate" archive "$head" > "$archive"
tar -xf "$archive" -C "$release"
rm -f "$archive"
git -C "$release" -c core.worktree="$release" -c core.hooksPath=/dev/null checkout --quiet --detach "$head"
[ "$(git -C "$release" rev-parse HEAD)" = "$head" ] || { echo 'Release revision mismatch' >&2; exit 1; }
[ -z "$(git -C "$release" status --porcelain --untracked-files=normal)" ] || { echo 'Release copy is not clean' >&2; exit 1; }
printf 'Revision: %s\nShallow: %s\n' "$head" "$(git -C "$release" rev-parse --is-shallow-repository)"
echo 'Source copy prepared only; validate and review the deployment handoff before cutover.'
