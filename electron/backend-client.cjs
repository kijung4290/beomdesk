const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const fs = require("node:fs");
class BackendClient extends EventEmitter {
  constructor({ root, resourcesPath, packaged, dataDir }) {
    super();
    this.next = 0;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.closed = false;
    const exe = packaged
      ? path.join(resourcesPath, "backend", "BeomBackend.exe")
      : path.join(root, "backend-dist", "BeomBackend", "BeomBackend.exe");
    if (!fs.existsSync(exe))
      throw new Error("문서 엔진을 찾지 못했습니다. 앱을 다시 설치해 주세요.");
    this.child = spawn(exe, [], {
      cwd: path.dirname(exe),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BEOM_DATA_DIR: dataDir,
        PYTHONIOENCODING: "utf-8",
      },
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-12000);
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => {
      this.closed = true;
      this.fail(
        new Error("문서 엔진이 종료됐습니다. 앱을 다시 시작해 주세요."),
      );
      this.emit("stopped", code);
    });
  }
  read(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.child.kill();
      return;
    }
    let position;
    while ((position = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, position);
      this.buffer = this.buffer.slice(position + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.event) {
        this.emit("event", message);
        continue;
      }
      const item = this.pending.get(message.id);
      if (!item) continue;
      clearTimeout(item.timer);
      this.pending.delete(message.id);
      message.ok
        ? item.resolve(message.result)
        : item.reject(
            new Error(message.error || "작업을 완료하지 못했습니다."),
          );
    }
  }
  call(method, params = {}, timeout = 180000) {
    if (this.closed)
      return Promise.reject(new Error("문서 엔진이 종료됐습니다."));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "작업 시간이 길어지고 있습니다. 한글의 대화상자를 확인해 주세요.",
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ id, method, params }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  fail(error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
  async stop() {
    if (this.closed) return;
    try {
      await this.call("shutdown", {}, 2000);
    } catch {}
    this.child.stdin.end();
    const timer = setTimeout(() => {
      if (!this.closed) this.child.kill();
    }, 3000);
    timer.unref();
  }
}
module.exports = { BackendClient };
