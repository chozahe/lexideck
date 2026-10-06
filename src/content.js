chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "LEXIDECK_GET_SELECTION") {
    sendResponse({ text: window.getSelection()?.toString() ?? "" });
  }
});
