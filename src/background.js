const MENU_ID = "lexideck-translate-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Перевести выделенный текст в Lexideck",
      contexts: ["selection"]
    });
  });
});

function openPanel(windowId, text) {
  const opening = chrome.sidePanel.open({ windowId });
  const storing = text ? chrome.storage.local.set({ pendingSelection: text }) : Promise.resolve();
  return Promise.all([opening, storing]);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.windowId != null) {
    void openPanel(tab.windowId, info.selectionText?.trim());
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "translate-selection" || tab?.windowId == null) return;
  const opening = chrome.sidePanel.open({ windowId: tab.windowId });
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "LEXIDECK_GET_SELECTION" });
    if (response?.text?.trim()) await chrome.storage.local.set({ pendingSelection: response.text.trim() });
  } catch {
    // На ограниченных страницах браузера нельзя отправить сообщение content script.
  }
  await opening;
});
