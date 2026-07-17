# Coordinate syncs in IINA's global entry

Each player window reports its Playback Session to the plugin's global entry, which owns pending work and serializes fresh-state AniList writes per title. This adds coordination to an otherwise small plugin but prevents duplicate or conflicting updates when multiple IINA windows play simultaneously.
