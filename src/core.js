const { parse } = require("../vendor/anitomy.js");

const WATCH_THRESHOLD = 0.85;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function validateEpisode(value, total) {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const episode = Number(text);
  if (!Number.isSafeInteger(episode) || (total && episode > total)) return null;
  return episode;
}

function pathParts(value) {
  let path = String(value || "");
  if (path.startsWith("file://")) path = path.slice(7);
  try {
    path = decodeURIComponent(path);
  } catch (_) {}
  const parts = path.split(/[\\/]/).filter(Boolean);
  return {
    filename: parts.pop() || "",
    parent: parts.pop() || "",
  };
}

function meaningfulTitle(title) {
  return title && !/^\s*\d+\s*$/.test(title);
}

function normalizeTitle(title) {
  const normalized = title.normalize ? title.normalize("NFKC") : title;
  return normalized
    .replace(/[._]+/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePlayback(path) {
  const { filename, parent } = pathParts(path);
  if (!filename) return null;

  const file = parse(filename) || {};
  const bare = filename.replace(/\.[^.]+$/, "");
  const numericFilename = /^\d+$/.test(bare) ? Number(bare) : null;
  const folder = !meaningfulTitle(file.title) && parent ? parse(parent) || {} : {};
  const title = normalizeTitle(meaningfulTitle(file.title) ? file.title : folder.title || parent);
  if (!meaningfulTitle(title)) return null;

  const season = positiveInteger(Number(file.season || folder.season));
  const type = String(file.type || folder.type || "").toUpperCase();
  const special = /\b(?:SP|SPECIAL|OVA)\b/i.test(`${filename} ${type}`);
  const localStart = positiveInteger(Number(file.episode?.number)) || positiveInteger(numericFilename);
  const localEnd = positiveInteger(Number(file.episode?.numberAlt)) || localStart;
  const suffix = [season ? `s${season}` : "", special ? type || "special" : ""]
    .filter(Boolean)
    .join(":");

  return {
    seriesKey: `${title.toLowerCase()}${suffix ? `::${suffix}` : ""}`,
    searchTitle: `${title}${season ? ` Season ${season}` : ""}${special ? ` ${type === "OVA" ? "OVA" : "Special"}` : ""}`,
    localStart,
    localEnd,
    range: Boolean(localStart && localEnd && localStart !== localEnd),
    special,
  };
}

function isWatched(position, duration, paused) {
  return !paused && duration > 0 && position / duration >= WATCH_THRESHOLD;
}

function mapEpisode(localEpisode, offset = 0) {
  return positiveInteger(localEpisode - offset);
}

function dateIsSet(date) {
  return Boolean(date && (date.year || date.month || date.day));
}

function datesEqual(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function entrySnapshot(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    status: entry.status,
    progress: entry.progress || 0,
    startedAt: entry.startedAt || null,
    completedAt: entry.completedAt || null,
  };
}

function planSync({ entry, media, run, today }) {
  const total = positiveInteger(media?.episodes);
  const start = positiveInteger(run?.start);
  const target = positiveInteger(run?.end);
  if (!start || !target || start > target || (total && target > total)) {
    return { action: "invalid", reason: "invalid-episode" };
  }

  const before = entrySnapshot(entry);
  const progress = before?.progress || 0;
  if (target <= progress) return { action: "ignore", reason: "replay" };

  const finalEpisode = Boolean(total && target === total);
  const issues = [];
  if (run.range) issues.push({ type: "episode-range", start, end: target });
  if (start > progress + 1) issues.push({ type: "progress-gap", from: progress, to: target });
  if (before?.status === "PAUSED" || before?.status === "DROPPED") {
    issues.push({ type: "resumption", from: before.status });
  }
  const statusConflict = before?.status === "COMPLETED" && !finalEpisode;
  if (statusConflict) issues.push({ type: "status-conflict" });

  let status = before?.status;
  if (finalEpisode) status = "COMPLETED";
  else if (!status || ["PLANNING", "PAUSED", "DROPPED", "COMPLETED"].includes(status)) status = "CURRENT";

  const after = {
    id: before?.id,
    status,
    progress: target,
    startedAt: before?.startedAt || null,
    completedAt: before?.completedAt || null,
  };
  if (start === 1 && !dateIsSet(after.startedAt)) after.startedAt = today;
  if (finalEpisode && !dateIsSet(after.completedAt)) after.completedAt = today;
  if (statusConflict) after.completedAt = null;

  const changes = { progress: target };
  if (after.status !== before?.status) changes.status = after.status;
  if (!datesEqual(after.startedAt, before?.startedAt)) changes.startedAt = after.startedAt;
  if (!datesEqual(after.completedAt, before?.completedAt)) changes.completedAt = after.completedAt;

  return { action: "mutate", before, after, changes, issues, finalEpisode };
}

function firstPendingRun(progress, items) {
  const candidates = items
    .filter((item) => item.start && item.end && item.end > progress)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!candidates.length) return null;

  const first = candidates[0];
  const run = {
    start: first.start,
    end: first.end,
    range: Boolean(first.range),
    ids: [first.id],
  };
  for (const item of candidates.slice(1)) {
    if (item.start > run.end + 1) break;
    run.end = Math.max(run.end, item.end);
    run.range ||= Boolean(item.range);
    run.ids.push(item.id);
  }
  return run;
}

function sameEntryState(left, right) {
  const owned = (entry) => {
    const snapshot = entrySnapshot(entry);
    if (!snapshot) return null;
    delete snapshot.id;
    return snapshot;
  };
  return JSON.stringify(owned(left)) === JSON.stringify(owned(right));
}

module.exports = {
  WATCH_THRESHOLD,
  entrySnapshot,
  firstPendingRun,
  isWatched,
  mapEpisode,
  parsePlayback,
  planSync,
  sameEntryState,
  validateEpisode,
};
