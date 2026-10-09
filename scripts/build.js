const fs = require("node:fs");
const path = require("node:path");
require("./prepare-vendor.js");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, "manifest.json"), path.join(output, "manifest.json"));
fs.cpSync(path.join(root, "src"), path.join(output, "src"), { recursive: true });
console.log("Расширение собрано в dist/.");
