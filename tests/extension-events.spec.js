const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test, expect } = require("@playwright/test");

function createEvent() {
  let listener;
  return {
    addListener(callback) { listener = callback; },
    emit(...args) { return listener?.(...args); }
  };
}

test("горячая клавиша и контекстное меню открывают панель с выделением", async () => {
  const menuClicks = createEvent();
  const commands = createEvent();
  const messages = createEvent();
  const backgroundMessages = createEvent();
  const installed = createEvent();
  const openedPanels = [];
  const savedValues = [];
  const menuItems = [];
  let selectedText = "Selected from page";
  const requestedActions = [];

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8"), {
    chrome: { runtime: { onMessage: messages } },
    window: { getSelection: () => ({ toString: () => selectedText }) }
  });

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), {
    chrome: {
      runtime: { onInstalled: installed, onMessage: backgroundMessages },
      contextMenus: {
        onClicked: menuClicks,
        removeAll(callback) { callback(); },
        create(item) { menuItems.push(item); }
      },
      commands: { onCommand: commands },
      storage: { local: { async set(value) { savedValues.push(value); } } },
      sidePanel: { async open(options) { openedPanels.push(options); } },
      tabs: {
        async sendMessage(_tabId, message, callback) {
          requestedActions.push(message.type);
          if (message.type === "LEXIDECK_START_REGION_SELECTION") return undefined;
          return new Promise((resolve) => messages.emit(message, {}, (value) => { callback?.(value); resolve(value); }));
        },
        query(_query, callback) { callback([{ id: 14 }]); }
      }
    }
  });

  installed.emit();
  menuClicks.emit({ menuItemId: "lexideck-translate-selection", selectionText: "From context menu" }, { windowId: 7 });
  await commands.emit("translate-selection", { id: 12, windowId: 8 });
  await new Promise((resolve) => setImmediate(resolve));
  selectedText = "";
  await commands.emit("translate-selection", { id: 13, windowId: 9 });
  backgroundMessages.emit({ type: "LEXIDECK_RESELECT_COMIC" }, {}, () => {});

  await new Promise((resolve) => setImmediate(resolve));

  expect(menuItems).toEqual([{
    id: "lexideck-translate-selection",
    title: "Перевести выделенный текст в Lexideck",
    contexts: ["selection"]
  }]);
  expect(savedValues).toEqual([
    { pendingSelection: "From context menu" },
    { pendingSelection: "Selected from page" }
  ]);
  expect(openedPanels).toEqual([{ windowId: 7 }, { windowId: 8 }]);
  expect(requestedActions).toEqual([
    "LEXIDECK_GET_SELECTION",
    "LEXIDECK_GET_SELECTION",
    "LEXIDECK_START_REGION_SELECTION",
    "LEXIDECK_START_REGION_SELECTION"
  ]);
});

test("пользователь обводит область комикса и передаёт координаты выбранного фрагмента", async ({ page }) => {
  await page.addInitScript(() => {
    window.__sentMessages = [];
    window.chrome = {
      runtime: {
        onMessage: { addListener(listener) { window.__contentMessageListener = listener; } },
        sendMessage(message) { window.__sentMessages.push(message); }
      }
    };
  });
  await page.goto("/manifest.json");
  await page.addScriptTag({ path: path.join(__dirname, "../src/content.js") });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "page-action";
    button.textContent = "Фоновое действие";
    Object.assign(button.style, { position: "fixed", left: "45px", top: "55px" });
    button.addEventListener("click", () => { window.__backgroundActions = (window.__backgroundActions || 0) + 1; });
    document.body.append(button);
  });
  await page.evaluate(() => window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" }));
  await expect(page.getByRole("dialog", { name: "Выбор области комикса" })).toBeFocused();
  await expect(page.locator("#page-action")).toHaveAttribute("inert", "");
  await page.mouse.move(50, 60);
  await page.mouse.down();
  await page.mouse.move(150, 130);
  await page.mouse.up();

  const selection = await page.evaluate(() => window.__sentMessages[0]);
  expect(selection.type).toBe("LEXIDECK_REGION_SELECTED");
  expect(selection.rect).toEqual({ left: 50, top: 60, width: 100, height: 70 });
  expect(selection.viewport.width).toBeGreaterThan(150);
  expect(await page.evaluate(() => window.__backgroundActions || 0)).toBe(0);
  expect(await page.locator("#page-action").evaluate((button) => button.inert)).toBe(false);
});

