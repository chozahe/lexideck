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

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8"), {
    chrome: { runtime: { onMessage: messages } },
    window: { getSelection: () => ({ toString: () => "Selected from page" }) }
  });

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), {
    chrome: {
      runtime: { onInstalled: installed },
      contextMenus: {
        onClicked: menuClicks,
        removeAll(callback) { callback(); },
        create(item) { menuItems.push(item); }
      },
      commands: { onCommand: commands },
      storage: { local: { async set(value) { savedValues.push(value); } } },
      sidePanel: { async open(options) { openedPanels.push(options); } },
      tabs: {
        async sendMessage(_tabId, message) {
          return new Promise((resolve) => messages.emit(message, {}, resolve));
        }
      }
    }
  });

  installed.emit();
  menuClicks.emit({ menuItemId: "lexideck-translate-selection", selectionText: "From context menu" }, { windowId: 7 });
  await commands.emit("translate-selection", { id: 12, windowId: 8 });

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
});
