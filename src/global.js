const { createAniList } = require("./anilist.js");
const {
  entrySnapshot,
  firstPendingRun,
  mapEpisode,
  planSync,
  sameEntryState,
  validateEpisode,
} = require("./core.js");

const {
  console,
  global: globalAPI,
  http,
  preferences,
  utils,
} = iina;

const STATE_KEY = "state";
const RUNTIME_STATE_KEY = "runtimeState";
const KEYCHAIN_SERVICE = "anilist";
const KEYCHAIN_ACCOUNT = "oauth";
const aniList = createAniList(http);

function blankState() {
  return {
    schema: 1,
    enabled: true,
    account: null,
    matches: {},
    ignored: {},
    pending: [],
    confirmations: {},
    corrections: [],
    history: [],
  };
}

let corruptState = false;
let bootError = "";
let state = blankState();
const rawState = preferences.get(STATE_KEY);
if (rawState) {
  try {
    const stored = JSON.parse(rawState);
    if (stored.schema !== 1) throw new Error("Unsupported state version");
    state = { ...blankState(), ...stored };
  } catch (_) {
    corruptState = true;
    state.enabled = false;
    bootError = "Local state is unreadable. Reset the plugin before syncing.";
  }
}

const runtime = {
  sessions: {},
  candidates: {},
  searches: {},
  accountSwitch: null,
  notice: null,
  noticeSequence: 0,
  lastError: bootError,
  generation: 0,
};

function keychainMethod(...names) {
  return names.map((name) => utils[name]).find((method) => typeof method === "function");
}

function readToken() {
  const read = keychainMethod("keyChainRead", "keychainRead");
  const value = read ? read.call(utils, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) : false;
  return typeof value === "string" ? value : "";
}

function writeToken(value) {
  const write = keychainMethod("keyChainWrite", "keychainWrite");
  return Boolean(write && write.call(utils, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, value));
}

let token = readToken();
let connected = false;
let serial = Promise.resolve();

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function mediaTitle(media) {
  return media?.title?.userPreferred || media?.title?.romaji || media?.title?.english || `AniList #${media?.id}`;
}

function saveState() {
  if (corruptState) return;
  preferences.set(STATE_KEY, JSON.stringify(state));
  preferences.sync();
}

function actionCount() {
  const unmatched = new Set(
    Object.values(runtime.sessions)
      .filter((session) => !state.matches[session.seriesKey] && !state.ignored[session.seriesKey])
      .map((session) => session.seriesKey),
  );
  state.pending.forEach((item) => {
    if (!state.matches[item.seriesKey]) unmatched.add(item.seriesKey);
  });
  return (
    unmatched.size +
    Object.keys(state.confirmations).length +
    state.pending.filter((item) => item.needsEpisode || item.error || !connected).length +
    state.corrections.length +
    (runtime.accountSwitch ? 1 : 0)
  );
}

function publicState() {
  return {
    generation: runtime.generation,
    enabled: state.enabled,
    connected,
    account: state.account,
    matches: Object.entries(state.matches).map(([seriesKey, match]) => ({ seriesKey, ...match })),
    ignored: Object.entries(state.ignored).map(([seriesKey, title]) => ({ seriesKey, title })),
    pending: state.pending,
    confirmations: Object.values(state.confirmations),
    corrections: state.corrections,
    history: state.history,
    sessions: Object.values(runtime.sessions),
    candidates: runtime.candidates,
    accountSwitch: runtime.accountSwitch ? { viewer: runtime.accountSwitch.viewer } : null,
    clientConfigured: Boolean(String(preferences.get("anilistClientId") || "").trim()),
    lastError: runtime.lastError,
    actionCount: actionCount(),
    corruptState,
    notice: runtime.notice,
  };
}

function broadcast() {
  preferences.set(RUNTIME_STATE_KEY, JSON.stringify(publicState()));
  preferences.sync();
}

function notice(_player, message) {
  runtime.notice = { id: ++runtime.noticeSequence, message };
  broadcast();
}

function queue(work) {
  serial = serial.then(work, work).catch((error) => {
    runtime.lastError = error?.message || "Unexpected sync failure";
    console.error(runtime.lastError);
    broadcast();
  });
  return serial;
}

function today() {
  const value = new Date();
  return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
}

function ownFields(entry) {
  if (!entry) return null;
  return {
    status: entry.status,
    progress: entry.progress || 0,
    startedAt: entry.startedAt || null,
    completedAt: entry.completedAt || null,
  };
}

