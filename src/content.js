chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "LEXIDECK_GET_SELECTION") {
    sendResponse({ text: window.getSelection()?.toString() ?? "" });
  } else if (message.type === "LEXIDECK_PREPARE_CAPTURE") {
    requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ready: true })));
    return true;
  } else if (message.type === "LEXIDECK_START_REGION_SELECTION") {
    startRegionSelection();
  }
});

function startRegionSelection() {
  if (document.getElementById("lexideck-region-overlay")) return;

  const previousFocus = document.activeElement;
  const inertStates = [...document.body.children].map((element) => [element, element.inert]);
  for (const [element] of inertStates) element.inert = true;

  const overlay = document.createElement("div");
  overlay.id = "lexideck-region-overlay";
  overlay.tabIndex = 0;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Выбор области комикса");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647", cursor: "crosshair",
    background: "rgba(15, 23, 42, .28)", touchAction: "none", userSelect: "none", outline: "none"
  });

  const hint = document.createElement("div");
  hint.id = "lexideck-region-hint";
  hint.textContent = "Перетащите рамку мышью, touch или пером. Стрелки — переместить, Shift+стрелки — изменить размер, Enter — подтвердить, Esc — отменить.";
  Object.assign(hint.style, {
    position: "absolute", top: "16px", left: "50%", transform: "translateX(-50%)",
    width: "max-content", maxWidth: "calc(100vw - 32px)", boxSizing: "border-box",
    padding: "10px 14px", borderRadius: "8px", background: "#172033", color: "white",
    font: "14px/1.4 sans-serif", boxShadow: "0 2px 12px #0006", whiteSpace: "normal"
  });
  const selection = document.createElement("div");
  Object.assign(selection.style, {
    position: "absolute", border: "2px solid #79d2ff", background: "#79d2ff33",
    boxSizing: "border-box", pointerEvents: "none"
  });
  overlay.append(hint, selection);
  overlay.setAttribute("aria-describedby", hint.id);
  document.body.append(overlay);

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const initial = viewport();
  let rect = {
    left: Math.max(0, (initial.width - Math.min(120, initial.width)) / 2),
    top: Math.max(0, (initial.height - Math.min(80, initial.height)) / 2),
    width: Math.min(120, initial.width),
    height: Math.min(80, initial.height)
  };
  let pointerId;
  let anchor;

  const draw = () => {
    selection.style.left = `${rect.left}px`;
    selection.style.top = `${rect.top}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;
  };
  const clampRect = () => {
    const size = viewport();
    rect.width = Math.max(1, Math.min(rect.width, size.width));
    rect.height = Math.max(1, Math.min(rect.height, size.height));
    rect.left = Math.max(0, Math.min(rect.left, size.width - rect.width));
    rect.top = Math.max(0, Math.min(rect.top, size.height - rect.height));
    draw();
  };
  draw();

  const removeListeners = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("wheel", blockPageEvent, true);
    window.removeEventListener("resize", clampRect);
    window.removeEventListener("scroll", blockPageEvent, true);
  };
  const restorePage = () => {
    removeListeners();
    overlay.remove();
    for (const [element, wasInert] of inertStates) {
      if (element.isConnected) element.inert = wasInert;
    }
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
  };
  const finish = (cancelled) => {
    const selected = { ...rect };
    restorePage();
    if (cancelled || selected.width < 8 || selected.height < 8) return;
    chrome.runtime.sendMessage({
      type: "LEXIDECK_REGION_SELECTED",
      rect: selected,
      viewport: viewport()
    });
  };
  function blockPageEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onKeyDown(event) {
    blockPageEvent(event);
    const size = viewport();
    const step = event.altKey ? 1 : 10;
    if (event.key === "Escape") {
      finish(true);
    } else if (event.key === "Enter") {
      finish(false);
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (event.shiftKey) {
        if (event.key === "ArrowLeft") rect.width = Math.max(8, rect.width - step);
        if (event.key === "ArrowRight") rect.width = Math.min(size.width - rect.left, rect.width + step);
        if (event.key === "ArrowUp") rect.height = Math.max(8, rect.height - step);
        if (event.key === "ArrowDown") rect.height = Math.min(size.height - rect.top, rect.height + step);
      } else {
        if (event.key === "ArrowLeft") rect.left = Math.max(0, rect.left - step);
        if (event.key === "ArrowRight") rect.left = Math.min(size.width - rect.width, rect.left + step);
        if (event.key === "ArrowUp") rect.top = Math.max(0, rect.top - step);
        if (event.key === "ArrowDown") rect.top = Math.min(size.height - rect.height, rect.top + step);
      }
      draw();
    }
  }
  function onPointerDown(event) {
    blockPageEvent(event);
    if (event.button !== 0 || pointerId !== undefined) return;
    pointerId = event.pointerId;
    anchor = {
      x: Math.max(0, Math.min(event.clientX, window.innerWidth)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight))
    };
    rect = { left: anchor.x, top: anchor.y, width: 0, height: 0 };
    draw();
  }
  function onPointerMove(event) {
    blockPageEvent(event);
    if (event.pointerId !== pointerId || !anchor) return;
    const x = Math.max(0, Math.min(event.clientX, window.innerWidth));
    const y = Math.max(0, Math.min(event.clientY, window.innerHeight));
    rect = {
      left: Math.min(anchor.x, x), top: Math.min(anchor.y, y),
      width: Math.abs(x - anchor.x), height: Math.abs(y - anchor.y)
    };
    draw();
  }
  function onPointerUp(event) {
    blockPageEvent(event);
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    anchor = undefined;
    finish(false);
  }
  function onPointerCancel(event) {
    blockPageEvent(event);
    if (event.pointerId === pointerId) finish(true);
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("wheel", blockPageEvent, true);
  window.addEventListener("resize", clampRect);
  window.addEventListener("scroll", blockPageEvent, true);
  overlay.focus({ preventScroll: true });
}
