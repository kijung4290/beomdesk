const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const FROM = process.env.BEOM_UPDATE_FROM || "0.2.2";
const TO = process.env.BEOM_UPDATE_TO || "0.2.3";
function closeOwned(pid, exe) {
  execFileSync(
    path.join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p=Get-Process -Id ([int]$env:BEOM_QA_PID) -ErrorAction Stop;if($p.Path -ne $env:BEOM_QA_EXE){throw 'Unexpected QA process'};$p.CloseMainWindow() | Out-Null",
    ],
    {
      windowsHide: true,
      env: { ...process.env, BEOM_QA_PID: String(pid), BEOM_QA_EXE: exe },
    },
  );
}
async function waitFor(check, timeout = 180000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw last || new Error("Timed out");
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
(async () => {
  const mode = process.argv[2] || "portable";
  assert.ok(["portable", "installed"].includes(mode));
  const env = JSON.parse(
    (
      await fs.readFile(path.join(ROOT, ".qa/environment.json"), "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  assert.ok(
    path
      .resolve(env.QaRoot)
      .startsWith(path.join(require("node:os").tmpdir(), "BeomDesk-QA-")),
  );
  const exe = mode === "portable" ? env.PortableExe : env.InstalledExe;
  const profile = path.join(
    env.QaRoot,
    mode === "portable" ? "BeomDeskData" : "installed-profile",
  );
  await fs.mkdir(profile, { recursive: true });
  const marker = `${mode} update preserves draft and favorites`;
  await fs.writeFile(
    path.join(profile, "profile.json"),
    JSON.stringify({
      draft: marker,
      favorites: [373],
      autoCheck: false,
      autoDownload: false,
    }),
  );
  const before = crypto
    .createHash("sha512")
    .update(await fs.readFile(exe))
    .digest("base64");
  const port = await freePort();
  const childEnv = { ...process.env, BEOM_TEST_PROFILE: profile };
  if (process.env.BEOM_QA_FAST_PORTABLE && mode === "portable") {
    childEnv.PORTABLE_EXECUTABLE_FILE = env.PortableExe;
    childEnv.PORTABLE_EXECUTABLE_DIR = path.dirname(env.PortableExe);
  }
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    process.env.BEOM_QA_FAST_PORTABLE ? env.InstalledExe : exe,
    [`--remote-debugging-port=${port}`],
    {
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let browser,
    finished = false;
  try {
    await waitFor(
      async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok,
    );
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForFunction(
      () => document.documentElement.dataset.ready === "true",
    );
    const old = await page.evaluate(() => window.beom.state("get"));
    assert.equal(old.version, FROM);
    assert.equal(old.mode, mode);
    assert.equal(await page.locator("#editor").inputValue(), marker);
    const available = await page.evaluate(() => window.beom.update("check"));
    assert.equal(available.status, "available", JSON.stringify(available));
    assert.equal(available.version, TO);
    console.log(`${mode}: downloading ${available.version}`);
    const downloaded = await page.evaluate(() =>
      window.beom.update("download"),
    );
    assert.equal(downloaded.status, "ready", JSON.stringify(downloaded));
    console.log(`${mode}: verified download ready; installing`);
    await page
      .evaluate(() => window.beom.update("install"))
      .catch((error) => {
        console.log("Install IPC result: " + error.message);
        if (!/closed|destroyed/i.test(error.message)) throw error;
      });
    await browser.close().catch(() => {});
    browser = null;
    const restartProfile =
      mode === "installed"
        ? path.join(process.env.APPDATA, "범피스 작업실")
        : profile;
    const session = await waitFor(async () => {
      const value = JSON.parse(
        await fs.readFile(path.join(restartProfile, "session.json"), "utf8"),
      );
      return value.version === TO && value;
    });
    const saved = JSON.parse(
      await fs.readFile(path.join(profile, "profile.json"), "utf8"),
    );
    assert.equal(saved.draft, marker);
    assert.deepEqual(saved.favorites, [373]);
    assert.equal(saved.autoCheck, false);
    const after = crypto
      .createHash("sha512")
      .update(await fs.readFile(exe))
      .digest("base64");
    assert.notEqual(after, before);
    if (mode === "installed") {
      closeOwned(session.pid, exe);
      const verifyPort = await freePort();
      const reopened = spawn(exe, [`--remote-debugging-port=${verifyPort}`], {
        env: childEnv,
        windowsHide: true,
        stdio: "ignore",
      });
      await waitFor(
        async () =>
          (await fetch(`http://127.0.0.1:${verifyPort}/json/version`)).ok,
      );
      const verifyBrowser = await chromium.connectOverCDP(
        `http://127.0.0.1:${verifyPort}`,
      );
      try {
        const verifyPage = verifyBrowser.contexts()[0].pages()[0];
        await verifyPage.waitForFunction(
          () => document.documentElement.dataset.ready === "true",
        );
        assert.equal(
          (await verifyPage.evaluate(() => window.beom.state("get"))).version,
          TO,
        );
        assert.equal(await verifyPage.locator("#editor").inputValue(), marker);
        await verifyPage.evaluate(() => setTimeout(() => window.close(), 0));
        await waitFor(() => reopened.exitCode !== null, 20000);
      } finally {
        await verifyBrowser.close().catch(() => {});
        if (reopened.exitCode === null) reopened.kill();
      }
    }
    if (mode === "portable") {
      const manifest = await (
        await fetch(
          "https://github.com/kijung4290/beomdesk/releases/latest/download/portable-latest.json",
        )
      ).json();
      assert.equal(after, manifest.sha512);
      assert.equal(
        crypto
          .createHash("sha512")
          .update(await fs.readFile(exe + ".previous"))
          .digest("base64"),
        before,
      );
      assert.equal(
        await fs.readFile(
          path.join(profile, "updates/last-update.log"),
          "utf8",
        ),
        "Updated successfully",
      );
    }
    const result = {
      passed: true,
      mode,
      from: old.version,
      baseline:
        mode === "portable"
          ? "Local QA build using the current updater with an older app version"
          : "Published installer",
      to: session.version,
      actualGithubDownload: true,
      restarted: true,
      profilePreserved: true,
      executableReplaced: true,
      downloadChecksumVerified: true,
      portableExecutableHashVerified: mode === "portable" ? true : null,
      testedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(ROOT, `test-results/live-update-${mode}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    // This PID comes from the isolated QA profile written by our newly started app.
    assert.ok(Number.isInteger(session.pid) && session.pid > 0);
    if (mode === "portable") {
      // The unpacked portable app lives in its own unique NSIS temporary directory.
      process.kill(session.pid);
    }
    finished = true;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (!finished && child.exitCode === null) child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
