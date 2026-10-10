const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("поиск находит основную форму и значение, а карточка раскрывает сохранённые детали", async ({ page }) => {
  await page.goto("/src/vocabulary.html");
  await expect(page.locator("#vocabulary-empty")).toBeVisible();
  await expect(page.locator("#vocabulary-no-results")).toBeHidden();

  await page.evaluate(async () => {
    await chrome.storage.local.set({
      cards: [
        {
          id: "word-card",
          kind: "word",
          headword: "Take Off",
          meanings: [{
            text: "снять одежду",
            contexts: [{ form: "took off", text: "She took off her coat." }],
            examples: ["She took off her shoes.", "Take off your jacket."]
          }],
          schedule: { due: "2026-10-12T12:00:00.000Z" }
        },
        {
          id: "expression-card",
          kind: "expression",
          headword: "let the cat out of the bag",
          meanings: [{
            text: "раскрыть секрет",
            contexts: [{ form: "let the cat out of the bag", text: "He let the cat out of the bag." }],
            examples: ["She let the cat out of the bag by mistake."]
          }]
        }
      ]
    });
  });
  await page.reload();

  const cards = page.locator("#vocabulary-cards details");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator(".vocabulary-meaning h3")).toBeHidden();
  await expect(cards.nth(1).locator(".vocabulary-meaning h3")).toBeHidden();
  await expect(cards.nth(0).locator("summary")).toContainText("Take Off");
  await expect(cards.nth(0).locator("summary")).toContainText("Следующее повторение");

  await page.getByLabel("Поиск по основной форме или значению").fill("TAKE OFF");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("summary")).toContainText("Take Off");

  await page.getByLabel("Поиск по основной форме или значению").fill("ОДЕЖДУ");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("summary")).toContainText("Take Off");

  await page.getByLabel("Поиск по основной форме или значению").fill("CAT OUT");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("summary")).toContainText("let the cat out of the bag");
  await page.getByLabel("Поиск по основной форме или значению").fill("СЕКРЕТ");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("summary")).toContainText("let the cat out of the bag");

  await page.getByLabel("Поиск по основной форме или значению").fill("нет такого слова");
  await expect(cards).toHaveCount(0);
  await expect(page.locator("#vocabulary-no-results")).toBeVisible();

  await page.getByLabel("Поиск по основной форме или значению").fill("");
  await expect(cards).toHaveCount(2);
  const firstSummary = cards.nth(0).locator("summary");
  await firstSummary.focus();
  await page.keyboard.press("Enter");
  await expect(cards.nth(0).locator(".vocabulary-meaning h3")).toBeVisible();
  await expect(cards.nth(0)).toContainText("снять одежду");
  await expect(cards.nth(0)).toContainText("took off: She took off her coat.");
  await expect(cards.nth(0)).toContainText("She took off her shoes.");
  await firstSummary.focus();
  await page.keyboard.press("Enter");
  await expect(cards.nth(0).locator(".vocabulary-meaning h3")).toBeHidden();
});

test("карточка, сохранённая в панели, появляется в открытом словаре", async ({ page }) => {
  await page.goto("/src/settings.html");
  await page.locator("#api-url").fill(new URL("/v1", page.url()).href);
  await page.locator("#model").fill("controlled-model");
  await page.locator("#api-key").fill("test-secret");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.locator("#settings-status")).toContainText("Настройки сохранены");

  await page.goto("/src/panel.html");
  await page.locator("#source-text").fill("She took off her coat and wore her coat.");
  await page.locator("#translate").click();
  await expect(page.locator("#word-meanings li")).toHaveCount(3);

  const [vocabulary] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Словарь", exact: true }).click()
  ]);
  await expect(vocabulary.locator("#vocabulary-empty")).toBeVisible();

  await page.locator("#word-meanings li").filter({ hasText: "took off —" }).getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator("#word-meanings li").filter({ hasText: "took off —" }).getByRole("button", { name: "Сохранено" })).toBeVisible();
  await expect(vocabulary.locator("#vocabulary-cards summary")).toContainText("take off");
  await expect(vocabulary.locator("#vocabulary-empty")).toBeHidden();
  await expect(vocabulary.locator("#vocabulary-cards .vocabulary-meaning h3")).toBeHidden();
});
