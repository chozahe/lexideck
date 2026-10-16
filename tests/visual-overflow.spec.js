const { test, expect } = require("@playwright/test");

const longWord = "слово".repeat(36);
const longText = "контекст пример ошибка значение длинная запись ".repeat(18);
const card = {
  id: "long-visual-card",
  kind: "word",
  headword: longWord,
  meanings: [{ text: longText, contexts: [{ form: longWord, text: longText }], examples: [longText] }]
};

async function expectNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    targets: [...document.querySelectorAll("body *")]
      .filter((element) => element.offsetWidth > 0 && getComputedStyle(element).overflowX !== "hidden")
      .map((element) => ({
        selector: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
        client: element.clientWidth,
        scroll: element.scrollWidth
      }))
      .filter((element) => element.scroll > element.client + 1)
      .slice(0, 8)
  }));
  expect(metrics.page, `${label}: document scrollWidth=${metrics.page}, clientWidth=${metrics.viewport}; ${JSON.stringify(metrics.targets)}`).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.body, `${label}: body scrollWidth=${metrics.body}, clientWidth=${metrics.viewport}`).toBeLessThanOrEqual(metrics.viewport);
  return metrics;
}

test("длинный текст остаётся доступен на четырёх экранах и не расширяет страницу", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/src/settings.html");
  await page.locator("#theme-preference").selectOption("latte");
  await page.evaluate(async (longCard) => chrome.storage.local.set({ cards: [longCard] }), card);

  const report = [];
  for (const [width, height, zoom] of [[320, 225, "400% эквивалент CSS viewport"], [390, 844, "обычный мобильный viewport"], [640, 450, "200% эквивалент CSS viewport"], [1280, 900, "desktop viewport"]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["latte", "macchiato", "system-light", "system-dark"]) {
      if (theme === "system-light") {
        await page.emulateMedia({ colorScheme: "light" });
        await page.evaluate(() => chrome.storage.local.set({ themePreference: "system" }));
      } else if (theme === "system-dark") {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.evaluate(() => chrome.storage.local.set({ themePreference: "system" }));
      } else {
        await page.evaluate((value) => chrome.storage.local.set({ themePreference: value }), theme);
      }

      await page.goto("/src/panel.html");
      await page.locator("#source-text").fill(longWord);
      await page.locator("#error").evaluate((element, text) => { element.textContent = text; element.scrollIntoView(); }, longText);
      report.push([width, theme, "перевод", await expectNoHorizontalOverflow(page, `${width}px ${theme} перевод`)]);
      if (width === 320 && ["latte", "macchiato"].includes(theme)) await page.screenshot({ path: `/tmp/lexideck-visual-panel-${theme}.png`, fullPage: true });

      await page.goto("/src/vocabulary.html");
      await page.locator(".vocabulary-card summary").click();
      await expect(page.locator(".vocabulary-meaning h3")).toContainText(longText);
      report.push([width, theme, "словарь", await expectNoHorizontalOverflow(page, `${width}px ${theme} словарь`)]);
      if (width === 320 && ["latte", "macchiato"].includes(theme)) await page.screenshot({ path: `/tmp/lexideck-visual-vocabulary-${theme}.png`, fullPage: true });

      await page.goto("/src/review.html");
      await page.getByRole("button", { name: "Начать занятие" }).click();
      await page.getByRole("button", { name: "Показать ответ" }).click();
      await expect(page.locator("#review-meaning")).toContainText(longText);
      await page.locator("#review-contexts").scrollIntoViewIfNeeded();
      await page.locator("#review-example-details summary").click();
      report.push([width, theme, "повторение", await expectNoHorizontalOverflow(page, `${width}px ${theme} повторение`)]);
      if (width === 320 && ["latte", "macchiato"].includes(theme)) await page.screenshot({ path: `/tmp/lexideck-visual-review-${theme}.png`, fullPage: true });

      await page.goto("/src/settings.html");
      await page.locator("#settings-status").evaluate((element, text) => { element.textContent = text; element.dataset.state = "error"; }, longText);
      report.push([width, theme, "настройки", await expectNoHorizontalOverflow(page, `${width}px ${theme} настройки`)]);
      if (width === 320 && ["latte", "macchiato"].includes(theme)) await page.screenshot({ path: `/tmp/lexideck-visual-settings-${theme}.png`, fullPage: true });
    }
  }
  console.log("VISUAL_OVERFLOW_METRICS", JSON.stringify(report));
});
