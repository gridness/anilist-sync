const test = require("node:test");
const assert = require("node:assert/strict");

function player(t, version = "1.5.0") {
  const events = {};
  const sidebarMessages = {};
  const sent = [];
  const confirmations = [];
  let confirmed = false;
  let timerTick;
  t.mock.method(global, "setInterval", (callback) => {
    timerTick = callback;
    return "iina-timer";
  });
  t.mock.method(global, "clearInterval", () => {});
  const status = {
    idle: false,
    isNetworkResource: false,
    url: "file:///private/Anime/Frieren/%5BSubsPlease%5D%20Frieren%20-%2007.mkv",
    videoWidth: 1920,
    position: 0,
    duration: 1000,
    paused: false,
  };
  global.iina = {
    core: {
      getVersion: () => ({ iina: version }),
      status,
      video: { tracks: [{}] },
      window: { loaded: true },
      osd() {},
    },
    event: { on: (name, callback) => (events[name] = callback) },
    global: {
      postMessage: (name, data) => sent.push({ name, data }),
    },
    menu: {
      item: (title, action) => ({ title, action }),
      addItem() {},
      forceUpdate() {},
    },
    preferences: {
      get: (key) => key === "runtimeState" ? JSON.stringify({ enabled: true, actionCount: 0 }) : "",
    },
    sidebar: {
      show() {},
      loadFile() {
        Object.keys(sidebarMessages).forEach((name) => delete sidebarMessages[name]);
      },
      postMessage() {},
      onMessage: (name, callback) => (sidebarMessages[name] = callback),
    },
    utils: {
      ask(message) {
        confirmations.push(message);
        return confirmed;
      },
    },
  };

  const path = require.resolve("../src/index.js");
  delete require.cache[path];
  require(path);
  t.after(() => {
    delete global.iina;
    delete require.cache[path];
  });
  return {
    events, sidebarMessages, sent, confirmations, status,
    video: global.iina.core.video,
    confirm: () => { confirmed = true; },
    tick: () => timerTick(),
  };
}

test("player adapter tracks only local video and never sends its path", (t) => {
  const { events, sidebarMessages, sent, confirmations, status, confirm, tick } = player(t, "1.4.0");
  assert.equal(sent.length, 0);
  events["iina.window-loaded"]();
  assert.equal(typeof sidebarMessages.command, "function");
  assert.equal(sent[0].data.action, "request-state");
  sidebarMessages.command({ action: "reset", confirmation: "Reset everything?" });
  assert.deepEqual(confirmations, ["Reset everything?"]);
  assert.equal(sent.some((item) => item.data.action === "reset"), false);
  confirm();
  sidebarMessages.command({ action: "reset", confirmation: "Reset everything?" });
  assert.deepEqual(sent.at(-1).data, { action: "reset" });
  events["iina.file-started"]();
  events["iina.file-loaded"]();

  const session = sent.find((item) => item.data.action === "session").data.session;
  assert.equal(session.searchTitle, "Frieren");
  assert.equal(session.localStart, 7);
  assert.doesNotMatch(JSON.stringify(session), /private|SubsPlease|\.mkv/);

  status.position = 900;
  status.paused = true;
  events["mpv.time-pos.changed"]();
  assert.equal(sent.filter((item) => item.data.action === "watched").length, 0);
  status.paused = false;
  tick();
  assert.equal(sent.filter((item) => item.data.action === "watched").length, 1);

  events["iina.window-will-close"]();
});

for (const version of ["1.4.0", "1.5.0"]) {
  for (const durationEvent of ["before", "after", "none"]) {
    test(`IINA ${version} tracks playback with duration event ${durationEvent} file-loaded`, (t) => {
      const { events, sent, status, tick } = player(t, version);
      events["iina.window-loaded"]();
      events["iina.file-started"]();
      if (durationEvent === "before") events["mpv.duration.changed"]();
      events["iina.file-loaded"]();
      if (durationEvent === "after") events["mpv.duration.changed"]();
      status.position = 850;
      events["mpv.time-pos.changed"]();
      tick();
      assert.equal(sent.filter(({ data }) => data.action === "session").length, 1);
      const watched = sent.filter(({ data }) => data.action === "watched");
      assert.equal(watched.length, 1);
      assert.equal(watched[0].data.item.localStart, 7);
    });
  }
}

test("file changes cannot count the previous file's position toward a new episode", (t) => {
  const { events, sent, status, tick } = player(t);
  events["iina.window-loaded"]();
  events["iina.file-started"]();
  events["iina.file-loaded"]();
  status.position = 900;
  events["mpv.time-pos.changed"]();
  const first = sent.find(({ data }) => data.action === "session").data.session;

  status.url = "file:///private/Anime/Frieren/Frieren - 08.mkv";
  events["iina.file-started"]();
  events["mpv.duration.changed"]();
  events["mpv.time-pos.changed"]();
  tick();
  assert.equal(sent.filter(({ data }) => data.action === "session").length, 1);
  assert.equal(sent.filter(({ data }) => data.action === "watched").length, 1);
  assert.deepEqual(sent.at(-1).data, { action: "session-end", sessionId: first.id });

  status.position = 0;
  events["iina.file-loaded"]();
  status.position = 900;
  events["mpv.time-pos.changed"]();
  const watched = sent.filter(({ data }) => data.action === "watched");
  assert.deepEqual(watched.map(({ data }) => data.item.localStart), [7, 8]);
  assert.notEqual(watched[0].data.item.id, watched[1].data.item.id);

  events["mpv.end-file"]();
  events["mpv.duration.changed"]();
  tick();
  assert.equal(sent.filter(({ data }) => data.action === "session").length, 2);
});

test("late video metadata starts tracking only after file-loaded", (t) => {
  const { events, sent, status, video } = player(t);
  events["iina.window-loaded"]();
  status.videoWidth = null;
  video.tracks = [];
  events["iina.file-started"]();
  events["iina.file-loaded"]();
  assert.equal(sent.filter(({ data }) => data.action === "session").length, 0);

  video.tracks = [{}];
  events["mpv.duration.changed"]();
  status.position = 900;
  events["mpv.time-pos.changed"]();
  assert.equal(sent.filter(({ data }) => data.action === "watched").length, 1);
});

for (const resource of ["network", "audio"]) {
  test(`ignores ${resource} playback`, (t) => {
    const { events, sent, status, video, tick } = player(t);
    events["iina.window-loaded"]();
    if (resource === "network") {
      status.isNetworkResource = true;
      status.url = "https://example.com/Frieren - 07.mkv";
    } else {
      status.videoWidth = null;
      video.tracks = [];
    }
    events["iina.file-started"]();
    events["iina.file-loaded"]();
    status.position = 900;
    events["mpv.duration.changed"]();
    tick();
    assert.deepEqual(sent.map(({ data }) => data.action), ["request-state"]);
  });
}
