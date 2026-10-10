const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

function cards(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `progress-${index + 1}`,
    kind: "word",
    headword: `word ${index + 1}`,
    meanings: [{ text: "значение", contexts: [{ form: `word ${index + 1}`, text: "A word." }], examples: [] }]
  }));
}

async function seed(page, cardCount, limit) {
  await page.goto("/src/review.html");
  await page.evaluate(async ({ savedCards, newCardLimit }) => {
    await chrome.storage.local.set({ cards: savedCards, newCardLimit });
  }, { savedCards: cards(cardCount), newCardLimit: limit });
  await page.reload();
}

test("прогресс меняется после оценки, показ ответа его не засчитывает", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await seed(page, 2, 2);
  const progress = page.locator("#review-progress");

  await expect(progress).toHaveText("Занятие ещё не начато.");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(progress).toHaveText("Пройдено 0 из 2. Осталось 2.");
  await expect(page.getByRole("heading", { name: "word 1", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Показать ответ" }).click();
  await expect(progress).toHaveText("Пройдено 0 из 2. Осталось 2.");
  await page.getByRole("button", { name: "Хорошо", exact: true }).click();
  await expect(progress).toHaveText("Пройдено 1 из 2. Осталось 1.");
  await expect(page.getByRole("heading", { name: "word 2", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Показать ответ" }).click();
  await expect(progress).toHaveText("Пройдено 1 из 2. Осталось 1.");
  await page.getByRole("button", { name: "Легко", exact: true }).click();
  await expect(progress).toHaveText("Пройдено 2 из 2. Осталось 0.");
  await expect(page.locator("#review-status")).toHaveText("Занятие завершено: все карточки пройдены.");
  await expect(page.locator("#review-card")).toBeHidden();
});

test("пустая очередь показывает нулевой прогресс и понятное состояние", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await seed(page, 0, 10);

  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page.locator("#review-progress")).toHaveText("Пройдено 0 из 0. Осталось 0.");
  await expect(page.locator("#review-progress-bar")).toBeHidden();
  await expect(page.locator("#review-status")).toHaveText("На сегодня всё. Карточек для занятия пока нет.");
});

test("очередь новых карточек ограничена дневным лимитом", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await seed(page, 3, 1);

  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page.locator("#review-progress")).toHaveText("Пройдено 0 из 1. Осталось 1.");
  await expect(page.getByRole("heading", { name: "word 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Показать ответ" }).click();
  await page.getByRole("button", { name: "Хорошо", exact: true }).click();

  await expect(page.locator("#review-progress")).toHaveText("Пройдено 1 из 1. Осталось 0.");
  await expect(page.locator("#review-status")).toHaveText("Занятие завершено: все карточки пройдены.");
  const savedCards = await page.evaluate(async () => (await chrome.storage.local.get("cards")).cards);
  expect(savedCards.filter((card) => card.schedule)).toHaveLength(1);
});
