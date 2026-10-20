const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const ROOT = path.join(__dirname, "..");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "beom-electron-"));
  const env = { ...process.env, BEOM_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.BEOM_TEST_EXE
    ? { executablePath: process.env.BEOM_TEST_EXE, args: [] }
    : { executablePath: require("electron"), args: [ROOT] };
  const app = await electron.launch({ ...options, env, timeout: 90000 });
  const errors = [];
  let result;
  try {
    const page = await app.firstWindow({ timeout: 90000 });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.ready === "true" ||
        document.documentElement.dataset.error,
      { timeout: 90000 },
    );
    const startError = await page.evaluate(
      () => document.documentElement.dataset.error,
    );
    if (startError) throw new Error(startError);
    assert.equal(await page.evaluate(() => typeof require), "undefined");
    const bootstrap = await page.evaluate(() => window.beom.call("bootstrap"));
    assert.equal(bootstrap.features.length, 1926);
    assert.equal(bootstrap.templates.length, 27);
    assert.ok(bootstrap.features.filter((x) => x.direct).length > 1000);
    await page.locator('[data-page="tools"]').click();
    await page.locator("#tool-search").fill("셀병합");
    assert.ok((await page.locator(".tool-card").count()) > 0);
    await page.locator(".tool-card").first().click();
    assert.ok(await page.locator("#tool-detail h2").textContent());
    await page.locator(".tool-card .favorite-button").first().click();
    await page.locator('[data-page="favorites"]').click();
    assert.equal(await page.locator("#favorites-grid .tool-card").count(), 1);
    await page.locator('[data-page="calc"]').click();
    await page.locator("#calculate-number").click();
    await page.waitForFunction(
      () =>
        document.getElementById("number-result").textContent === "125,000.0",
    );
    await page.locator('[data-page="write"]').click();
    await page
      .locator("#editor")
      .fill(
        "제목: Electron 검증\n네모: 문서 미리보기\n표: 항목: 결과\n표: 연결: 성공",
      );
    await page.waitForFunction(
      () =>
        document.querySelector("#preview h1")?.textContent === "Electron 검증",
    );
    assert.equal(await page.locator("#preview table tr").count(), 2);
    await page.locator("#load-sample").click();
    await page.waitForFunction(() =>
      document.querySelector("#preview h1")?.textContent.includes("지역주민"),
    );
    await page.locator("#toast").waitFor({ state: "hidden", timeout: 8000 });
    const out = path.join(ROOT, "screenshots");
    await fs.mkdir(out, { recursive: true });
    await page.screenshot({ path: path.join(out, "electron-document.png") });
    await page.locator('[data-page="tools"]').click();
    await page.locator("#tool-search").fill("");
    await page.screenshot({ path: path.join(out, "electron-tools.png") });
    await page.locator('[data-page="write"]').click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1020, 700),
    );
    await page.waitForFunction(() => innerWidth <= 1020 && innerHeight <= 700);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.locator("#create-document").boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.screenshot({ path: path.join(out, "electron-compact.png") });
    assert.ok(
      bounds.y + bounds.height <= viewport.height,
      "Primary action remains visible at minimum window size",
    );
    await page.screenshot({ path: path.join(out, "electron-compact.png") });
    assert.deepEqual(errors, []);
    await fs.mkdir(path.join(ROOT, "test-results"), { recursive: true });
    result = {
      passed: true,
      features: bootstrap.features.length,
      directActions: bootstrap.features.filter((x) => x.direct).length,
      templates: bootstrap.templates.length,
      rendererErrors: errors,
      minimumSizePrimaryActionVisible: true,
      version: await app.evaluate(({ app }) => app.getVersion()),
    };
    await page.locator("#editor").fill("종료 직전 초안 보관 검증");
  } finally {
    await app.close();
  }
  const saved = JSON.parse(await fs.readFile(path.join(profile, "profile.json"), "utf8"));
  assert.equal(saved.draft, "종료 직전 초안 보관 검증");
  result.draftPreservedOnImmediateClose = true;
  await fs.writeFile(path.join(ROOT, "test-results", "electron-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
