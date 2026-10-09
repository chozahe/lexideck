const fs = require("node:fs");
const path = require("node:path");

const source = path.dirname(require.resolve("ts-fsrs"));
const target = path.resolve(__dirname, "../src/vendor");
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(source, "index.mjs"), path.join(target, "ts-fsrs.js"));
fs.copyFileSync(path.join(source, "../LICENSE"), path.join(target, "ts-fsrs.LICENSE"));
