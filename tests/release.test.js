const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const script = resolve(__dirname, "../scripts/publish-release-metadata.sh");
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "anilist-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const checkout = join(root, "checkout");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, checkout);
  git(checkout, "config", "user.name", "Release test");
  git(checkout, "config", "user.email", "release-test@example.invalid");
  writeFileSync(join(checkout, "Info.json"), JSON.stringify({ version: "1.0.1", ghVersion: 1000001 }));
  writeFileSync(join(checkout, "package.json"), JSON.stringify({ name: "anilist-sync", version: "1.0.1", private: true }));
  writeFileSync(join(checkout, "README.md"), "Original source\n");
  git(checkout, "add", ".");
  git(checkout, "commit", "-m", "Initial release");
  git(checkout, "push", "origin", "main");

  const packaged = {
    version: "1.0.2", ghVersion: 1000002, ghRepo: "gridness/anilist-sync",
    preferenceDefaults: { anilistClientId: "public-client-id", state: "", runtimeState: "" },
  };
  const manifest = join(root, "packaged-Info.json");
  writeFileSync(manifest, JSON.stringify(packaged, null, 2) + "\n");
  return {
    root, remote, checkout, git, manifest, packaged,
    publish: () => spawnSync("bash", [script, manifest], { cwd: checkout, env, encoding: "utf8" }),
    concurrentCommit(file, content) {
      const other = join(root, "other");
      git(root, "clone", remote, other);
      writeFileSync(join(other, file), content);
      git(other, "add", file);
      git(other, "-c", "user.name=Other author", "-c", "user.email=other@example.invalid", "commit", "-m", "Concurrent change");
      git(other, "push", "origin", "main");
    },
  };
}

test("release metadata reaches main without dropping concurrent source changes", (t) => {
  const f = fixture(t);
  f.concurrentCommit("README.md", "Newer source\n");
  const result = f.publish();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(f.git(f.remote, "show", "main:Info.json")), f.packaged);
  assert.equal(JSON.parse(f.git(f.remote, "show", "main:package.json")).version, "1.0.2");
  assert.equal(f.git(f.remote, "show", "main:README.md"), "Newer source");
  assert.equal(readFileSync(join(f.checkout, "README.md"), "utf8"), "Newer source\n");
});

test("publishing identical release metadata creates no additional commit", (t) => {
  const f = fixture(t);
  let result = f.publish();
  assert.equal(result.status, 0, result.stderr);
  const published = f.git(f.remote, "rev-parse", "main");
  result = f.publish();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git(f.remote, "rev-parse", "main"), published);
});

test("conflicting newer release metadata is never overwritten", (t) => {
  const f = fixture(t);
  const newer = { ...f.packaged, version: "1.0.3", ghVersion: 1000003 };
  f.concurrentCommit("Info.json", JSON.stringify(newer, null, 2) + "\n");
  const published = f.git(f.remote, "rev-parse", "main");
  const result = f.publish();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /CONFLICT|could not apply/i);
  assert.equal(f.git(f.remote, "rev-parse", "main"), published);
  assert.deepEqual(JSON.parse(f.git(f.remote, "show", "main:Info.json")), newer);
});
