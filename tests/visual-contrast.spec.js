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
      const button = page.locator(selector);
      await button.focus();
      const normal = await button.evaluate((element) => ({
        foreground: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor
      }));
      expect(contrast(normal.foreground, normal.background), `${theme} ${path} normal`).toBeGreaterThanOrEqual(4.5);

      await button.hover();
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
