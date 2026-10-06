chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "LEXIDECK_GET_SELECTION") {
    sendResponse({ text: window.getSelection()?.toString() ?? "" });
  } else if (message.type === "LEXIDECK_START_REGION_SELECTION") {
    startRegionSelection();
  }
});

function startRegionSelection() {
  if (document.getElementById("lexideck-region-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "lexideck-region-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647", cursor: "crosshair",
    background: "rgba(15, 23, 42, .28)", touchAction: "none", userSelect: "none"
  });
  const hint = document.createElement("div");
  hint.textContent = "Выделите область комикса мышью · Esc — отмена";
  Object.assign(hint.style, {
    position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
    padding: "10px 14px", borderRadius: "8px", background: "#172033", color: "white",
    font: "14px sans-serif", boxShadow: "0 2px 12px #0006", whiteSpace: "nowrap"
  });
  const selection = document.createElement("div");
  Object.assign(selection.style, {
    position: "absolute", border: "2px solid #79d2ff", background: "#79d2ff33",
    boxSizing: "border-box", display: "none"
  });
  overlay.append(hint, selection);
  document.documentElement.append(overlay);

  let start;
  const finish = (cancelled) => {
    const rect = !cancelled && start ? selection.getBoundingClientRect() : null;
    overlay.remove();
    window.removeEventListener("keydown", onKeyDown, true);
    if (!rect || rect.width < 8 || rect.height < 8) return;
    chrome.runtime.sendMessage({
      type: "LEXIDECK_REGION_SELECTED",
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight }
    });
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(true);
    }
  };
  overlay.addEventListener("mousedown", (event) => {
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    selection.style.left = `${start.x}px`;
    selection.style.top = `${start.y}px`;
    selection.style.width = "0";
    selection.style.height = "0";
    selection.style.display = "block";
  });
  overlay.addEventListener("mousemove", (event) => {
    if (!start) return;
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${Math.abs(event.clientX - start.x)}px`;
    selection.style.height = `${Math.abs(event.clientY - start.y)}px`;
  });
  overlay.addEventListener("mouseup", () => finish(false), { once: true });
  window.addEventListener("keydown", onKeyDown, true);
}
