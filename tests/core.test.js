const test = require("node:test");
const assert = require("node:assert/strict");
const {
  firstPendingRun,
  isWatched,
  mapEpisode,
  parsePlayback,
  planSync,
  validateEpisode,
} = require("../src/core.js");

const today = { year: 2026, month: 7, day: 16 };

test("parses common anime filenames without leaking paths into the result", () => {
  assert.deepEqual(
    parsePlayback("/Anime/Frieren/[SubsPlease] Sousou no Frieren - 03v2 (1080p).mkv"),
    {
      seriesKey: "sousou no frieren",
      searchTitle: "Sousou no Frieren",
      localStart: 3,
      localEnd: 3,
      range: false,
      special: false,
    },
  );
  assert.equal(JSON.stringify(parsePlayback("/private/path/Title - 01.mkv")).includes("private"), false);
});

test("retains seasons, ranges, specials, and parent-folder fallback", () => {
  assert.equal(parsePlayback("/Anime/Frieren S02E03.mkv").seriesKey, "frieren::s2");
  assert.deepEqual(parsePlayback("/Anime/Title - 01-02.mkv").localEnd, 2);
  assert.equal(parsePlayback("/Anime/Title SP01.mkv").special, true);
  assert.match(parsePlayback("/Anime/Title SP01.mkv").searchTitle, /Special|OVA/);
  assert.deepEqual(parsePlayback("/Anime/Frieren Season 2/03.mkv"), {
    seriesKey: "frieren::s2",
    searchTitle: "Frieren Season 2",
    localStart: 3,
    localEnd: 3,
    range: false,
    special: false,
  });
});

test("enforces watched and episode boundaries", () => {
  assert.equal(isWatched(85, 100, false), true);
  assert.equal(isWatched(99, 100, true), false);
  assert.equal(validateEpisode("6", 12), 6);
  for (const value of ["-1", "0", "1.5", "2x", ""]) assert.equal(validateEpisode(value, 12), null);
  assert.equal(validateEpisode("13", 12), null);
  assert.equal(mapEpisode(13, 12), 1);
});

test("plans normal, final, gap, resume, replay, and conflict transitions", () => {
  assert.deepEqual(
    planSync({ entry: null, media: { episodes: 12 }, run: { start: 1, end: 1 }, today }).after,
    { id: undefined, status: "CURRENT", progress: 1, startedAt: today, completedAt: null },
  );

  const movie = planSync({ entry: null, media: { episodes: 1 }, run: { start: 1, end: 1 }, today });
  assert.equal(movie.after.status, "COMPLETED");
  assert.deepEqual(movie.after.completedAt, today);

  const unknownTotal = planSync({
    entry: { id: 1, status: "CURRENT", progress: 11 },
    media: { episodes: null },
    run: { start: 12, end: 12 },
    today,
  });
  assert.equal(unknownTotal.after.status, "CURRENT");
  assert.equal(unknownTotal.after.completedAt, null);

  const gap = planSync({
    entry: { id: 1, status: "CURRENT", progress: 2 },
    media: { episodes: 12 },
    run: { start: 5, end: 5 },
    today,
  });
  assert.deepEqual(gap.issues.map(({ type }) => type), ["progress-gap"]);

  const resumedFinal = planSync({
    entry: { id: 1, status: "DROPPED", progress: 11 },
    media: { episodes: 12 },
    run: { start: 12, end: 12 },
    today,
  });
  assert.equal(resumedFinal.after.status, "COMPLETED");
  assert.deepEqual(resumedFinal.issues.map(({ type }) => type), ["resumption"]);

  assert.equal(
    planSync({
      entry: { id: 1, status: "CURRENT", progress: 5 },
      media: { episodes: 12 },
      run: { start: 3, end: 3 },
      today,
    }).reason,
    "replay",
  );
  const repeating = planSync({
    entry: { id: 1, status: "REPEATING", progress: 2 },
    media: { episodes: 12 },
    run: { start: 3, end: 3 },
    today,
  });
  assert.equal(repeating.action, "mutate");
  assert.equal(repeating.after.status, "REPEATING");
  assert.deepEqual(repeating.changes, { progress: 3 });

  const conflict = planSync({
    entry: {
      id: 1,
      status: "COMPLETED",
      progress: 5,
      completedAt: { year: 2025, month: 1, day: 1 },
    },
    media: { episodes: 12 },
    run: { start: 6, end: 6 },
    today,
  });
  assert.equal(conflict.after.status, "CURRENT");
  assert.equal(conflict.after.completedAt, null);
  assert.deepEqual(conflict.issues.map(({ type }) => type), ["status-conflict"]);
});

test("collapses only contiguous pending episodes", () => {
  const items = [
    { id: "3", start: 3, end: 3 },
    { id: "4", start: 4, end: 4 },
    { id: "6", start: 6, end: 6 },
  ];
  assert.deepEqual(firstPendingRun(2, items), {
    start: 3,
    end: 4,
    range: false,
    ids: ["3", "4"],
  });
});
