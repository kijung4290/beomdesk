const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { UpdateManager } = require("../../electron/updates.cjs");
app
  .whenReady()
  .then(async () => {
    const directory = process.env.BEOM_HANDOFF_DIR;
    if (!directory) throw new Error("Isolated fixture directory required");
    const source = path.join(directory, "next.exe");
    const bytes = await fs.readFile(source);
    const manager = new UpdateManager({
      app,
      config: {},
      dataDir: directory,
      portableFile: path.join(directory, "portable.exe"),
    });
    manager.manifest = {
      sha512: crypto.createHash("sha512").update(bytes).digest("base64"),
    };
    manager.downloaded = source;
    manager.set({ status: "ready" });
    await manager.install();
  })
  .catch(async (error) => {
    await fs.writeFile(
      path.join(process.env.BEOM_HANDOFF_DIR, "failure.txt"),
      error.stack,
    );
    app.exit(1);
  });