function hasUnownedValues(entry) {
  if (!entry) return false;
  if (entry.score || entry.progressVolumes || entry.repeat || entry.priority || entry.private || entry.notes || entry.hiddenFromStatusLists) {
    return true;
  }
  return [entry.customLists, entry.advancedScores].some(
    (values) => values && typeof values === "object" && Object.values(values).some(Boolean),
  );
}

function fingerprint(seriesKey, mediaId, run, plan) {
  return JSON.stringify({
    seriesKey,
    mediaId,
    ids: [...run.ids].sort(),
    before: ownFields(plan.before),
    after: ownFields(plan.after),
    issues: plan.issues.map(({ type }) => type),
  });
}

function removePending(ids) {
  const removed = new Set(ids);
  state.pending = state.pending.filter((item) => !removed.has(item.id));
}

function historyRecord(item, mediaId, before, after, run) {
  return {
    id: id(),
    kind: "sync",
    seriesKey: item.seriesKey,
    mediaId,
    title: state.matches[item.seriesKey]?.title,
    before,
    after,
    localStart: Math.min(...run.items.map((value) => value.localStart || value.manualEpisode || run.start)),
    localEnd: Math.max(...run.items.map((value) => value.localEnd || value.manualEpisode || run.end)),
    listStart: run.start,
    listEnd: run.end,
    at: new Date().toISOString(),
  };
}

function mappedPending(items, match, total) {
  return items.map((item) => {
    let start = item.manualEpisode || mapEpisode(item.localStart, match.offset || 0);
    let end = item.manualEpisode || mapEpisode(item.localEnd, match.offset || 0);
    if (!start && total === 1) start = end = 1;
    if (!start || !end || (total && end > total)) return { ...item, start: null, end: null };
    return { ...item, start, end };
  });
}

async function restoreCorrection(correction, force = false) {
  const records = state.history.filter((record) => correction.recordIds.includes(record.id));
  if (!records.length) {
    state.corrections = state.corrections.filter((item) => item.id !== correction.id);
    return;
  }
  const earliest = records[0];
  const latest = records[records.length - 1];
  const oldMedia = await aniList.media(correction.oldMatch.mediaId, token);
  const current = oldMedia.mediaListEntry;

  if (!earliest.before && hasUnownedValues(current)) {
    correction.status = "protected-data";
    correction.current = entrySnapshot(current);
    correction.error = "The old entry contains AniList fields this plugin never changes, so it was not removed.";
    saveState();
    broadcast();
    return;
  }

  if (!force && !sameEntryState(current, latest.after)) {
    correction.status = "conflict";
    correction.original = earliest.before;
    correction.pluginWritten = latest.after;
    correction.current = entrySnapshot(current);
    saveState();
    broadcast();
    return;
  }

  if (!earliest.before) {
    if (current?.id) await aniList.remove(current.id, token);
  } else {
    await aniList.save(correction.oldMatch.mediaId, ownFields(earliest.before), token);
  }
  state.history.push({
    id: id(),
    kind: "correction",
    seriesKey: correction.seriesKey,
    mediaId: correction.oldMatch.mediaId,
    before: entrySnapshot(current),
    after: earliest.before,
    at: new Date().toISOString(),
  });
  state.corrections = state.corrections.filter((item) => item.id !== correction.id);
  saveState();
  notice(null, "AniList past progress corrected");
}

async function finishCorrections(seriesKey) {
  for (const correction of state.corrections.filter(
    (item) => item.seriesKey === seriesKey && item.status === "syncing-new",
  )) {
    if (state.pending.some((item) => item.correctionId === correction.id)) continue;
    try {
      await restoreCorrection(correction);
    } catch (error) {
      correction.status = "cleanup-error";
      correction.error = error.message;
      saveState();
      broadcast();
    }
  }
}

