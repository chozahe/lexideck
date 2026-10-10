const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("системная тема следует за режимом браузера", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/src/settings.html");
  await expect(page.locator("#theme-preference")).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "latte");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "macchiato");
  await expect(page.locator("#theme-preference")).toHaveValue("system");
});

test("выбор Latte или Macchiato сохраняется и обновляет все открытые поверхности", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/src/settings.html");
  const preference = page.locator("#theme-preference");
  await expect(preference).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "macchiato");

  await preference.selectOption("latte");
  await expect(page.locator("#theme-status")).toHaveText("Тема сохранена для панели и страниц.");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "latte");

  const pages = [];
  for (const path of ["panel.html", "review.html", "vocabulary.html"]) {
    const surface = await context.newPage();
    await surface.goto(`/src/${path}`);
    await expect(surface.locator("html")).toHaveAttribute("data-theme", "latte");
    pages.push(surface);
  }

  await preference.selectOption("macchiato");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "macchiato");
  for (const surface of pages) {
    await expect(surface.locator("html")).toHaveAttribute("data-theme", "macchiato");
  }

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "macchiato");
  await page.reload();
  await expect(page.locator("#theme-preference")).toHaveValue("macchiato");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "macchiato");
  for (const surface of pages) await surface.close();
});

test("основные действия разделов доступны с клавиатуры", async ({ page }) => {
  await page.goto("/src/panel.html");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к повторению" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Настройки" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Словарь" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#source-text")).toBeFocused();

  await page.evaluate(async () => chrome.storage.local.set({
    cards: [{
      id: "keyboard-card",
      kind: "word",
      headword: "word",
      meanings: [{ text: "слово", contexts: [{ form: "word", text: "A word." }], examples: ["A new word."] }]
    }]
  }));
  await page.goto("/src/review.html");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Начать занятие" })).toBeFocused();
  await page.keyboard.press("Enter");
  const answer = page.getByRole("button", { name: "Показать ответ" });
  await expect(answer).toBeVisible();
  await answer.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("слово", { exact: true })).toBeVisible();

  await page.goto("/src/vocabulary.html");
  const summary = page.locator("#vocabulary-cards summary");
  await expect(summary).toBeVisible();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".vocabulary-meaning h3")).toBeVisible();

  await page.goto("/src/settings.html");
  const preference = page.locator("#theme-preference");
  await preference.focus();
  await page.keyboard.press("ArrowDown");
  await expect(preference).toHaveValue("latte");
  await expect(page.locator("#theme-status")).toContainText("Тема сохранена");
});
