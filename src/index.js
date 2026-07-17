const { isWatched, parsePlayback } = require("./core.js");

const {
  core,
  event,
  global: globalAPI,
  menu,
  preferences,
  sidebar,
} = iina;

const minimumVersion = [1, 4, 0];
const currentVersion = String(core.getVersion().iina || "0");
const version = currentVersion.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
const compatible = version.some(
  (part, index) => part > minimumVersion[index] && version.slice(0, index).every((value, i) => value === minimumVersion[i]),
) || version.every((part, index) => part === minimumVersion[index]);

const runtime = {
  compatible,
  core,
  currentVersion,
  evaluate,
  globalAPI,
  isWatched,
  menu,
  parsePlayback,
  pollTimer: null,
  preferences,
  sequence: 0,
  session: null,
  sidebar,
  sidebarLoaded: false,
  snapshot: "",
  state: null,
  updateUI,
};

runtime.openItem = menu.item("Open AniList Sync", () => runtime.sidebar.show());
menu.addItem(runtime.openItem);

function send(runtime, action) {
  runtime.globalAPI.postMessage("anilist-sync", action);
}

function updateUI(runtime) {
  if (!runtime.state) return;
  runtime.openItem.title = runtime.state.actionCount
    ? `Open AniList Sync (${runtime.state.actionCount})`
    : "Open AniList Sync";
  runtime.menu.forceUpdate();
  if (runtime.sidebarLoaded) {
    runtime.sidebar.postMessage("state", {
      ...runtime.state,
      compatibilityError: runtime.compatible
        ? ""
        : `AniList Sync requires IINA 1.4.0 or newer (found ${runtime.currentVersion}).`,
    });
  }
}

function pollState(runtime) {
  const raw = runtime.preferences.get("runtimeState");
  if (!raw || raw === runtime.snapshot) return;
  try {
    const nextState = JSON.parse(raw);
    const wasEnabled = runtime.state?.enabled;
    runtime.snapshot = raw;
    runtime.state = nextState;
    runtime.updateUI(runtime);
    if (nextState.enabled && wasEnabled !== true) runtime.evaluate(runtime);
    if (nextState.notice?.id && nextState.notice.id !== runtime.noticeId) {
      if (runtime.noticeId !== undefined && runtime.core.window.loaded) {
        runtime.core.osd(nextState.notice.message);
      }
      runtime.noticeId = nextState.notice.id;
    }
  } catch (_) {
    // The global entry may be between writes; keep the last valid snapshot.
  }
}

function endSession(runtime) {
  if (!runtime.session) return;
  send(runtime, { action: "session-end", sessionId: runtime.session.id });
  runtime.session = null;
}

function detectFile(runtime) {
  endSession(runtime);
  if (!runtime.compatible || runtime.core.status.idle || runtime.core.status.isNetworkResource) return;
  if (!runtime.core.video.tracks.length && !runtime.core.status.videoWidth) return;
  const parsed = runtime.parsePlayback(runtime.core.status.url);
  if (!parsed) return;
  runtime.session = {
    id: `${Date.now().toString(36)}-${++runtime.sequence}`,
    sent: false,
    ...parsed,
  };
  const { sent, ...safeSession } = runtime.session;
  send(runtime, { action: "session", session: safeSession });
  evaluate(runtime);
}

function evaluate(runtime) {
  if (!runtime.session || runtime.session.sent || !runtime.state?.enabled) return;
  if (!runtime.isWatched(
    runtime.core.status.position || 0,
    runtime.core.status.duration || 0,
    runtime.core.status.paused,
  )) return;
  runtime.session.sent = true;
  const { sent, ...item } = runtime.session;
  send(runtime, { action: "watched", item });
}

event.on("iina.window-loaded", () => {
  runtime.sidebar.loadFile("ui/sidebar/index.html");
  runtime.sidebar.onMessage("command", (data) => {
    send(runtime, data);
    if (data?.action === "request-state") {
      runtime.snapshot = "";
      pollState(runtime);
    }
  });
  runtime.sidebarLoaded = true;
  send(runtime, { action: "request-state" });
  pollState(runtime);
  runtime.pollTimer = setInterval(() => {
    pollState(runtime);
    evaluate(runtime);
  }, 250);
  runtime.pollTimer.unref?.();
});
event.on("iina.file-loaded", () => endSession(runtime));
event.on("iina.file-started", () => detectFile(runtime));
event.on("mpv.duration.changed", () => {
  if (!runtime.session) detectFile(runtime);
  evaluate(runtime);
});
event.on("mpv.time-pos.changed", () => evaluate(runtime));
event.on("mpv.pause.changed", () => evaluate(runtime));
event.on("mpv.end-file", () => endSession(runtime));
event.on("iina.window-will-close", () => {
  if (runtime.pollTimer) clearInterval(runtime.pollTimer);
  endSession(runtime);
});
