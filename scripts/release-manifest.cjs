const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.join(__dirname, "..");
const pkg = require("../package.json");
const folder = path.join(root, "release");
const file = `BeomDesk-${pkg.version}-portable.exe`;
const bytes = fs.readFileSync(path.join(folder, file));
const manifest = {
  version: pkg.version,
  file,
  size: bytes.length,
  sha512: crypto.createHash("sha512").update(bytes).digest("base64"),
  releasedAt: new Date().toISOString(),
};
if (process.argv.includes("--check")) {
  const existing = JSON.parse(
    fs.readFileSync(path.join(folder, "portable-latest.json"), "utf8"),
  );
  for (const key of ["version", "file", "size", "sha512"])
    if (existing[key] !== manifest[key])
      throw new Error("Portable update manifest mismatch: " + key);
  console.log("Portable manifest and artifact integrity verified.");
} else {
  fs.writeFileSync(
    path.join(folder, "portable-latest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const names = [
    `BeomDesk-${pkg.version}-setup.exe`,
    `BeomDesk-${pkg.version}-setup.exe.blockmap`,
    file,
    "latest.yml",
    "portable-latest.json",
  ];
  const checksums =
    names
      .map(
        (name) =>
          crypto
            .createHash("sha256")
            .update(fs.readFileSync(path.join(folder, name)))
            .digest("hex") +
          "  " +
          name,
      )
      .join("\n") + "\n";
  fs.writeFileSync(path.join(folder, "SHA256SUMS.txt"), checksums);
  console.log("Release manifest generated for " + pkg.version);
}
