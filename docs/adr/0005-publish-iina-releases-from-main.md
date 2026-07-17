# Publish IINA releases from main

After CI passes on a merge to `main` that changes distributable plugin files, automatically increment the patch version and `ghVersion`, build a `.iinaplgz` asset, create the GitHub release, and mirror the packaged release contents to `master`. The mirror exists because IINA 1.4.4 checks `master/Info.json` for updates even though it installs the latest `.iinaplgz` asset or falls back to `main`; documentation-only changes run CI without publishing a release.
