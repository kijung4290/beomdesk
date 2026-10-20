const {
  app,
  BrowserWindow,
  protocol,
  net,
  ipcMain,
  dialog,
  session,
  clipboard,
} = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { BackendClient } = require("./backend-client.cjs");
const { UpdateManager } = require("./updates.cjs");
const { autoUpdater } = require("electron-updater");
const ROOT = path.join(__dirname, "..");
const config = require("../update-config.json");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "beom",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win,
  backend,
  updates,
  closing = false,
  profile = { draft: "", favorites: [], autoCheck: true },
  saveQueue = Promise.resolve();
const portableFile = process.env.PORTABLE_EXECUTABLE_FILE || "";
if (process.env.PORTABLE_EXECUTABLE_DIR)
  app.setPath(
    "userData",
    path.join(process.env.PORTABLE_EXECUTABLE_DIR, "BeomDeskData"),
  );
if (process.env.BEOM_TEST_PROFILE)
  app.setPath("userData", process.env.BEOM_TEST_PROFILE);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const dataDir = app.getPath("userData");
      await fs.mkdir(dataDir, { recursive: true });
      try {
        const saved = JSON.parse(
          await fs.readFile(path.join(dataDir, "profile.json"), "utf8"),
        );
        profile = { ...profile, ...saved };
      } catch {}
      backend = new BackendClient({
        root: ROOT,
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
        dataDir,
      });
      backend.on("event", (value) => send(value));
      backend.on("stopped", () => {
        if (!closing)
          send({
            event: "tool-error",
            message: "문서 엔진이 종료됐습니다. 앱을 다시 시작해 주세요.",
          });
      });
      updates = new UpdateManager({
        app,
        config,
        dataDir,
        portableFile,
        autoUpdater,
      });
      updates.on("state", (value) => send({ event: "update", value }));
      const rendererRoot = path.join(ROOT, "renderer");
      const assetsRoot = app.isPackaged
        ? path.join(process.resourcesPath, "backend", "_internal", "assets")
        : path.join(ROOT, "backend-dist", "BeomBackend", "_internal", "assets");
      protocol.handle("beom", async (request) => {
        const url = new URL(request.url);
        let decoded;
        try {
          decoded = decodeURIComponent(url.pathname);
        } catch {
          return new Response("Bad path", { status: 400 });
        }
        const base =
          url.hostname === "app"
            ? rendererRoot
            : url.hostname === "assets"
              ? assetsRoot
              : null;
        if (!base) return new Response("Not found", { status: 404 });
        const relative = decoded.replace(/^\/+/, "");
        const file = path.resolve(base, relative || "index.html");
        const difference = path.relative(base, file);
        if (difference.startsWith("..") || path.isAbsolute(difference))
          return new Response("Forbidden", { status: 403 });
        if (url.hostname === "assets" && !/\.png$/i.test(file))
          return new Response("Forbidden", { status: 403 });
        try {
          return await net.fetch(pathToFileURL(file).href);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      });
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      win = new BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 1020,
        minHeight: 700,
        show: false,
        backgroundColor: "#eef3f6",
        title: "범피스 작업실",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      win.setMenuBarVisibility(false);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("beom://app/")) event.preventDefault();
      });
      win.once("ready-to-show", () => win.show());
      registerIPC(dataDir);
      await win.loadURL("beom://app/index.html");
      if (profile.autoCheck) setTimeout(() => updates.check(), 6000).unref();
    })
    .catch((error) => {
      dialog.showErrorBox("앱 시작 확인", error.message);
      app.quit();
    });
}
function send(value) {
  if (win && !win.isDestroyed()) win.webContents.send("beom-event", value);
}
function validateSender(event) {
  if (
    event.sender !== win?.webContents ||
    event.senderFrame?.url !== "beom://app/index.html"
  )
    throw new Error("허용되지 않은 요청입니다.");
}
async function saveProfile(dataDir) {
  const bytes = JSON.stringify(profile);
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      const pending = path.join(dataDir, "profile.json.pending");
      await fs.writeFile(pending, bytes, "utf8");
      await fs.rename(pending, path.join(dataDir, "profile.json"));
    });
  return saveQueue;
}
function registerIPC(dataDir) {
  ipcMain.on("flush-profile", (event, params = {}) => {
    try {
      validateSender(event);
      if (typeof params.draft === "string" && params.draft.length <= 300000) profile.draft = params.draft;
      if (Array.isArray(params.favorites)) profile.favorites = params.favorites.filter(x => Number.isInteger(x) && x >= 0 && x < 10000).slice(0, 3000);
      const temporary = path.join(dataDir, "profile.flush");
      fsSync.writeFileSync(temporary, JSON.stringify(profile), "utf8");
      fsSync.renameSync(temporary, path.join(dataDir, "profile.json"));
      event.returnValue = true;
    } catch { event.returnValue = false; }
  });
  const allowed = new Set([
    "bootstrap",
    "preview",
    "connect",
    "render",
    "command",
    "font",
    "spacing",
    "cell_margins",
    "open_feature",
    "execute_feature",
    "template_open",
    "calculate",
    "date_difference",
    "self_test",
  ]);
  ipcMain.handle("backend", async (event, method, params = {}) => {
    validateSender(event);
    if (!allowed.has(method)) throw new Error("지원하지 않는 요청입니다.");
    if (JSON.stringify(params).length > 1000000)
      throw new Error("요청 크기가 너무 큽니다.");
    return backend.call(method, params);
  });
  ipcMain.handle("state", async (event, method, params = {}) => {
    validateSender(event);
    if (method === "get")
      return {
        ...profile,
        version: app.getVersion(),
        mode: portableFile ? "portable" : "installed",
        updates: updates.state,
        repository: `${config.owner}/${config.repo}`,
      };
    if (method === "save") {
      if (typeof params.draft === "string" && params.draft.length <= 300000)
        profile.draft = params.draft;
      if (Array.isArray(params.favorites))
        profile.favorites = [
          ...new Set(
            params.favorites.filter(
              (x) => Number.isInteger(x) && x >= 0 && x < 10000,
            ),
          ),
        ].slice(0, 3000);
      if (typeof params.autoCheck === "boolean")
        profile.autoCheck = params.autoCheck;
      await saveProfile(dataDir);
      return { saved: true };
    }
    throw new Error("지원하지 않는 설정 요청입니다.");
  });
  ipcMain.handle("file", async (event, method, params = {}) => {
    validateSender(event);
    if (method === "copy_text") {
      if (typeof params.text !== "string" || params.text.length > 10000)
        throw new Error("복사할 내용을 확인해 주세요.");
      clipboard.writeText(params.text);
      return { copied: true };
    }
    if (method === "open_text") {
      const selection = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "텍스트 · Markdown", extensions: ["txt", "md"] }],
      });
      if (selection.canceled) return null;
      const file = selection.filePaths[0];
      const stat = await fs.stat(file);
      if (stat.size > 1200000)
        throw new Error("파일은 1.2MB 이내로 나누어 주세요.");
      return {
        text: (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""),
        name: path.basename(file),
      };
    }
    if (method === "save_text" || method === "export_html") {
      let content, extension;
      if (typeof params.text !== "string" || params.text.length > 300000)
        throw new Error("저장할 내용을 확인해 주세요.");
      if (method === "export_html") {
        content = (await backend.call("preview", { text: params.text })).html;
        extension = "html";
      } else {
        content = params.text;
        extension = "txt";
      }
      const selection = await dialog.showSaveDialog(win, {
        defaultPath: `문서.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (selection.canceled) return null;
      await fs.writeFile(selection.filePath, content, "utf8");
      return { saved: true, path: selection.filePath };
    }
    if (method === "save_hwp") {
      const selection = await dialog.showSaveDialog(win, {
        defaultPath: "문서.hwpx",
        filters: [
          { name: "한글 표준 문서", extensions: ["hwpx"] },
          { name: "한글 문서", extensions: ["hwp"] },
        ],
      });
      if (selection.canceled) return null;
      return backend.call("save_hwp", { path: selection.filePath });
    }
    if (method === "template_copy") {
      if (!Number.isInteger(params.id))
        throw new Error("서식을 선택해 주세요.");
      const bootstrap = await backend.call("bootstrap");
      const template = bootstrap.templates.find((x) => x.id === params.id);
      if (!template) throw new Error("서식을 찾지 못했습니다.");
      const selection = await dialog.showSaveDialog(win, {
        defaultPath: template.name,
      });
      if (selection.canceled) return null;
      return backend.call("template_copy", {
        id: params.id,
        path: selection.filePath,
      });
    }
    throw new Error("지원하지 않는 파일 요청입니다.");
  });
  ipcMain.handle("update", async (event, method) => {
    validateSender(event);
    if (method === "check") return updates.check();
    if (method === "download") return updates.download();
    if (method === "install") return updates.install();
    if (method === "state") return updates.state;
    throw new Error("지원하지 않는 업데이트 요청입니다.");
  });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (closing) return;
  closing = true;
  event.preventDefault();
  Promise.allSettled([
    backend?.stop(),
    saveProfile(app.getPath("userData")),
  ]).finally(() => app.quit());
});
