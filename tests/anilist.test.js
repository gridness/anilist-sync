const test = require("node:test");
const assert = require("node:assert/strict");
const { createAniList } = require("../src/anilist.js");

test("AniList mutations send only owned list fields", async () => {
  const calls = [];
  const http = {
    async post(url, options) {
      calls.push({ url, options });
      return {
        statusCode: 200,
        data: {
          data: {
            SaveMediaListEntry: {
              id: 9,
              status: "CURRENT",
              progress: 3,
              startedAt: null,
              completedAt: null,
            },
          },
        },
      };
    },
  };
  const api = createAniList(http);
  await api.save(42, { status: "CURRENT", progress: 3, completedAt: null }, "secret-token");

  assert.equal(calls[0].url, "https://graphql.anilist.co");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.deepEqual(calls[0].options.data.variables, {
    mediaId: 42,
    status: "CURRENT",
    progress: 3,
    completedAt: { year: null, month: null, day: null },
  });
  assert.doesNotMatch(calls[0].options.data.query, /score|notes|repeat|custom/i);
});

test("AniList client reports GraphQL errors without exposing the token", async () => {
  const api = createAniList({
    async post() {
      return { statusCode: 400, data: { errors: [{ message: "Invalid progress" }] } };
    },
  });
  await assert.rejects(api.viewer("private-value"), (error) => {
    assert.equal(error.message, "Invalid progress");
    assert.equal(error.status, 400);
    assert.doesNotMatch(error.message, /private-value/);
    return true;
  });
});

test("AniList client refuses to claim an unsuccessful deletion", async () => {
  const api = createAniList({
    async post() {
      return { statusCode: 200, data: { data: { DeleteMediaListEntry: { deleted: false } } } };
    },
  });
  await assert.rejects(api.remove(5, "token"), /did not remove/);
});
