const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("настройки сохраняются после перезагрузки и применяются в панели перевода", async ({ page, request }) => {
  await page.goto("/src/settings.html");
  await page.locator("#source-language").fill("Spanish");
  await page.locator("#target-language").fill("French");
  await page.locator("#api-url").fill("http://127.0.0.1:4173/v1");
  await page.locator("#model").fill("settings-model");
  await page.locator("#api-key").fill("settings-secret");
  await page.locator("#new-card-limit").fill("4");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.locator("#settings-status")).toHaveText("Настройки сохранены на этом устройстве.");

  await page.reload();
  await expect(page.locator("#source-language")).toHaveValue("Spanish");
  await expect(page.locator("#target-language")).toHaveValue("French");
  await expect(page.locator("#model")).toHaveValue("settings-model");
  await expect(page.locator("#new-card-limit")).toHaveValue("4");
  expect(await page.locator("#api-key").inputValue()).toBe("settings-secret");

  await page.goto("/src/panel.html");
  await page.locator("#source-text").fill("She took off her coat and wore her coat.");
  await page.getByRole("button", { name: "Перевести" }).click();
  await expect(page.locator("#sentence-translation")).toBeVisible();
  const call = await (await request.get("/__test/last-request")).json();
  expect(call.headers.authorization).toBe("Bearer settings-secret");
  expect(call.body.model).toBe("settings-model");
  expect(call.body.messages[0].content).toContain("с Spanish на French");
});

test("навигация страницы содержит повторение, словарь и настройки", async ({ page }) => {
  await page.goto("/src/settings.html");
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(nav.getByRole("link", { name: "Повторение" })).toHaveAttribute("href", "review.html");
  await expect(nav.getByRole("link", { name: "Словарь" })).toHaveAttribute("href", "vocabulary.html");
  await expect(nav.getByRole("link", { name: "Настройки" })).toHaveAttribute("aria-current", "page");
});

test("несохранённые настройки удерживают на странице и сохраняют введённые значения", async ({ page }) => {
  await page.goto("/src/settings.html");
  await page.locator("#source-language").fill("Japanese");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Словарь" }).click();
  await expect(page).toHaveURL(/settings\.html$/);
  await expect(page.locator("#source-language")).toHaveValue("Japanese");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Словарь" }).click();
  await expect(page).toHaveURL(/vocabulary\.html$/);
});

test("сохранение снимает предупреждение, а ошибка оставляет форму несохранённой", async ({ page }) => {
  await page.goto("/src/settings.html");
  await page.locator("#target-language").fill("German");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.locator("#settings-status")).toHaveText("Настройки сохранены на этом устройстве.");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Словарь" }).click();
  await expect(page).toHaveURL(/vocabulary\.html$/);

  await page.goto("/src/settings.html");
  await page.evaluate(() => localStorage.setItem("lexideck-test-storage-fail-set", "true"));
  await page.locator("#target-language").fill("Italian");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.locator("#settings-status")).toContainText("Не удалось сохранить настройки");
  await expect(page.locator("#target-language")).toHaveValue("Italian");
  await expect(page.locator("#settings-form")).toHaveAttribute("data-dirty", "true");
});
