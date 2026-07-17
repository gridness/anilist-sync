# Use Anitomy for filename parsing

Use a pinned, vendored copy of the pure-JavaScript `anitomy` package and its license for best-effort extraction of local anime titles, seasons, episodes, ranges, and release metadata, with project-specific validation layered on top. This adds roughly 118 KB to the plugin but avoids both a fragile custom parser and a bundler toolchain for one runtime dependency.