async function reconcileKey(seriesKey) {
  if (!state.enabled || !connected || !token) return;
  const match = state.matches[seriesKey];
  if (!match) return;

  while (true) {
    const pending = state.pending.filter((item) => item.seriesKey === seriesKey);
    if (!pending.length) {
      await finishCorrections(seriesKey);
      return;
    }

    let media;
    try {
      media = await aniList.media(match.mediaId, token);
    } catch (error) {
      if (error.status === 401) {
        token = "";
        connected = false;
        writeToken("");
      }
      pending.forEach((item) => (item.error = error.message));
      runtime.lastError = error.message;
      saveState();
      broadcast();
      return;
    }

    const total = media.episodes || null;
    const mapped = mappedPending(pending, match, total);
    const progress = media.mediaListEntry?.progress || 0;
    for (const item of mapped.filter((value) => !value.start)) {
      const stored = state.pending.find((value) => value.id === item.id);
      stored.needsEpisode = true;
      stored.suggestedEpisode = Math.min(progress + 1, total || progress + 1);
      stored.maxEpisode = total;
      stored.error = item.localStart ? "Parsed episode is outside this AniList title" : "Choose an episode";
    }
    if (mapped.some((item) => !item.start)) {
      saveState();
      broadcast();
      return;
    }

    const replayed = mapped.filter((item) => item.end && item.end <= progress);
    for (const item of replayed) {
      if (item.attempt && sameEntryState(media.mediaListEntry, item.attempt.after)) {
        state.history.push(historyRecord(item, match.mediaId, item.attempt.before, media.mediaListEntry, {
          start: item.start,
          end: item.end,
          items: [item],
        }));
      }
    }
    removePending(replayed.map((item) => item.id));

    const run = firstPendingRun(progress, mapped);
    if (!run) {
      delete state.confirmations[seriesKey];
      saveState();
      broadcast();
      await finishCorrections(seriesKey);
      return;
    }
    run.items = mapped.filter((item) => run.ids.includes(item.id));
    const plan = planSync({ entry: media.mediaListEntry, media, run, today: today() });
    if (plan.action === "invalid") {
      run.items.forEach((item) => {
        const stored = state.pending.find((value) => value.id === item.id);
        stored.needsEpisode = true;
        stored.maxEpisode = total;
        stored.error = "Choose a valid episode";
      });
      saveState();
      broadcast();
      return;
    }
    if (plan.action === "ignore") {
      removePending(run.ids);
      delete state.confirmations[seriesKey];
      saveState();
      notice(run.items[0]?.player, "Replay ignored");
      continue;
    }
    if (run.items.every((item) => item.correctionId)) {
      plan.issues = plan.issues.filter((issue) => !["episode-range", "progress-gap"].includes(issue.type));
    }

    const proposalFingerprint = fingerprint(seriesKey, match.mediaId, run, plan);
    const confirmation = state.confirmations[seriesKey];
    if (plan.issues.length && !(confirmation?.fingerprint === proposalFingerprint && confirmation.approved)) {
      state.confirmations[seriesKey] = {
        seriesKey,
        title: mediaTitle(media),
        mediaId: match.mediaId,
        run: { start: run.start, end: run.end, ids: run.ids },
        issues: plan.issues,
        before: plan.before,
        after: plan.after,
        fingerprint: proposalFingerprint,
        approved: false,
      };
      saveState();
      broadcast();
      return;
    }

    const attempt = { mediaId: match.mediaId, before: plan.before, after: plan.after, at: new Date().toISOString() };
    run.ids.forEach((itemId) => {
      const item = state.pending.find((value) => value.id === itemId);
      item.attempt = attempt;
      item.error = "";
    });
    saveState();

    try {
      const saved = await aniList.save(match.mediaId, plan.changes, token);
      state.history.push(historyRecord(run.items[0], match.mediaId, plan.before, entrySnapshot(saved), run));
      removePending(run.ids);
      delete state.confirmations[seriesKey];
      runtime.lastError = "";
      saveState();
      broadcast();
      notice(run.items[0]?.player, `AniList: ${mediaTitle(media)} → ${saved.progress}${total ? `/${total}` : ""}`);
      await finishCorrections(seriesKey);
    } catch (error) {
      run.ids.forEach((itemId) => {
        const item = state.pending.find((value) => value.id === itemId);
        item.error = error.message;
      });
      runtime.lastError = error.message;
      if (error.status === 401) {
        token = "";
        connected = false;
        writeToken("");
      }
      saveState();
      broadcast();
      return;
    }
  }
}

function reconcileAll() {
  const keys = [...new Set(state.pending.map((item) => item.seriesKey))];
  return queue(async () => {
    for (const key of keys) await reconcileKey(key);
  });
}

async function searchCandidates(seriesKey, query) {
  const searchId = id();
  const generation = runtime.generation;
  runtime.searches[seriesKey] = searchId;
  try {
    const text = String(query).trim();
    const exact = text.match(/^\d+$/)?.[0] || text.match(/anilist\.co\/anime\/(\d+)/i)?.[1];
    const results = exact
      ? [await aniList.media(Number(exact), token)]
      : await aniList.search(text, connected ? token : "");
    if (runtime.generation !== generation || runtime.searches[seriesKey] !== searchId) return;
    runtime.candidates[seriesKey] = results;
    runtime.lastError = "";
  } catch (error) {
    if (runtime.generation !== generation || runtime.searches[seriesKey] !== searchId) return;
    runtime.candidates[seriesKey] = [];
    runtime.lastError = error.message;
  }
  broadcast();
}

