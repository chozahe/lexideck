const MENU_ID = "lexideck-translate-selection";
const COMIC_REQUEST_KEY = "pendingComicRequest";
let currentComicRequest;

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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "translate-selection" || tab?.windowId == null) return;
  // Callback сохраняет user gesture в Brave; await перед open() его теряет.
  chrome.tabs.sendMessage(tab.id, { type: "LEXIDECK_GET_SELECTION" }, (response) => {
    if (chrome.runtime.lastError) {
      void openPanel(tab.windowId);
      return;
    }
    if (response?.text?.trim()) {
      void openPanel(tab.windowId, response.text.trim());
    } else {
      void chrome.tabs.sendMessage(tab.id, { type: "LEXIDECK_START_REGION_SELECTION" });
    }
  });
});

async function cropVisibleTab(screenshot, rect, viewport) {
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
  if (message.type === "LEXIDECK_RESELECT_COMIC") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
      if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: "LEXIDECK_START_REGION_SELECTION" });
    });
    sendResponse({ ok: true });
    return;
  }
  if (message.type !== "LEXIDECK_REGION_SELECTED" || sender.tab?.windowId == null) return;
  const id = crypto.randomUUID();
  currentComicRequest = id;
  const storing = chrome.storage.session.set({ [COMIC_REQUEST_KEY]: { id, state: "capturing" } });
  chrome.tabs.sendMessage(sender.tab.id, { type: "LEXIDECK_PREPARE_CAPTURE" }, () => {
    // Callback сообщения сохраняет жест до перерисовки content script.
    const preparationError = chrome.runtime.lastError?.message;
    // Снимок фиксируется до изменения ширины страницы. Callback сохраняет user gesture.
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (screenshot) => {
      const captureError = preparationError || chrome.runtime.lastError?.message;
      const opening = chrome.sidePanel.open({ windowId: sender.tab.windowId });
      void (async () => {
        try {
          await Promise.all([storing, opening]);
          if (captureError) throw new Error(captureError);
          const image = await cropVisibleTab(screenshot, message.rect, message.viewport);
          if (currentComicRequest === id) {
            await chrome.storage.session.set({ [COMIC_REQUEST_KEY]: { id, state: "image", image } });
          }
          sendResponse({ ok: true });
        } catch (error) {
          if (currentComicRequest === id) {
            await chrome.storage.session.set({ [COMIC_REQUEST_KEY]: { id, state: "error", error: error.message || "Не удалось захватить область страницы." } });
          }
          sendResponse({ ok: false });
        }
      })();
    });
  });
  return true;
});
