# AniList Sync for IINA

AniList Sync marks anime episodes on your AniList account after a local video reaches 85% in [IINA](https://iina.io/). Filename parsing stays on your Mac. The plugin asks you to confirm a title once, then reuses that match for later episodes.

## Requirements

- IINA 1.4.0 or newer
- An AniList account
- Local video playback; web URLs are ignored

IINA 1.5.0 compatibility checks cover playback event ordering, module startup, HTTP request encoding, Keychain method lookup, and plugin packaging.

## Install and connect

Open the latest `.iinaplgz` release with IINA, or install the GitHub repository from IINA's plugin settings. Open **Plugin → AniList Sync → Open AniList Sync**, choose **Open AniList authorization**, approve access, and paste the token AniList shows.

The release workflow requires an AniList OAuth client ID in the repository variable `ANILIST_CLIENT_ID`. Register an AniList API client with this redirect URL:

```text
https://anilist.co/api/v2/oauth/pin
```

Source checkouts include the public AniList client ID. To use a different OAuth client, change `preferenceDefaults.anilistClientId` in `Info.json`, then link the directory:

```sh
iina-plugin link .
```

## Behavior

- Parses common anime filenames, episode ranges, seasons, specials, and numeric filenames in named folders.
- Counts seeking past 85% while playing; paused playback does not count.
- Shows fuzzy AniList candidates and accepts an AniList ID or title URL.
- Supports episode offsets for split cours such as local episode 13 → AniList episode 1.
- Creates missing list entries, advances progress, manages current/completed status, and sets missing start/completion dates when justified.
- Requires confirmation for gaps, ranges, paused/dropped entries, and completed-status conflicts.
- Keeps offline work pending, refreshes AniList state before every write, and serializes updates across IINA windows.
- Never changes scores, notes, repeat counts, custom lists, or other unrelated AniList fields.

Rematching affects future episodes. The plugin separately asks whether progress previously written by it should be moved, and never rewrites past progress automatically.
When a correction would remove an old entry that now contains a score, notes, custom-list membership, or other user-owned data, the plugin leaves that entry in place and explains why.

## Privacy and account safety

Full file paths and filenames are never stored or sent to AniList. Only normalized title searches, AniList IDs, and the list changes you approve reach `https://graphql.anilist.co`.

The access token is stored in macOS Keychain, never in plugin preferences or logs. IINA exposes Keychain read/write but not delete, so disconnect and Full reset overwrite the token with an empty value; an empty Keychain item may remain. Full reset clears all plugin state but does not undo changes already made on AniList.

## Development

The runtime uses vanilla JavaScript and one pinned, vendored parser. No install or build step is needed.

```sh
npm test
node --check src/index.js
node --check src/global.js
```

Architecture decisions and the domain language are in [`docs/adr`](docs/adr) and [`CONTEXT.md`](CONTEXT.md).

On a distributable merge to `main`, GitHub Actions runs the tests, increments the patch and `ghVersion`, and publishes the `.iinaplgz`. It then commits the released metadata to `main` for IINA 1.5.0 update checks and force-updates the generated `master` compatibility mirror for older IINA versions. Set `ANILIST_CLIENT_ID` as a repository variable, allow the workflow to write repository contents and push metadata commits to `main`, and do not protect `master` against that force-push. Documentation-only merges run CI without a release.

## License

Apache-2.0. The vendored `anitomy` package is MIT-licensed; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
