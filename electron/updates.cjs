const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const semver = require("semver");

function validateRepository(owner, repo) {
  const valid = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
  if (
    !valid.test(owner || "") ||
    !valid.test(repo || "") ||
    repo === "." ||
    repo === ".."
  )
    throw new Error("GitHub 저장소 주소를 확인해 주세요.");
  return { owner, repo };
}
function validateManifest(value, current) {
  if (!value || !semver.valid(value.version) || !semver.valid(current))
    throw new Error("업데이트 버전 정보가 올바르지 않습니다.");
  if (!/^BeomDesk-[0-9A-Za-z.+-]+-portable\.exe$/.test(value.file || ""))
    throw new Error("업데이트 파일 이름이 올바르지 않습니다.");
  if (
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 1024 * 1024 * 1024
  )
    throw new Error("업데이트 파일 크기가 올바르지 않습니다.");
  if (
    typeof value.sha512 !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(value.sha512) ||
    Buffer.from(value.sha512, "base64").length !== 64
  )
    throw new Error("업데이트 검증 정보가 올바르지 않습니다.");
  return { ...value, available: semver.gt(value.version, current) };
}
async function downloadVerified({
  url,
  destination,
  manifest,
  onProgress = () => {},
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(600000),
    headers: { "User-Agent": "BeomDesk-Updater" },
  });
  if (!response.ok)
    throw new Error(`업데이트 다운로드 실패 (${response.status})`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = destination + ".partial";
  const handle = await fs.open(partial, "w");
  const hash = crypto.createHash("sha512");
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > manifest.size)
        throw new Error("업데이트 파일이 안내된 크기를 초과했습니다.");
      hash.update(chunk);
      await handle.write(chunk);
      onProgress((bytes / manifest.size) * 100);
    }
    if (bytes !== manifest.size)
      throw new Error("업데이트 파일 다운로드가 끝나지 않았습니다.");
    const actual = hash.digest();
    const expected = Buffer.from(manifest.sha512, "base64");
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      throw new Error("업데이트 파일의 무결성 확인에 실패했습니다.");
    await handle.close();
    await fs.rename(partial, destination);
    return destination;
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(partial).catch(() => {});
    throw error;
  }
}
const portableScript = String.raw`
$ErrorActionPreference='Stop'
$source=$env:BEOM_UPDATE_SOURCE
$destination=$env:BEOM_UPDATE_DESTINATION
$expected=$env:BEOM_UPDATE_SHA512
$log=$env:BEOM_UPDATE_LOG
$backup=$destination+'.previous'
try {
  if(-not [System.IO.Path]::IsPathRooted($source) -or -not [System.IO.Path]::IsPathRooted($destination)){throw 'Absolute update paths required'}
  $hasher=[System.Security.Cryptography.SHA512]::Create()
  $actual=[Convert]::ToBase64String($hasher.ComputeHash([System.IO.File]::ReadAllBytes($source)))
  if($actual -ne $expected){throw 'Update checksum changed'}
  [System.IO.File]::WriteAllText($log,'Waiting for app exit')
  Wait-Process -Id ([int]$env:BEOM_UPDATE_PID) -Timeout 30 -ErrorAction SilentlyContinue
  $done=$false
  $backupMade=$false
  for($attempt=0;$attempt -lt 60;$attempt++) {
    try {
      if(-not $backupMade){Copy-Item -LiteralPath $destination -Destination $backup -Force;$backupMade=$true}
      Copy-Item -LiteralPath $source -Destination $destination -Force
      $copied=[Convert]::ToBase64String($hasher.ComputeHash([System.IO.File]::ReadAllBytes($destination)))
      if($copied -ne $expected){throw 'Copied checksum mismatch'}
      $done=$true;break
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if(-not $done){throw 'Portable executable could not be replaced'}
  [System.IO.File]::WriteAllText($log,'Updated successfully')
  Start-Process -FilePath $destination -WindowStyle Hidden
} catch {
  if(Test-Path -LiteralPath $backup){Copy-Item -LiteralPath $backup -Destination $destination -Force -ErrorAction SilentlyContinue}
  [System.IO.File]::WriteAllText($log,$_.Exception.Message)
}
`;