function refreshSessionSearches() {
  Object.values(runtime.sessions).forEach((session) => {
    if (!state.matches[session.seriesKey] && !state.ignored[session.seriesKey]) {
      searchCandidates(session.seriesKey, session.searchTitle);
    }
  });
}

async function acceptToken(candidate) {
  const viewer = await aniList.viewer(candidate);
  if (state.account && state.account.id !== viewer.id) {
    runtime.accountSwitch = { viewer, token: candidate };
    broadcast();
    return;
  }
  if (!writeToken(candidate)) throw new Error("Could not store AniList token in Keychain");
  token = candidate;
  connected = true;
  state.account = viewer;
  runtime.lastError = "";
  saveState();
  broadcast();
  refreshSessionSearches();
  reconcileAll();
}

function resetAccountState(viewer) {
  const enabled = state.enabled;
  state = blankState();
  state.enabled = enabled;
  state.account = viewer;
  runtime.candidates = {};
  runtime.searches = {};
}

async function setMatch(data) {
  if (!connected) throw new Error("Connect AniList before confirming a match");
  const media = await aniList.media(Number(data.mediaId), token);
  const offset = Number(data.offset || 0);
  if (!Number.isSafeInteger(offset)) throw new Error("Episode offset must be an integer");
  const oldMatch = state.matches[data.seriesKey];
  const newMatch = { mediaId: media.id, title: mediaTitle(media), offset };
  if (oldMatch && oldMatch.mediaId !== newMatch.mediaId) {
    const recordIds = state.history
      .filter(
        (record) =>
          record.kind === "sync" && record.seriesKey === data.seriesKey && record.mediaId === oldMatch.mediaId,
      )
      .map((record) => record.id);
    if (recordIds.length) {
      state.corrections.push({
        id: id(),
        seriesKey: data.seriesKey,
        oldMatch,
        newMatch,
        recordIds,
        status: "offer",
      });
    }
  }
  state.matches[data.seriesKey] = newMatch;
  delete state.ignored[data.seriesKey];
  delete state.confirmations[data.seriesKey];
  saveState();
  broadcast();
  reconcileAll();
}

