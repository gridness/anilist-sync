#!/usr/bin/env bash
set -euo pipefail

manifest="${1:?Pass the packaged Info.json path}"
version="$(jq -er .version "$manifest")"

cp "$manifest" Info.json
package_json="$(jq --arg version "$version" '.version = $version' package.json)"
printf '%s\n' "$package_json" > package.json

if git diff --quiet -- Info.json package.json; then
  exit 0
fi

git -c user.name=github-actions \
  -c user.email=41898282+github-actions[bot]@users.noreply.github.com \
  commit --only -m "chore(release): publish v$version metadata" -- Info.json package.json

for attempt in 1 2 3; do
  git fetch origin main
  git rebase origin/main
  # ASVS 15.4.2: non-force pushes reject concurrent changes to main.
  if git push origin HEAD:refs/heads/main; then
    exit 0
  fi
done

echo "Could not publish release metadata after three attempts" >&2
exit 1
