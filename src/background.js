const MENU_ID = "lexideck-translate-selection";
const COMIC_IMAGE_KEY = "pendingComicImage";

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
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "LEXIDECK_GET_SELECTION" });
    if (response?.text?.trim()) {
      await openPanel(tab.windowId, response.text.trim());
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "LEXIDECK_START_REGION_SELECTION" });
  } catch {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

async function cropVisibleTab(windowId, rect, viewport) {
  const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const source = await createImageBitmap(await (await fetch(screenshot)).blob());
  const scaleX = source.width / viewport.width;
  const scaleY = source.height / viewport.height;
  const left = Math.max(0, Math.floor(rect.left * scaleX));
  const top = Math.max(0, Math.floor(rect.top * scaleY));
  const right = Math.min(source.width, Math.ceil((rect.left + rect.width) * scaleX));
  const bottom = Math.min(source.height, Math.ceil((rect.top + rect.height) * scaleY));
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) throw new Error("Не удалось определить выбранную область.");

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(source, left, top, width, height, 0, 0, width, height);
  source.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "LEXIDECK_REGION_SELECTED" || sender.tab?.windowId == null) return;
  void (async () => {
    try {
      const image = await cropVisibleTab(sender.tab.windowId, message.rect, message.viewport);
      await chrome.storage.session.set({ [COMIC_IMAGE_KEY]: image });
      await chrome.sidePanel.open({ windowId: sender.tab.windowId });
      sendResponse({ ok: true });
    } catch (error) {
      await chrome.storage.session.set({ pendingComicError: error.message || "Не удалось захватить область страницы." });
      await chrome.sidePanel.open({ windowId: sender.tab.windowId });
      sendResponse({ ok: false });
    }
  })();
  return true;
});
