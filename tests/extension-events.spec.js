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
      runtime: { onInstalled: installed, onMessage: createEvent() },
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
        }
      }
    }
  });

  installed.emit();
  menuClicks.emit({ menuItemId: "lexideck-translate-selection", selectionText: "From context menu" }, { windowId: 7 });
  await commands.emit("translate-selection", { id: 12, windowId: 8 });
  await new Promise((resolve) => setImmediate(resolve));
  selectedText = "";
  await commands.emit("translate-selection", { id: 13, windowId: 9 });

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
  await page.evaluate(() => window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" }));
  await page.mouse.move(50, 60);
  await page.mouse.down();
  await page.mouse.move(150, 130);
  await page.mouse.up();

  const selection = await page.evaluate(() => window.__sentMessages[0]);
  expect(selection.type).toBe("LEXIDECK_REGION_SELECTED");
  expect(selection.rect).toEqual({ left: 50, top: 60, width: 100, height: 70 });
  expect(selection.viewport.width).toBeGreaterThan(150);
});
