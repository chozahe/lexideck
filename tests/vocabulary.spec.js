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
  await expect(firstSummary).toBeFocused();
  await page.keyboard.press("Space");
  await expect(cards.nth(0)).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(cards.nth(0)).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(cards.nth(0).locator(".vocabulary-meaning h3")).toBeVisible();
  await expect(cards.nth(0)).toHaveAttribute("open", "");
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

test("1000 карточек индексируются целиком и просматриваются страницами по 50", async ({ page }) => {
  await page.goto("/src/vocabulary.html");
  await page.evaluate(async () => {
    const cards = Array.from({ length: 1000 }, (_, i) => ({
      id: `card-${i}`,
      kind: "word",
      headword: `word-${String(i).padStart(4, "0")}`,
      meanings: [{ text: i === 997 ? "needle at the end" : `meaning-${i}`, contexts: [{ form: "form", text: `context-${i}` }], examples: [] }]
    }));
    await chrome.storage.local.set({ cards });
  });
  const searchStarted = Date.now();
  await expect(page.locator("#vocabulary-cards details")).toHaveCount(50);
  await expect(page.locator("#vocabulary-page-status")).toHaveText("1 / 20 · карточек: 1000");
  await page.getByLabel("Поиск по основной форме или значению").fill("NEEDLE AT THE END");
  await expect(page.locator("#vocabulary-cards summary")).toContainText("word-0997");
  const searchMs = Date.now() - searchStarted;
  await expect(page.locator("#vocabulary-cards .vocabulary-meaning")).toHaveCount(0);
  await page.getByLabel("Поиск по основной форме или значению").fill("word-099");
  await page.getByLabel("Поиск по основной форме или значению").fill("word-0999");
  await expect(page.locator("#vocabulary-cards summary")).toContainText("word-0999");
  await page.getByLabel("Поиск по основной форме или значению").fill("");
  for (let n = 0; n < 19; n += 1) await page.getByRole("button", { name: "Вперёд" }).click();
  await expect(page.locator("#vocabulary-page-status")).toHaveText("20 / 20 · карточек: 1000");
  const navigationMs = Date.now() - searchStarted - searchMs;
  await expect(page.locator("#vocabulary-cards summary").first()).toContainText("word-0950");
  await page.locator("#vocabulary-cards summary").first().click();
  await expect(page.locator("#vocabulary-cards .vocabulary-meaning h3")).toBeVisible();
  console.log(`Профиль словаря (1000 карточек): поиск ${searchMs} мс; 19 переходов и раскрытие ${navigationMs} мс; ${await page.evaluate(() => navigator.userAgent)}.`);
});

test("изменение другой вкладкой сохраняет раскрытие и фокус по id", async ({ page, context }) => {
  await page.goto("/src/vocabulary.html");
  await page.evaluate(async () => chrome.storage.local.set({ cards: [
    { id: "stable-a", kind: "word", headword: "alpha", meanings: [{ text: "first", contexts: [], examples: [] }] },
    { id: "stable-b", kind: "word", headword: "beta", meanings: [{ text: "second", contexts: [], examples: [] }] }
  ] }));
  const beta = page.locator('[data-card-id="stable-b"]');
  await beta.locator("summary").focus();
  await page.keyboard.press("Enter");
  const otherTab = await context.newPage();
  await otherTab.goto("/src/vocabulary.html");
  await otherTab.evaluate(async () => {
    const { cards } = await chrome.storage.local.get("cards");
    cards[0].meanings[0].text = "updated elsewhere";
    await chrome.storage.local.set({ cards });
  });
  await expect(beta.locator("summary")).toBeFocused();
  await expect(beta).toHaveAttribute("open", "");
  await expect(page.locator("#vocabulary-status")).toContainText("другом окне");
});

test("URL сохраняет поиск, страницу и раскрытие, а Back/Forward восстанавливает состояние", async ({ page }) => {
  await page.goto("/src/vocabulary.html");
  await page.evaluate(async () => chrome.storage.local.set({ cards: Array.from({ length: 120 }, (_, i) => ({
    id: `card-${i}`, kind: "word", headword: `word-${String(i).padStart(3, "0")}`,
    meanings: [{ text: `meaning-${i}`, contexts: [], examples: [] }]
  })) }));
  await page.goto(`${page.url().split("?")[0]}?q=word&page=2&open=card-65&api_key=secret&source=private`);
  await expect(page.locator("#vocabulary-search")).toHaveValue("word");
  await expect(page.locator("#vocabulary-page-status")).toHaveText("2 / 3 · карточек: 120");
  await expect(page.locator('[data-card-id="card-65"]')).toHaveAttribute("open", "");
  await expect(page).not.toHaveURL(/api_key|source=private/);
  await page.reload();
  await expect(page.locator('[data-card-id="card-65"]')).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Вперёд" }).click();
  await expect(page.locator("#vocabulary-page-status")).toHaveText("3 / 3 · карточек: 120");
  await page.goBack();
  await expect(page.locator("#vocabulary-page-status")).toHaveText("2 / 3 · карточек: 120");
  await expect(page.locator('[data-card-id="card-65"]')).toHaveAttribute("open", "");
  await page.goForward();
  await expect(page.locator("#vocabulary-page-status")).toHaveText("3 / 3 · карточек: 120");
  await page.getByLabel("Поиск по основной форме или значению").fill("word-001");
  await expect(page.locator("#vocabulary-cards summary")).toContainText("word-001");
  await expect(page).toHaveURL(/q=word-001/);
  await page.goBack();
  await expect(page.locator("#vocabulary-search")).toHaveValue("word");
  await expect(page.locator("#vocabulary-page-status")).toHaveText("2 / 3 · карточек: 120");
});

test("некорректные страницы и удалённые id раскрытия восстанавливаются безопасно", async ({ page }) => {
  await page.goto("/src/vocabulary.html");
  await page.evaluate(async () => chrome.storage.local.set({ cards: [
    { id: "available", kind: "word", headword: "available", meanings: [{ text: "present", contexts: [], examples: [] }] }
  ] }));
  await page.goto(`${page.url().split("?")[0]}?page=-4&open=deleted&open=available`);
  await expect(page.locator("#vocabulary-page-status")).toHaveText("1 / 1 · карточек: 1");
  await expect(page.locator("#vocabulary-cards details")).toHaveAttribute("open", "");
  await expect(page).not.toHaveURL(/page=|open=deleted/);
  await page.getByLabel("Поиск по основной форме или значению").fill("ничего");
  await expect(page.locator("#vocabulary-page-status")).toHaveText("1 / 1 · карточек: 0");
});