class UpdateManager extends EventEmitter {
  constructor({
    app,
    config,
    dataDir,
    portableFile,
    fetchImpl = fetch,
    autoUpdater,
    autoDownload = () => false,
  }) {
    super();
    this.app = app;
    this.config = config;
    this.dataDir = dataDir;
    this.portableFile = portableFile;
    this.fetch = fetchImpl;
    this.updater = autoUpdater;
    this.autoDownload = autoDownload;
    this.state = {
      status: "idle",
      mode: portableFile ? "portable" : "installed",
      currentVersion: app.getVersion(),
    };
    this.manifest = null;
    this.downloaded = null;
    this.busy = false;
    if (!portableFile && autoUpdater) {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowDowngrade = false;
      autoUpdater.on("update-available", (info) =>
        this.set({ status: "available", version: info.version }),
      );
      autoUpdater.on("update-not-available", () =>
        this.set({ status: "current" }),
      );
      autoUpdater.on("download-progress", (info) =>
        this.set({ status: "downloading", percent: Math.round(info.percent) }),
      );
      autoUpdater.on("update-downloaded", (info) => {
        this.downloaded = true;
        this.set({ status: "ready", version: info.version });
      });
      autoUpdater.on("error", (error) =>
        this.set({ status: "error", message: error.message }),
      );
    }
  }
  set(value) {
    this.state = { ...this.state, ...value };
    this.emit("state", this.state);
    return this.state;
  }
  base() {
    const { owner, repo } = validateRepository(
      this.config.owner,
      this.config.repo,
    );
    return `https://github.com/${owner}/${repo}/releases/latest/download/`;
  }
  async check() {
    if (this.busy) return this.state;
    this.busy = true;
    try {
      const base = this.base();
      this.set({ status: "checking", message: "" });
      if (!this.app.isPackaged && !this.portableFile)
        return this.set({
          status: "development",
          message: "배포된 앱에서 업데이트를 확인할 수 있습니다.",
        });
      if (this.portableFile) {
        const response = await this.fetch(base + "portable-latest.json", {
          signal: AbortSignal.timeout(30000),
          headers: { "User-Agent": "BeomDesk-Updater" },
        });
        if (response.status === 404)
          return this.set({
            status: "not-published",
            message: "아직 게시된 업데이트가 없습니다.",
          });
        if (!response.ok)
          throw new Error(`업데이트 확인 실패 (${response.status})`);
        const text = await response.text();
        if (text.length > 131072)
          throw new Error("업데이트 정보가 너무 큽니다.");
        this.manifest = validateManifest(
          JSON.parse(text),
          this.app.getVersion(),
        );
        return this.set({
          status: this.manifest.available ? "available" : "current",
          version: this.manifest.version,
        });
      }
      this.updater.setFeedURL({
        provider: "github",
        owner: this.config.owner,
        repo: this.config.repo,
        releaseType: "release",
      });
      await this.updater.checkForUpdates();
      return this.state;
    } catch (error) {
      return this.set({ status: "error", message: error.message });
    } finally {
      this.busy = false;
      if (this.state.status === "available" && this.autoDownload()) {
        const timer = setTimeout(() => this.download(), 0);
        timer.unref();
      }
    }
  }
  async download() {
    if (this.busy || this.state.status !== "available") return this.state;
    this.busy = true;
    this.set({ status: "downloading", percent: 0 });
    try {
      if (this.portableFile) {
        const destination = path.join(
          this.dataDir,
          "updates",
          this.manifest.file,
        );
        this.downloaded = await downloadVerified({
          url: this.base() + encodeURIComponent(this.manifest.file),
          destination,
          manifest: this.manifest,
          fetchImpl: this.fetch,
          onProgress: (p) =>
            this.set({ status: "downloading", percent: Math.round(p) }),
        });
        return this.set({ status: "ready", version: this.manifest.version });
      }
      await this.updater.downloadUpdate();
      return this.state;
    } catch (error) {
      return this.set({ status: "error", message: error.message });
    } finally {
      this.busy = false;
    }
  }
  async install() {
    if (this.state.status !== "ready" || !this.downloaded)
      throw new Error("업데이트를 먼저 다운로드해 주세요.");
    if (!this.portableFile) {
      this.updater.quitAndInstall(true, true);
      return { restarting: true };
    }
    const log = path.join(this.dataDir, "updates", "last-update.log");
    await fs.unlink(log).catch(() => {});
    const helper = spawn(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Start-Process -FilePath $env:BEOM_UPDATE_POWERSHELL -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',$env:BEOM_UPDATE_COMMAND) -WorkingDirectory $env:BEOM_UPDATE_DIRECTORY -WindowStyle Hidden",
      ],
      {
        detached: false,
        cwd: this.dataDir,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          BEOM_UPDATE_POWERSHELL: path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          BEOM_UPDATE_COMMAND: Buffer.from(portableScript, "utf16le").toString(
            "base64",
          ),
          BEOM_UPDATE_DIRECTORY: this.dataDir,
          BEOM_UPDATE_SOURCE: this.downloaded,
          BEOM_UPDATE_DESTINATION: this.portableFile,
          BEOM_UPDATE_SHA512: this.manifest.sha512,
          BEOM_UPDATE_PID: String(process.pid),
          BEOM_UPDATE_LOG: log,
        },
      },
    );
    let startupError;
    helper.once("error", (error) => {
      startupError = error;
    });
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      const message = await fs.readFile(log, "utf8").catch(() => "");
      if (message === "Waiting for app exit") {
        ready = true;
        break;
      }
      if (message) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      helper.kill();
      throw new Error(
        "업데이트 교체 프로세스를 시작하지 못했습니다. 앱을 다시 시작해 주세요.",
      );
    }
    helper.unref();
    this.app.quit();
    return { restarting: true };
  }
}
module.exports = {
  UpdateManager,
  validateRepository,
  validateManifest,
  downloadVerified,
  portableScript,
};
