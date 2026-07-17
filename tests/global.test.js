const test = require("node:test");
const assert = require("node:assert/strict");

test("full reset clears persisted state and overwrites the Keychain token", async () => {
  const callbacks = {};
  const snapshots = [];
  let keychain = "stored-token";
  let persisted = JSON.stringify({
    schema: 1,
    enabled: true,
    account: { id: 1, name: "Viewer" },
    matches: { show: { mediaId: 4, title: "Show", offset: 0 } },
    ignored: { other: "Other" },
    pending: [{ id: "pending", seriesKey: "show" }],
    confirmations: {},
    corrections: [],
    history: [{ id: "record", kind: "sync" }],
  });
  global.iina = {
    console: { error() {} },
    global: {
      onMessage: (name, callback) => (callbacks[name] = callback),
    },
    http: {
      async post(_url, options) {
        if (options.data.query.includes("Viewer")) {
          return { statusCode: 200, data: { data: { Viewer: { id: 1, name: "Viewer" } } } };
        }
        throw new Error("Unexpected request");
      },
    },
    preferences: {
      get: (key) => (key === "state" ? persisted : key === "anilistClientId" ? "123" : ""),
      set: (key, value) => {
        if (key === "state") persisted = value;
        if (key === "runtimeState") snapshots.push(JSON.parse(value));
      },
      sync() {},
    },
    utils: {
      keyChainRead: () => keychain,
      keyChainWrite: (_service, _account, value) => {
        keychain = value;
        return true;
      },
      open() {},
    },
  };

  const path = require.resolve("../src/global.js");
  delete require.cache[path];
  require(path);
  callbacks["anilist-sync"]({ action: "reset" }, "player");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const last = snapshots.at(-1);
  assert.equal(keychain, "");
  assert.equal(persisted, "");
  assert.equal(last.connected, false);
  assert.deepEqual(last.matches, []);
  assert.deepEqual(last.ignored, []);
  assert.deepEqual(last.pending, []);
  assert.deepEqual(last.history, []);
  assert.equal(last.notice, null);
  assert.doesNotMatch(JSON.stringify(snapshots), /stored-token/);

  delete global.iina;
  delete require.cache[path];
});
