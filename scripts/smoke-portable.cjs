const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function waitFor(check, timeout = 90000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      error = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw error || new Error("Timed out");
}
(async () => {
  const env = JSON.parse(
    (
      await fs.readFile(path.join(ROOT, ".qa/environment.json"), "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  const port = await freePort();
  const child = spawn(env.PortableExe, [`--remote-debugging-port=${port}`], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  let browser;
  try {
    await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      return r.ok;
    });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.ready === "true" ||
        document.documentElement.dataset.error,
    );
    const error = await page.evaluate(
      () => document.documentElement.dataset.error,
    );
    if (error) throw new Error(error);
    const info = await page.evaluate(() => window.beom.state("get"));
    assert.equal(info.mode, "portable");
    assert.equal(info.version, "0.2.0");
    const engine = await page.evaluate(() => window.beom.call("self_test"));
    assert.equal(engine.features, 1926);
    assert.ok(engine.legacyDefinitions > 100);
    await page.locator("#editor").fill("무설치형 실행 및 초안 보관 검증");
    await page.evaluate(() => setTimeout(() => window.close(), 0));
    await waitFor(() => child.exitCode !== null, 20000);
    const saved = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(env.PortableExe), "BeomDeskData/profile.json"),
        "utf8",
      ),
    );
    assert.equal(saved.draft, "무설치형 실행 및 초안 보관 검증");
    const result = {
      passed: true,
      mode: info.mode,
      version: info.version,
      features: engine.features,
      templates: engine.templates,
      localPortableProfileVerified: true,
    };
    await fs.writeFile(
      path.join(ROOT, "test-results/portable-smoke.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