async function handle(data, player) {
  if (!data?.action) return;
  if (corruptState && data.action !== "reset" && data.action !== "request-state") return broadcast();

  switch (data.action) {
    case "request-state":
      broadcast();
      break;
    case "session": {
      const key = `${player || "player"}:${data.session.id}`;
      runtime.sessions[key] = { ...data.session, player };
      broadcast();
      if (!state.matches[data.session.seriesKey] && !state.ignored[data.session.seriesKey]) {
        searchCandidates(data.session.seriesKey, data.session.searchTitle);
      }
      break;
    }
    case "session-end":
      Object.keys(runtime.sessions).forEach((key) => {
        if (runtime.sessions[key].id === data.sessionId && runtime.sessions[key].player === player) {
          delete runtime.sessions[key];
        }
      });
      broadcast();
      break;
    case "watched":
      if (!state.enabled || state.ignored[data.item.seriesKey]) break;
      if (!state.pending.some((item) => item.sessionId === data.item.sessionId && item.player === player)) {
        state.pending.push({ ...data.item, id: id(), player, watchedAt: new Date().toISOString(), error: "" });
        saveState();
        broadcast();
        reconcileAll();
      }
      break;
    case "search":
      if (String(data.query || "").trim().length >= 2 || /^\d+$/.test(String(data.query || "").trim())) {
        searchCandidates(data.seriesKey, data.query);
      }
      break;
    case "set-match":
      await setMatch(data);
      break;
    case "ignore":
      state.ignored[data.seriesKey] = data.title || data.seriesKey;
      state.pending = state.pending.filter((item) => item.seriesKey !== data.seriesKey);
      delete state.confirmations[data.seriesKey];
      saveState();
      broadcast();
      break;
    case "unignore":
      delete state.ignored[data.seriesKey];
      saveState();
      broadcast();
      break;
    case "set-episode": {
      const item = state.pending.find((value) => value.id === data.id);
      if (!item) break;
      const episode = validateEpisode(data.episode, item.maxEpisode);
      if (!episode) throw new Error("Episode must be a positive integer within the AniList title maximum");
      item.manualEpisode = episode;
      item.needsEpisode = false;
      item.error = "";
      saveState();
      broadcast();
      reconcileAll();
      break;
    }
    case "confirm-sync": {
      const confirmation = state.confirmations[data.seriesKey];
      if (confirmation?.fingerprint === data.fingerprint) {
        confirmation.approved = true;
        saveState();
        reconcileAll();
      }
      break;
    }
    case "discard":
      removePending(data.ids || [data.id]);
      Object.keys(state.confirmations).forEach((key) => {
        if (state.confirmations[key].run.ids.some((item) => (data.ids || [data.id]).includes(item))) {
          delete state.confirmations[key];
        }
      });
      saveState();
      broadcast();
      break;
    case "retry":
      state.pending.forEach((item) => (item.error = ""));
      runtime.lastError = "";
      saveState();
      broadcast();
      reconcileAll();
      break;
    case "toggle":
      state.enabled = Boolean(data.enabled);
      saveState();
      broadcast();
      if (state.enabled) reconcileAll();
      break;
    case "connect": {
      const clientId = String(preferences.get("anilistClientId") || "").trim();
      if (!clientId) throw new Error("AniList client ID is not configured in this build");
      utils.open(`https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`);
      break;
    }
    case "submit-token":
      await acceptToken(String(data.token || "").trim());
      break;
    case "confirm-account-switch":
      if (!runtime.accountSwitch) break;
      if (!writeToken(runtime.accountSwitch.token)) throw new Error("Could not store AniList token in Keychain");
      token = runtime.accountSwitch.token;
      connected = true;
      resetAccountState(runtime.accountSwitch.viewer);
      runtime.accountSwitch = null;
      saveState();
      broadcast();
      refreshSessionSearches();
      break;
    case "cancel-account-switch":
      runtime.accountSwitch = null;
      broadcast();
      break;
    case "disconnect":
      writeToken("");
      token = "";
      connected = false;
      runtime.generation += 1;
      runtime.candidates = {};
      runtime.searches = {};
      broadcast();
      break;
    case "clear-history":
      if (state.corrections.length) throw new Error("Resolve past progress corrections before clearing sync history");
      state.history = [];
      saveState();
      broadcast();
      break;
    case "reset":
      runtime.generation += 1;
      writeToken("");
      token = "";
      connected = false;
      corruptState = false;
      state = blankState();
      runtime.sessions = {};
      runtime.candidates = {};
      runtime.searches = {};
      runtime.accountSwitch = null;
      runtime.lastError = "";
      runtime.notice = null;
      runtime.noticeSequence = 0;
      preferences.set(STATE_KEY, "");
      preferences.sync();
      broadcast();
      break;
    case "keep-past":
      state.corrections = state.corrections.filter((item) => item.id !== data.id);
      saveState();
      broadcast();
      break;
    case "correct-past": {
      const correction = state.corrections.find((item) => item.id === data.id);
      if (!correction) break;
      const records = state.history.filter((record) => correction.recordIds.includes(record.id));
      for (const record of records) {
        state.pending.push({
          id: id(),
          sessionId: `correction:${correction.id}:${record.id}`,
          correctionId: correction.id,
          seriesKey: correction.seriesKey,
          searchTitle: correction.newMatch.title,
          localStart: record.localStart,
          localEnd: record.localEnd,
          range: record.localStart !== record.localEnd,
          watchedAt: record.at,
          error: "",
        });
      }
      correction.status = "syncing-new";
      saveState();
      broadcast();
      reconcileAll();
      break;
    }
    case "resolve-correction": {
      const correction = state.corrections.find((item) => item.id === data.id);
      if (!correction) break;
      if (data.target === "keep-current") {
        state.corrections = state.corrections.filter((item) => item.id !== data.id);
        saveState();
        broadcast();
      } else if (data.target === "original") {
        await restoreCorrection(correction, true);
        broadcast();
      }
      break;
    }
    case "retry-correction": {
      const correction = state.corrections.find((item) => item.id === data.id);
      if (!correction) break;
      correction.status = "syncing-new";
      correction.error = "";
      await finishCorrections(correction.seriesKey);
      broadcast();
      break;
    }
  }
}

globalAPI.onMessage("anilist-sync", (data, player) => {
  queue(async () => {
    try {
      await handle(data, player);
      runtime.lastError = "";
    } catch (error) {
      runtime.lastError = error?.message || "Action failed";
      console.error(runtime.lastError);
      broadcast();
    }
  });
});

broadcast();
if (token) {
  queue(async () => {
    try {
      const viewer = await aniList.viewer(token);
      if (!state.account || state.account.id === viewer.id) {
        state.account = viewer;
        connected = true;
        saveState();
        broadcast();
        refreshSessionSearches();
        reconcileAll();
      } else {
        token = "";
        writeToken("");
        runtime.lastError = "Stored AniList account does not match local state. Reconnect to continue.";
        broadcast();
      }
    } catch (_) {
      token = "";
      connected = false;
      writeToken("");
      runtime.lastError = "AniList connection expired. Reconnect to continue.";
      broadcast();
    }
  });
}
