// Запуск: node scripts/check-brave-selection.js
// Требуются Brave, wtype, графическая сессия и tests/server.js на порту 4173.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

async function readPanel(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    return await new Promise((resolve, reject) => {
      socket.onerror = reject;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error) return reject(new Error(message.error.message));
        resolve(message.result.result.value);
      };
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
        expression: 'JSON.stringify({source:document.getElementById("source-text").value,translation:document.getElementById("sentence-translation").textContent,error:document.getElementById("error").textContent})',
        returnByValue: true
      } }));
    });
  } finally {
    socket.close();
  }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lexideck-brave-selection-"));
  const browserPath = process.env.BRAVE_PATH || "/usr/bin/brave";
  const apiOrigin = process.env.BRAVE_TEST_ORIGIN || "http://127.0.0.1:4173";
  const debuggingPort = process.env.BRAVE_DEBUG_PORT || "9337";
  const extension = path.resolve(__dirname, "..");
  let context;
  try {
    console.log(execFileSync(browserPath, ["--version"], { encoding: "utf8" }).trim());
    context = await chromium.launchPersistentContext(profile, {
      executablePath: browserPath, headless: false,
      args: [`--remote-debugging-port=${debuggingPort}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate((origin) => chrome.storage.local.set({ settings: {
      apiUrl: `${origin}/v1`, model: "controlled-model", apiKey: "test-secret"
    } }), apiOrigin);
    const page = await context.newPage();
    await page.goto(`${apiOrigin}/manifest.json`);
    await page.evaluate(() => {
      document.body.innerHTML = "<p>She took off her coat and wore her coat.</p>";
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("p"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const targets = async () => (await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json());
    assert.equal((await targets()).some((target) => target.url.endsWith("/src/panel.html")), false, "Панель должна быть закрыта до хоткея");
    await page.bringToFront();
    // CDP keyboard.press не запускает browser commands; нужен настоящий ввод.
    execFileSync("wtype", ["-M", "ctrl", "-M", "shift", "-k", "y", "-m", "shift", "-m", "ctrl"]);
    let state;
    for (let attempt = 0; attempt < 50; attempt++) {
      const panel = (await targets()).find((target) => target.url.endsWith("/src/panel.html"));
      if (panel) {
        state = JSON.parse(await readPanel(panel));
        if (state.translation || state.error) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(state, "Хоткей должен открыть настоящую боковую панель");
    assert.equal(state.source, "She took off her coat and wore her coat.");
    assert.equal(state.error, "");
    assert.equal(state.translation, "Она сняла пальто и надела пальто.");
    console.log("PASS: закрытая панель → выделение → Ctrl+Shift+Y → открытая панель и автоматический перевод.");
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
