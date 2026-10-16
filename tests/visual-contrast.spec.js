const { test, expect } = require("@playwright/test");

function contrast(foreground, background) {
  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("активные основные кнопки и статусы имеют контраст 4,5:1 в Latte и Macchiato", async ({ page }) => {
  for (const theme of ["latte", "macchiato"]) {
    await page.goto("/src/settings.html");
    await page.locator("#theme-preference").selectOption(theme);
    for (const [path, selector] of [
      ["panel.html", "#translate"],
      ["review.html", "#start-review"],
      ["vocabulary.html", "#export-backup"],
      ["settings.html", '#settings-form button[type="submit"]']
    ]) {
      await page.goto(`/src/${path}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      const button = page.locator(selector);
      if (path === "panel.html") await page.locator("#source-text").fill("Contrast check");
      await expect(button).toBeEnabled();
      await button.focus();
      const normal = await button.evaluate((element) => ({
        foreground: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor
      }));
      expect(contrast(normal.foreground, normal.background), `${theme} ${path} normal`).toBeGreaterThanOrEqual(4.5);

      await button.hover();
      await page.waitForTimeout(150);
      const hover = await button.evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      expect(contrast(hover.foreground, hover.background), `${theme} ${path} hover`).toBeGreaterThanOrEqual(4.5);

      await button.focus();
      const focus = await button.evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, outline: getComputedStyle(element).outlineColor }));
      expect(contrast(focus.foreground, focus.background), `${theme} ${path} focus`).toBeGreaterThanOrEqual(4.5);
      expect(focus.outline).not.toBe("rgba(0, 0, 0, 0)");

      await page.mouse.move(0, 0);
      await button.hover();
      await page.mouse.down();
      const active = await button.evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      await page.mouse.up();
      expect(contrast(active.foreground, active.background), `${theme} ${path} active`).toBeGreaterThanOrEqual(4.5);
    }
    await page.goto("/src/settings.html");
    await page.locator("#theme-preference").selectOption(theme);
    for (const [selector, state] of [["#theme-status", "success"], ["#settings-status", "error"], ["#api-test-status", "error"], ["#api-test-status", "pending"]]) {
      const color = await page.locator(selector).evaluate((element, value) => {
        element.dataset.state = value;
        element.textContent = "Проверочное состояние";
        return { foreground: getComputedStyle(element).color, background: getComputedStyle(document.querySelector("section")).backgroundColor };
      }, state);
      expect(contrast(color.foreground, color.background), `${theme} ${selector} ${state}`).toBeGreaterThanOrEqual(4.5);
    }
    const neutral = await page.goto("/src/vocabulary.html").then(() => page.locator("#backup-status").evaluate((element) => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(document.querySelector("section")).backgroundColor
    })));
    expect(contrast(neutral.foreground, neutral.background), `${theme} neutral status`).toBeGreaterThanOrEqual(4.5);
  }
});

test("все доступные действия и сроки оценки сохраняют контраст во всех интерактивных состояниях", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.__contrastProbeActive = false;
    window.__effectiveBackground = (element) => {
      let current = element;
      while (current) {
        const color = getComputedStyle(current).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    document.addEventListener("click", (event) => {
      if (window.__contrastProbeActive) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  });
  const inspect = async (button, label) => {
    await button.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    const normal = await button.evaluate((element) => [getComputedStyle(element).color, window.__effectiveBackground(element)]);
    expect(contrast(...normal), `${label} normal`).toBeGreaterThanOrEqual(4.5);
    await button.hover();
    await page.waitForTimeout(150);
    const hover = await button.evaluate((element) => [getComputedStyle(element).color, window.__effectiveBackground(element)]);
    expect(contrast(...hover), `${label} hover`).toBeGreaterThanOrEqual(4.5);
    await button.focus();
    const focus = await button.evaluate((element) => [getComputedStyle(element).color, window.__effectiveBackground(element)]);
    expect(contrast(...focus), `${label} focus`).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    await button.hover();
    await page.evaluate(() => { window.__contrastProbeActive = true; });
    await page.mouse.down();
    const active = await button.evaluate((element) => [getComputedStyle(element).color, window.__effectiveBackground(element)]);
    await page.mouse.up();
    await page.evaluate(() => { window.__contrastProbeActive = false; });
    expect(contrast(...active), `${label} active`).toBeGreaterThanOrEqual(4.5);
  };

  for (const theme of ["latte", "macchiato"]) {
    await page.goto("/src/settings.html");
    await page.locator("#theme-preference").selectOption(theme);
    const origin = new URL(page.url()).origin;
    const card = { id: "contrast-card", kind: "word", headword: "contrast", meanings: [{
      text: "значение", contexts: [{ form: "contrast", text: "Контекст." }], examples: ["Пример."]
    }] };
    await page.evaluate(async ({ origin, card }) => chrome.storage.local.set({
      settings: { apiUrl: `${origin}/v1`, apiKey: "contrast-key", model: "contrast-model" }, cards: [card]
    }), { origin, card });

    await page.goto("/src/panel.html");
    await page.locator("#source-text").fill("She took off her coat and wore her coat.");
    await page.locator("#source-text").evaluate((element) => { element.setSelectionRange(4, 12); element.dispatchEvent(new Event("select", { bubbles: true })); });
    await page.locator("#translate").click();
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#word-meanings li button").first()).toBeEnabled();
    for (const button of await page.locator("button:visible:not(:disabled)").all()) await inspect(button, `${theme} panel ${await button.innerText()}`);

    await page.goto("/src/vocabulary.html");
    await page.locator("#vocabulary-cards summary").click();
    for (const button of await page.locator("button:visible:not(:disabled)").all()) await inspect(button, `${theme} vocabulary ${await button.innerText()}`);

    await page.goto("/src/review.html");
    await page.getByRole("button", { name: "Начать занятие" }).click();
    await page.getByRole("button", { name: "Показать ответ" }).click();
    for (const button of await page.locator("button:visible:not(:disabled)").all()) {
      const label = await button.innerText();
      await inspect(button, `${theme} review ${label}`);
      for (const due of await button.locator(".rating-due").all()) {
        const colors = await due.evaluate((element) => [getComputedStyle(element).color, window.__effectiveBackground(element.parentElement)]);
        expect(contrast(...colors), `${theme} review ${label} due label`).toBeGreaterThanOrEqual(4.5);
      }
    }

    await page.goto("/src/settings.html");
    for (const input of ["#api-url", "#model", "#api-key"]) await page.locator(input).fill(input === "#api-url" ? `${origin}/v1` : "contrast");
    for (const button of await page.locator("button:visible:not(:disabled)").all()) await inspect(button, `${theme} settings ${await button.innerText()}`);
  }
});
