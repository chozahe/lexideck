const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("дневной лимит новых карточек равен 10, меняется и сохраняется между занятиями", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await page.goto("/src/panel.html");
  // Начальные данные локального хранилища: словарь из 12 новых карточек.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ cards: Array.from({ length: 12 }, (_, index) => ({
      id: String(index), kind: "word", headword: `word ${index + 1}`,
      meanings: [{ text: "значение", contexts: [{ form: "word", text: "A word." }], examples: ["One word.", "Another word."] }]
    })) });
  });
  await page.reload();
  await expect(page.getByLabel("Новых карточек в день")).toHaveValue("10");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  const review = page.locator("#review");
  for (let index = 1; index <= 10; index++) {
    await expect(review.getByRole("heading", { name: `word ${index}`, exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Показать ответ" }).click();
    await review.getByRole("button", { name: "Легко", exact: true }).click();
  }
  await expect(page.locator("#review-card")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page.locator("#review-card")).toBeHidden();
  await page.getByLabel("Новых карточек в день").fill("11");
  await page.getByRole("button", { name: "Сохранить лимит" }).click();
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "word 11", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await review.getByRole("button", { name: "Легко", exact: true }).click();
  await expect(page.locator("#review-card")).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("Новых карточек в день")).toHaveValue("11");
  await page.clock.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "word 12", exact: true })).toBeVisible();
});

async function saveTranslatedWords(page) {
  await page.goto("/src/panel.html");
  await page.getByRole("button", { name: "Настройки API" }).click();
  await page.locator("#api-url").fill("http://127.0.0.1:4173/v1");
  await page.locator("#model").fill("controlled-model");
  await page.locator("#api-key").fill("test-secret");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await page.getByRole("button", { name: "Подтвердить текст и перевести" }).click();
  for (const row of await page.locator("#word-meanings li").all()) {
    await row.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(row.getByRole("button", { name: "Сохранено", exact: true })).toBeVisible();
  }
}

test("значения карточки чередуются с общим расписанием, повторение доступно при нулевом лимите", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await saveTranslatedWords(page);
  const review = page.locator("#review");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await review.getByRole("button", { name: "Легко", exact: true }).click();
  await expect(review.getByRole("heading", { name: "coat", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await expect(page.locator("#review-meaning")).toHaveText("пальто, которое она сняла");
  await expect(review).not.toContainText("пальто, которое она надела");
  await review.getByRole("button", { name: "Не вспомнил", exact: true }).click();
  const coat = page.locator("#vocabulary-cards article").filter({ has: page.getByRole("heading", { name: "coat", exact: true }) });
  const due = await coat.locator("time").getAttribute("datetime");
  await expect(coat.locator("time")).toHaveCount(1);
  await expect(page.locator("#review-card")).toBeHidden();
  await page.getByLabel("Новых карточек в день").fill("0");
  await page.getByRole("button", { name: "Сохранить лимит" }).click();
  await page.reload();
  await page.clock.setSystemTime(new Date(due));
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "coat", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await expect(page.locator("#review-meaning")).toHaveText("пальто, которое она надела");
  await expect(review).not.toContainText("пальто, которое она сняла");
  await review.getByRole("button", { name: "Трудно", exact: true }).click();
  await expect(coat.locator("time")).not.toHaveAttribute("datetime", due);
});

test("карточка из словаря получает срок FSRS после показа ответа и оценки", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await saveTranslatedWords(page);
  await page.getByRole("button", { name: "Начать занятие" }).click();
  const review = page.locator("#review");
  await expect(review.getByRole("heading", { name: "take off", exact: true })).toBeVisible();
  await expect(review.getByText("сняла (одежду)", { exact: true })).toBeHidden();
  await expect(review.getByRole("button", { name: "Хорошо", exact: true })).toBeHidden();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await expect(review).toContainText("сняла (одежду)");
  await expect(review).toContainText("took off: She took off her coat and wore her coat.");
  await expect(review).toContainText("She took off her shoes.");
  await review.getByRole("button", { name: "Хорошо", exact: true }).click();
  const card = page.locator("#vocabulary-cards article").filter({ has: page.getByRole("heading", { name: "take off", exact: true }) });
  const due = await card.locator("time").getAttribute("datetime");
  expect(new Date(due).getTime()).toBeGreaterThan(new Date("2026-10-09T12:00:00Z").getTime());
  await page.reload();
  await expect(card.locator("time")).toHaveAttribute("datetime", due);
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "coat", exact: true })).toBeVisible();
  await page.clock.setSystemTime(new Date(due));
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "take off", exact: true })).toBeVisible();
});

test("оценка устаревшей карточки во второй панели не меняет её расписание", async ({ page, context }) => {
  await saveTranslatedWords(page);
  const other = await context.newPage();
  await other.goto("/src/panel.html");
  for (const panel of [page, other]) {
    await panel.getByRole("button", { name: "Начать занятие" }).click();
    await panel.getByRole("button", { name: "Показать ответ" }).click();
  }
  await page.getByRole("button", { name: "Легко", exact: true }).click();
  const card = page.locator("#vocabulary-cards article").filter({ has: page.getByRole("heading", { name: "take off", exact: true }) });
  const due = await card.locator("time").getAttribute("datetime");
  await other.getByRole("button", { name: "Не вспомнил", exact: true }).click();
  await expect(other.locator("#review-status")).toContainText("Карточка уже изменилась");
  await page.reload();
  await expect(card.locator("time")).toHaveAttribute("datetime", due);
});
