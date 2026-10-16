// Запуск: node scripts/check-brave-region.js
// Требуются Brave, wtype, графическая сессия и tests/server.js на порту 4173.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

async function evaluatePanel(target, expression) {
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
        expression,
        returnByValue: true
      } }));
    });
  } finally {
    socket.close();
  }
}

async function clickPanel(target, selector) {
  const bounds = JSON.parse(await evaluatePanel(target, `JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })())`));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const send = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== requestId) return;
        socket.removeEventListener("message", onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } finally {
    socket.close();
  }
}

const panelState = 'document.getElementById("source-text") && JSON.stringify({source:document.getElementById("source-text").value,translation:document.getElementById("sentence-translation").textContent,error:document.getElementById("error").textContent,confirmVisible:!document.getElementById("confirm-comic").hidden,retryVisible:!document.getElementById("retry-comic").hidden})';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lexideck-brave-region-"));
  const browserPath = process.env.BRAVE_PATH || "/usr/bin/brave";
  const apiOrigin = process.env.BRAVE_TEST_ORIGIN || "http://127.0.0.1:4173";
  const debuggingPort = process.env.BRAVE_DEBUG_PORT || "9337";
  const extension = path.resolve(__dirname, "..");
  const apiModel = `controlled-region-${Date.now()}`;
  let context;
  try {
    console.log(execFileSync(browserPath, ["--version"], { encoding: "utf8" }).trim());
    context = await chromium.launchPersistentContext(profile, {
      executablePath: browserPath, headless: false, viewport: null,
      args: [`--remote-debugging-port=${debuggingPort}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(({ origin, model }) => chrome.storage.local.set({ settings: {
      apiUrl: `${origin}/v1`, model, apiKey: "test-secret"
    } }), { origin: apiOrigin, model: apiModel });
    const page = await context.newPage();
    await page.goto(`${apiOrigin}/manifest.json`);
    await page.evaluate(() => {
      document.body.innerHTML = '<div style="position:fixed;inset:0;background:red"><div style="position:absolute;right:60px;top:100px;width:80px;height:70px;background:blue"></div></div>';
      getSelection().removeAllRanges();
    });
    const targets = async () => (await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json());
    assert.equal((await targets()).some((target) => target.url.endsWith("/src/panel.html")), false, "Панель должна быть закрыта до хоткея");
    await page.bringToFront();
    await page.waitForFunction(() => document.hasFocus());
    // Композитор Wayland должен успеть направить настоящий ввод в новое окно.
    await new Promise((resolve) => setTimeout(resolve, 150));
    // CDP keyboard.press не запускает browser commands; нужен настоящий ввод.
    execFileSync("wtype", ["-M", "ctrl", "-M", "shift", "-k", "y", "-m", "shift", "-m", "ctrl"]);
    await page.waitForSelector("#lexideck-region-overlay");
    assert.equal((await targets()).some((target) => target.url.endsWith("/src/panel.html")), false, "Панель не должна открываться во время выделения области");
    const width = await page.evaluate(() => innerWidth);
    await page.mouse.move(width - 140, 100);
    await page.mouse.down();
    await page.mouse.move(width - 60, 170);
    assert.equal(await page.evaluate(() => innerWidth), width, "Ширина страницы не должна измениться во время выделения");
    await page.mouse.up();
    let panel;
    let state;
    for (let attempt = 0; attempt < 50; attempt++) {
      panel = (await targets()).find((target) => target.url.endsWith("/src/panel.html"));
      if (panel) {
        const rendered = await evaluatePanel(panel, panelState);
        state = rendered ? JSON.parse(rendered) : undefined;
        if (state?.confirmVisible || state?.error) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(state, "Хоткей должен открыть настоящую боковую панель");
    assert.equal(state.source, "She took off her coat and wore her coat.");
    assert.equal(state.error, "");
    const calls = await (await fetch(`${apiOrigin}/__test/requests`)).json();
    const vision = calls.findLast((call) => call.body.model === apiModel && Array.isArray(call.body.messages[1].content));
    assert.ok(vision, "Распознавание должно получить изображение");
    assert.equal(calls.filter((call) => call.body.model === apiModel).length, 1, "До подтверждения должен уйти только запрос распознавания");
    assert.equal(state.confirmVisible, true, "Распознанные реплики нужно проверить перед переводом");
    const crop = await page.evaluate(async (image) => {
      const bitmap = await createImageBitmap(await (await fetch(image)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const drawing = canvas.getContext("2d");
      drawing.drawImage(bitmap, 0, 0);
      const pixel = [...drawing.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data].slice(0, 3);
      return { width: bitmap.width, height: bitmap.height, pixel, viewport: innerWidth, pixelRatio: devicePixelRatio };
    }, vision.body.messages[1].content[1].image_url.url);
    assert.ok(crop.pixel[0] <= 2 && crop.pixel[1] <= 2 && crop.pixel[2] >= 253, `API должен получить синюю область без слоя выделения: ${crop.pixel}`);
    assert.ok(Math.abs(crop.width - 80 * crop.pixelRatio) <= 1);
    assert.ok(Math.abs(crop.height - 70 * crop.pixelRatio) <= 1);
    const viewportChanged = crop.viewport < width;
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "Фокус страницы должен вернуться после выбора области");

    await clickPanel(panel, "#retry-comic");
    await page.waitForSelector("#lexideck-region-overlay");
    const retryWidth = await page.evaluate(() => innerWidth);
    await page.mouse.move(retryWidth - 140, 100);
    await page.mouse.down();
    await page.mouse.move(retryWidth - 60, 170);
    await page.mouse.up();
    for (let attempt = 0; attempt < 50; attempt++) {
      const rendered = await evaluatePanel(panel, panelState);
      state = rendered ? JSON.parse(rendered) : undefined;
      const recent = await (await fetch(`${apiOrigin}/__test/requests`)).json();
      const recognitions = recent.filter((call) => call.body.model === apiModel && Array.isArray(call.body.messages[1].content));
      if (recognitions.length === 2 && state?.confirmVisible) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(state?.confirmVisible, true, "Повторный выбор должен снова открыть проверку реплик");
    await clickPanel(panel, "#confirm-comic");
    for (let attempt = 0; attempt < 50; attempt++) {
      const rendered = await evaluatePanel(panel, panelState);
      state = rendered ? JSON.parse(rendered) : undefined;
      if (state?.translation || state?.error) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(state.translation, "Она сняла пальто и надела пальто.");
    assert.equal(state.error, "");
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.ok(!JSON.stringify(stored).includes("data:image"), "Изображение не должно сохраняться в постоянном хранилище");
    console.log(`PASS: настоящая панель → выбор и повторный выбор области → проверка реплик → подтверждённый перевод; фрагмент ${crop.width}×${crop.height} синий, viewport ${width}→${crop.viewport}${viewportChanged ? " (панель изменила ширину)" : " (панель не изменила ширину)"}.`);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
