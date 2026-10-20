const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  validateManifest,
  validateRepository,
  downloadVerified,
  UpdateManager,
} = require("../electron/updates.cjs");
const bytes = Buffer.from("verified portable update fixture");
const manifest = {
  version: "0.2.1",
  file: "BeomDesk-0.2.1-portable.exe",
  size: bytes.length,
  sha512: crypto.createHash("sha512").update(bytes).digest("base64"),
};
test("automatic downloads respect the saved preference", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "beom-updates-"));
  try {
    for (const enabled of [false, true]) {
      const manager = new UpdateManager({
        app: { getVersion: () => "0.2.0", isPackaged: true },
        config: { owner: "owner", repo: "repo" },
        dataDir: directory,
        portableFile: path.join(directory, "portable.exe"),
        autoDownload: () => enabled,
        fetchImpl: async (url) =>
          url.endsWith(".json")
            ? new Response(JSON.stringify(manifest))
            : new Response(bytes),
      });
      const ready = enabled
        ? new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Automatic download timed out")),
              3000,
            );
            manager.on("state", (state) => {
              if (state.status === "ready") {
                clearTimeout(timeout);
                resolve();
              }
              if (state.status === "error") {
                clearTimeout(timeout);
                reject(new Error(state.message));
              }
            });
          })
        : null;
      await manager.check();
      if (enabled) {
        await ready;
        assert.deepEqual(await fs.readFile(manager.downloaded), bytes);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(manager.state.status, "available");
        assert.equal(manager.downloaded, null);
      }
    }
  } finally {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "beom-updates-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("only newer and valid portable versions are offered", () => {
  assert.equal(validateManifest(manifest, "0.2.0").available, true);
  assert.equal(validateManifest(manifest, "0.2.1").available, false);
  assert.throws(() =>
    validateManifest({ ...manifest, file: "../../evil.exe" }, "0.2.0"),
  );
  assert.throws(() =>
    validateManifest({ ...manifest, sha512: "invalid" }, "0.2.0"),
  );
  assert.throws(() => validateRepository("owner", "../repo"));
});
test("download verifies checksum and full length before publishing a file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "beom-updates-"));
  const destination = path.join(directory, "update.exe");
  const result = await downloadVerified({
    url: "https://example.invalid/fixture",
    destination,
    manifest,
    fetchImpl: async () => new Response(bytes),
  });
  assert.equal(result, destination);
  assert.deepEqual(await fs.readFile(destination), bytes);
  assert.ok(
    path.resolve(directory).startsWith(path.join(os.tmpdir(), "beom-updates-")),
  );
  await fs.rm(directory, { recursive: true, force: true });
});
test("a changed update or truncated response never becomes an executable update", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "beom-updates-"));
  const destination = path.join(directory, "update.exe");
  await assert.rejects(
    downloadVerified({
      url: "https://example.invalid/fixture",
      destination,
      manifest,
      fetchImpl: async () => new Response(Buffer.alloc(bytes.length, 0)),
    }),
    /무결성/,
  );
  await assert.rejects(fs.access(destination));
  await assert.rejects(fs.access(destination + ".partial"));
  await assert.rejects(
    downloadVerified({
      url: "https://example.invalid/fixture",
      destination,
      manifest,
      fetchImpl: async () => new Response("short"),
    }),
    /끝나지/,
  );
  assert.ok(
    path.resolve(directory).startsWith(path.join(os.tmpdir(), "beom-updates-")),
  );
  await fs.rm(directory, { recursive: true, force: true });
});
