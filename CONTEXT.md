# AniList Sync

This context describes how watching anime in IINA affects a viewer's AniList anime list.

## Language

**List Sync**:
Bringing an AniList entry in line with confirmed viewing: create the entry when absent, update progress and lifecycle status, and maintain Viewing Dates. Every other AniList entry field is outside the sync.
_Avoid_: Full sync, metadata sync

**Local Playback**:
Watching a video available to IINA through a filesystem path, including mounted local or network storage. Web streams are outside the initial scope.
_Avoid_: Stream, remote playback

**Series Match**:
A viewer-confirmed association between a series name inferred from local files and one AniList anime. Later episodes carrying the same inferred name inherit the association.
_Avoid_: Automatic match, title guess

**Match Candidate**:
An AniList anime presented as a possible Series Match, identified with titles and release details that distinguish seasons, cours, formats, and specials.
_Avoid_: Search result

**Watched Episode**:
An episode whose unpaused local playback reaches 85% of its duration. Seeking across the threshold counts.
_Avoid_: Completed episode

**Progress Gap**:
A Watched Episode whose List Episode Number is more than one above the AniList entry's List Progress. Advancing across the gap requires viewer confirmation.
_Avoid_: Skipped episode

**Replay**:
Watching an episode whose List Episode Number is at or below the AniList entry's List Progress. A replay does not change the entry in the initial product.
_Avoid_: Rewatch

**Resumption**:
Returning a paused or dropped AniList entry after further viewing. It requires viewer confirmation and changes status and progress together, ending as completed rather than current when the known final episode was watched.
_Avoid_: Restart

**Episode Identification**:
Determining a Local Episode Number or Episode Range from a local file using best-effort inference. When no reliable result emerges, the viewer selects a List Episode Number manually.
_Avoid_: Episode guess

**List Progress**:
The highest episode number recorded on the viewer's AniList entry. It is distinct from the title's total number of episodes.
_Avoid_: User episode count, current episode count

**Local Episode Number**:
The positive integer inferred from a local file. It may continue across split parts even when AniList restarts numbering.
_Avoid_: Episode count

**List Episode Number**:
The positive integer identifying an episode within the matched AniList title. It cannot exceed the title's Episode Total when that total is known.
_Avoid_: Local Episode Number, episode count

**Episode Offset**:
A viewer-confirmed mapping between Local Episode Numbers and List Episode Numbers for one Series Match.
_Avoid_: Automatic renumbering

**Next Episode**:
The List Episode Number exactly one higher than the viewer's List Progress.
_Avoid_: Current episode

**Episode Total**:
The final number of episodes AniList reports for a title. The total may be unknown, especially while a title is airing.
_Avoid_: List Progress, episode count

**Single-Episode Title**:
An AniList title whose Episode Total is one. Its local playback corresponds to List Episode Number 1 even when the filename has no Local Episode Number.
_Avoid_: Movie

**Episode Range**:
A contiguous sequence of Local Episode Numbers contained in one local file. It is distinct from a Progress Gap, which describes missing progress outside the file.
_Avoid_: Progress Gap

**Special Title**:
A local title explicitly marked as a special or OVA and matched independently from its main series.
_Avoid_: Special episode

**Series Key**:
The normalized local series identity used to remember a Series Match. It retains season and special markers, may use a parent-folder name when the filename lacks a title, and excludes the original path and release-group differences.
_Avoid_: Filename, folder mapping, path

**Rematch**:
Replacing the Series Match for a Series Key. It affects future syncs by default; changing progress previously written through the old match is a separate viewer-confirmed action.
_Avoid_: Automatic rollback

**Sync Record**:
The before-and-after AniList state associated with one successful List Sync. It provides the evidence needed to explain or correct a past change.
_Avoid_: Log entry

**Correction Conflict**:
A past correction where the current AniList state differs from the state last written by the plugin. Resolving it requires the viewer to choose an explicit target state.
_Avoid_: Automatic rollback

**Protected Old Entry**:
An entry a past correction cannot remove because it contains a score, notes, custom-list membership, or other data outside List Sync ownership. The correction updates the new title first, then leaves the old entry for the viewer to manage without data loss.
_Avoid_: Failed cleanup

**AniList Connection**:
The viewer's authorization for the plugin to read and change their AniList account. It ends when the authorization expires, is revoked, or is replaced.
_Avoid_: Login

**Connected Account**:
The single AniList account currently associated with the plugin's Series Matches and Sync Records. Reauthorizing the same account preserves local state; switching accounts clears matches, exclusions, pending work, and history before starting a new sync context.
_Avoid_: Profile

**Pending Sync**:
A List Sync that has not reached AniList because the AniList Connection, service, or network was unavailable. It remains pending until reconciled with the account's fresh AniList state.
_Avoid_: Failed sync

**Pending Sequence**:
A contiguous run of Watched Episodes awaiting List Sync. Reconciliation may advance to its highest episode without treating the intermediate episodes as a Progress Gap.
_Avoid_: Progress Gap

**Sync Notice**:
A brief, non-actionable confirmation that a List Sync succeeded.
_Avoid_: Alert, confirmation

**Pending Confirmation**:
A proposed List Sync waiting for a required viewer decision, such as a Series Match, Progress Gap, or Resumption. It is distinct from a Pending Sync caused by service availability.
_Avoid_: Pending Sync

**Discarded Sync**:
A proposed or pending List Sync the viewer explicitly chose to remove without changing AniList.
_Avoid_: Dismissed sync, failed sync

**Sync Pause**:
A viewer-requested suspension of new tracking and AniList writes that preserves the AniList Connection, matches, history, and pending work. Resuming evaluates the current Playback Session, including playback already above the watched threshold.
_Avoid_: Disconnect, Plugin Reset

**Ignored Series**:
A Series Key explicitly excluded by the viewer from matching, prompts, and List Sync until the exclusion is removed.
_Avoid_: Unmatched series

**Plugin Reset**:
Removing all local plugin state, including the AniList Connection, Series Matches, exclusions, pending work, Sync Records, and preferences. It does not change entries already stored by AniList.
_Avoid_: Clear sync history

**Playback Session**:
Playback of one local file in one IINA player window. Multiple Playback Sessions may coexist and contribute Watched Episodes.
_Avoid_: Player

**Viewing Dates**:
The AniList start date established when episode 1 first moves an entry to current, and the completion date established by watching a known final episode. Existing dates remain authoritative, except that resolving a Status Conflict may explicitly clear a stale completion date with viewer confirmation.
_Avoid_: Sync date

**Repeat Cycle**:
Viewing an entry AniList marks as repeating. Repeat Cycles are outside the initial product and do not change progress, repeat count, status, or Viewing Dates.
_Avoid_: Replay

**Status Conflict**:
An AniList entry marked completed even though its List Progress is below its known Episode Total. Resolving it requires viewer confirmation before status and progress are changed together.
_Avoid_: Completed entry
