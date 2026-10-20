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
  portableScript,
} = require("../electron/updates.cjs");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const bytes = Buffer.from("verified portable update fixture");
const manifest = {
  version: "0.2.1",
  file: "BeomDesk-0.2.1-portable.exe",
  size: bytes.length,
  sha512: crypto.createHash("sha512").update(bytes).digest("base64"),
};
test("installed updates apply silently and restart only after user approval", async () => {
  const updater = new EventEmitter();
  let args;
  updater.quitAndInstall = (...value) => {
    args = value;
  };
  const manager = new UpdateManager({
    app: { getVersion: () => "0.2.1" },
    config: {},
    dataDir: os.tmpdir(),
    autoUpdater: updater,
  });
  await assert.rejects(manager.install(), /다운로드/);
  manager.set({ status: "ready" });
  manager.downloaded = true;
  await manager.install();
  assert.deepEqual(args, [true, true]);
});
test(
  "Windows portable helper waits for exit, replaces verified bytes and preserves backup",
  { skip: process.platform !== "win32", timeout: 30000 },
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "beom-updates-"));
    const source = path.join(directory, "next.exe"),
      destination = path.join(directory, "portable.exe"),
      log = path.join(directory, "update.log");
    const oldBytes = await fs.readFile(
      path.join(process.env.SystemRoot, "System32/whoami.exe"),
    );
    const newBytes = await fs.readFile(
      path.join(process.env.SystemRoot, "System32/where.exe"),
    );
    await fs.writeFile(source, newBytes);
    await fs.writeFile(destination, oldBytes);
    const old = spawn(process.execPath, ["-e", "setTimeout(()=>{},25000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    let helper;
    try {
      helper = spawn(
        path.join(
          process.env.SystemRoot,
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          portableScript,
        ],
        {
          cwd: directory,
          windowsHide: true,
          stdio: "ignore",
          env: {
            ...process.env,
            BEOM_UPDATE_SOURCE: source,
            BEOM_UPDATE_DESTINATION: destination,
            BEOM_UPDATE_SHA512: crypto
              .createHash("sha512")
              .update(newBytes)
              .digest("base64"),
            BEOM_UPDATE_PID: String(old.pid),
            BEOM_UPDATE_LOG: log,
          },
        },
      );
      const exited = new Promise((resolve, reject) => {
        helper.once("error", reject);
        helper.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error("Helper exit " + code)),
        );
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (
          (await fs.readFile(log, "utf8").catch(() => "")) ===
          "Waiting for app exit"
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(await fs.readFile(log, "utf8"), "Waiting for app exit");
      assert.deepEqual(await fs.readFile(destination), oldBytes);
      old.kill();
      await exited;
      assert.deepEqual(await fs.readFile(destination), newBytes);
      assert.deepEqual(await fs.readFile(destination + ".previous"), oldBytes);
      assert.equal(await fs.readFile(log, "utf8"), "Updated successfully");
    } finally {
      if (old.exitCode === null) old.kill();
      if (helper && helper.exitCode === null) helper.kill();
      assert.ok(
        path
          .resolve(directory)
          .startsWith(path.join(os.tmpdir(), "beom-updates-")),
      );
      await fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  },
);
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
