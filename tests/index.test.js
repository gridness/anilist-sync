const test = require("node:test");
const assert = require("node:assert/strict");

test("player adapter tracks only local video and never sends its path", (t) => {
  const events = {};
  const sidebarMessages = {};
  const sent = [];
  const confirmations = [];
  let confirmed = false;
  let timerTick;
  t.mock.method(global, "setInterval", (callback) => {
    timerTick = callback;
    return { unref() {} };
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
      getVersion: () => ({ iina: "1.4.0" }),
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
  assert.equal(sent.length, 0);
  events["iina.window-loaded"]();
  assert.equal(typeof sidebarMessages.command, "function");
  assert.equal(sent[0].data.action, "request-state");
  sidebarMessages.command({ action: "reset", confirmation: "Reset everything?" });
  assert.deepEqual(confirmations, ["Reset everything?"]);
  assert.equal(sent.some((item) => item.data.action === "reset"), false);
  confirmed = true;
  sidebarMessages.command({ action: "reset", confirmation: "Reset everything?" });
  assert.deepEqual(sent.at(-1).data, { action: "reset" });
  events["iina.file-started"]();

  const session = sent.find((item) => item.data.action === "session").data.session;
  assert.equal(session.searchTitle, "Frieren");
  assert.equal(session.localStart, 7);
  assert.doesNotMatch(JSON.stringify(session), /private|SubsPlease|\.mkv/);

  status.position = 900;
  status.paused = true;
  events["mpv.time-pos.changed"]();
  assert.equal(sent.filter((item) => item.data.action === "watched").length, 0);
  status.paused = false;
  timerTick();
  assert.equal(sent.filter((item) => item.data.action === "watched").length, 1);

  events["iina.window-will-close"]();
  delete global.iina;
  delete require.cache[path];
});