test("клавиатурный выбор ограничен viewport, Escape отменяет и восстанавливает фокус", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await page.addInitScript(() => {
    window.__sentMessages = [];
    window.chrome = { runtime: {
      onMessage: { addListener(listener) { window.__contentMessageListener = listener; } },
      sendMessage(message) { window.__sentMessages.push(message); }
    } };
  });
  await page.goto("/manifest.json");
  await page.addScriptTag({ path: path.join(__dirname, "../src/content.js") });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "focus-origin";
    document.body.append(button);
    button.focus();
    window.__backgroundKeys = 0;
    window.addEventListener("keydown", () => { window.__backgroundKeys += 1; });
    window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" });
  });
  const overlay = page.getByRole("dialog", { name: "Выбор области комикса" });
  await expect(overlay).toBeFocused();
  const hint = page.locator("#lexideck-region-hint");
  await expect(hint).toContainText("Shift+стрелки");
  expect(await hint.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Tab");
  await expect(overlay).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowDown");
  const moved = await page.locator("#lexideck-region-overlay > div:last-child").evaluate((selection) => {
    const bounds = selection.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  });
  expect(moved.left).toBe(90);
  expect(moved.width).toBe(120);
  expect(moved.height).toBe(90);
  await page.keyboard.press("Enter");
  const selected = await page.evaluate(() => window.__sentMessages[0]);
  expect(selected.rect).toEqual({ left: 90, top: 210, width: 120, height: 90 });
  expect(selected.viewport).toEqual({ width: 320, height: 500 });
  await expect(page.locator("#focus-origin")).toBeFocused();
  expect(await page.evaluate(() => window.__backgroundKeys)).toBe(0);

  await page.evaluate(() => window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" }));
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__sentMessages)).toHaveLength(1);
  await expect(page.locator("#focus-origin")).toBeFocused();
});

test("Pointer Events принимают pen и touch, ограничивая область границами viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 240 });
  await page.addInitScript(() => {
    window.__sentMessages = [];
    window.chrome = { runtime: {
      onMessage: { addListener(listener) { window.__contentMessageListener = listener; } },
      sendMessage(message) { window.__sentMessages.push(message); }
    } };
  });
  await page.goto("/manifest.json");
  await page.addScriptTag({ path: path.join(__dirname, "../src/content.js") });
  await page.evaluate(() => window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" }));
  await page.evaluate(() => {
    const overlay = document.getElementById("lexideck-region-overlay");
    const dispatch = (type, x, y) => overlay.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
      button: 0, clientX: x, clientY: y
    }));
    dispatch("pointerdown", 280, 200);
    dispatch("pointermove", 400, 300);
  });
  await page.setViewportSize({ width: 300, height: 220 });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.evaluate(() => {
    const overlay = document.getElementById("lexideck-region-overlay");
    overlay.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true,
      button: 0, clientX: 400, clientY: 300
    }));
  });
  const selected = await page.evaluate(() => window.__sentMessages[0]);
  expect(selected.rect).toEqual({ left: 260, top: 180, width: 40, height: 40 });
  expect(selected.viewport).toEqual({ width: 300, height: 220 });

  await page.evaluate(() => window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" }));
  await page.evaluate(() => {
    const overlay = document.getElementById("lexideck-region-overlay");
    const dispatch = (type, x, y) => overlay.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 8, pointerType: "touch", isPrimary: true,
      button: 0, clientX: x, clientY: y
    }));
    dispatch("pointerdown", 20, 40);
    dispatch("pointermove", 80, 100);
    dispatch("pointerup", 80, 100);
  });
  expect(await page.evaluate(() => window.__sentMessages[1].rect)).toEqual({ left: 20, top: 40, width: 60, height: 60 });
});
