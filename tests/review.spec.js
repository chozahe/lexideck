const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("панель открывает отдельную вкладку сразу в разделе повторения", async ({ page }) => {
  await page.goto("/src/panel.html");
  const [reviewTab] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Перейти к повторению" }).click()
  ]);
  await expect(reviewTab).toHaveURL(/\/src\/review\.html$/);
  await expect(reviewTab.getByRole("heading", { name: "Повторение", exact: true })).toBeVisible();
  await expect(reviewTab.getByRole("link", { name: "Повторение" })).toHaveAttribute("aria-current", "page");
  await expect(reviewTab.getByRole("button", { name: "Начать занятие" })).toBeVisible();
});

test("оценка карточки обновляет серию и достижения, а пропуск дня сбрасывает серию", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00") });
  await page.goto("/src/review.html");
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      cards: [{
        id: "streak-card", kind: "word", headword: "word",
        meanings: [{ text: "слово", contexts: [{ form: "word", text: "A word." }], examples: [] }]
      }],
      studyStats: { days: ["2026-10-07", "2026-10-08"], reviewCount: 0 }
    });
  });
  await page.reload();
  const review = page.locator("#review");
  await expect(page.locator("#study-streak")).toHaveText("Серия занятий: 2 дня");
  await expect(page.locator("#study-achievements")).toContainText("Пока не получено: Первый ответ");
  await expect(page.locator("#study-achievements")).toContainText("Пока не получено: Серия из 3 дней");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await review.getByRole("button", { name: "Хорошо", exact: true }).click();
  await expect(page.locator("#study-streak")).toHaveText("Серия занятий: 3 дня");
  await expect(page.locator("#study-achievements")).toContainText("Получено: Первый ответ");
  await expect(page.locator("#study-achievements")).toContainText("Получено: Серия из 3 дней");
  await page.clock.setSystemTime(new Date("2026-10-11T12:00:00"));
  await page.reload();
  await expect(page.locator("#study-streak")).toHaveText("Серия занятий: 0 дней");
  await expect(page.locator("#study-achievements")).toContainText("Получено: Первый ответ");
  await expect(page.locator("#study-achievements")).toContainText("Получено: Серия из 3 дней");
  const { cards, studyStats } = await page.evaluate(async () => ({
    cards: (await chrome.storage.local.get("cards")).cards,
    studyStats: (await chrome.storage.local.get("studyStats")).studyStats
  }));
  expect(cards[0].reviewHistory).toHaveLength(1);
  expect(studyStats.reviewCount).toBe(1);
});

test("дневной лимит новых карточек равен 10, меняется и сохраняется между занятиями", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  await page.goto("/src/settings.html");
  await expect(page.getByLabel("Новых карточек в день")).toHaveValue("10");
  await page.goto("/src/review.html");
  // Начальные данные локального хранилища: словарь из 12 новых карточек.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ cards: Array.from({ length: 12 }, (_, index) => ({
      id: String(index), kind: "word", headword: `word ${index + 1}`,
      meanings: [{ text: "значение", contexts: [{ form: "word", text: "A word." }], examples: ["One word.", "Another word."] }]
    })) });
  });
  await page.reload();
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
  await page.goto("/src/settings.html");
  await page.getByLabel("Новых карточек в день").fill("11");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByText("Настройки сохранены на этом устройстве.")).toBeVisible();
  await page.goto("/src/review.html");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "word 11", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await review.getByRole("button", { name: "Легко", exact: true }).click();
  await expect(page.locator("#review-card")).toBeHidden();
  await page.reload();
  await page.goto("/src/settings.html");
  await expect(page.getByLabel("Новых карточек в день")).toHaveValue("11");
  await page.goto("/src/review.html");
  await page.clock.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "word 12", exact: true })).toBeVisible();
});

async function saveTranslatedWords(page) {
  await page.goto("/src/settings.html");
  await page.locator("#api-url").fill("http://127.0.0.1:4173/v1");
  await page.locator("#model").fill("controlled-model");
  await page.locator("#api-key").fill("test-secret");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await page.evaluate(() => chrome.storage.local.remove("pendingSelection"));
  await page.goto("/src/panel.html");
  await page.locator("#source-text").fill("She took off her coat and wore her coat.");
  await page.locator("#translate").click();
  await expect(page.locator("#word-meanings li")).toHaveCount(3);
  for (const row of await page.locator("#word-meanings li").all()) {
    await row.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(row.getByRole("button", { name: "Сохранено", exact: true })).toBeVisible();
  }
  await page.goto("/src/vocabulary.html");
  await expect(page.locator("#vocabulary-cards summary")).toContainText(["take off", "coat"]);

  await page.goto("/src/review.html");
}

async function readCardDue(page, headword) {
  await page.goto("/src/vocabulary.html");
  const card = page.locator("#vocabulary-cards details").filter({ has: page.locator("summary strong", { hasText: headword }) });
  await expect(card.locator("summary")).toBeVisible();
  const due = await card.locator("time").getAttribute("datetime");
  await page.goto("/src/review.html");
  return due;
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
  const due = await readCardDue(page, "coat");
  await expect(page.locator("#review-card")).toBeHidden();
  await page.goto("/src/settings.html");
  await page.getByLabel("Новых карточек в день").fill("0");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await page.goto("/src/review.html");
  await page.reload();
  await page.clock.setSystemTime(new Date(due));
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "coat", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Показать ответ" }).click();
  await expect(page.locator("#review-meaning")).toHaveText("пальто, которое она надела");
  await expect(review).not.toContainText("пальто, которое она сняла");
  await review.getByRole("button", { name: "Трудно", exact: true }).click();
  const updatedDue = await readCardDue(page, "coat");
  expect(updatedDue).not.toBe(due);
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
  const due = await readCardDue(page, "take off");
  expect(new Date(due).getTime()).toBeGreaterThan(new Date("2026-10-09T12:00:00Z").getTime());
  await page.reload();
  expect(await readCardDue(page, "take off")).toBe(due);
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "coat", exact: true })).toBeVisible();
  await page.clock.setSystemTime(new Date(due));
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(review.getByRole("heading", { name: "take off", exact: true })).toBeVisible();
});

test("оценка устаревшей карточки во второй вкладке не меняет её расписание", async ({ page, context }) => {
  await saveTranslatedWords(page);
  const other = await context.newPage();
  await other.goto("/src/review.html");
  for (const tab of [page, other]) {
    await tab.getByRole("button", { name: "Начать занятие" }).click();
    await tab.getByRole("button", { name: "Показать ответ" }).click();
  }
  await page.getByRole("button", { name: "Легко", exact: true }).click();
  const due = await readCardDue(page, "take off");
  await other.getByRole("button", { name: "Не вспомнил", exact: true }).click();
  await expect(other.locator("#review-status")).toContainText("Карточка уже изменилась");
  await page.reload();
  expect(await readCardDue(page, "take off")).toBe(due);
});

function concurrentReviewCards() {
  return ["a", "b", "c"].map((headword) => ({
    id: `concurrent-${headword}`, kind: "word", headword,
    meanings: [{ text: `значение ${headword}`, contexts: [{ form: headword, text: `Context ${headword}.` }], examples: [`Example ${headword}.`] }],
    schedule: {
      due: `2026-10-09T12:${headword === "a" ? "01" : "00"}:00.000Z`,
      stability: 2.5, difficulty: 4.2, elapsed_days: 1, scheduled_days: 2,
      reps: 1, lapses: 0, state: 2, last_review: "2026-10-08T12:00:00.000Z"
    },
    firstReviewedAt: "2026-10-01T12:00:00.000Z", nextMeaning: 0, reviewHistory: []
  }));
}

async function importConcurrentCards(page, cards = concurrentReviewCards()) {
  await page.goto("/src/vocabulary.html");
  const backup = { format: "lexideck-backup", version: 1, exportedAt: "2026-10-09T12:00:00.000Z", cards };
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#import-backup").setInputFiles({ name: "concurrent.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator("#backup-status")).toHaveText("Восстановлено карточек: 3.");
}

async function rateVisibleCard(page, headword) {
  await expect(page.locator("#review-headword")).toHaveText(headword);
  await page.getByRole("button", { name: "Показать ответ" }).click();
  await page.getByRole("button", { name: "Легко", exact: true }).click();
}

async function exportedCards(page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать резервную копию" }).click();
  const file = await (await download).path();
  return JSON.parse(await require("node:fs/promises").readFile(file, "utf8")).cards;
}

test("очередь пропускает карточки, чей срок другая вкладка перенесла в будущее", async ({ page, context }) => {
  const now = new Date("2026-10-09T12:00:00Z");
  await page.clock.install({ time: now });
  await importConcurrentCards(page);
  const other = await context.newPage();
  await other.clock.install({ time: now });
  await other.goto("/src/review.html");
  await other.getByRole("button", { name: "Начать занятие" }).click();
  await expect(other.locator("#review-progress")).toHaveText("Пройдено 0 из 2. Осталось 2.");
  await page.clock.setSystemTime(new Date("2026-10-09T12:01:00Z"));
  await other.clock.setSystemTime(new Date("2026-10-09T12:01:00Z"));
  await page.goto("/src/review.html");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page.locator("#review-progress")).toHaveText("Пройдено 0 из 3. Осталось 3.");
  await rateVisibleCard(page, "a");
  await expect(page.locator("#review-headword")).toHaveText("b");
  await rateVisibleCard(other, "b");
  await expect(other.locator("#review-headword")).toHaveText("c");
  await rateVisibleCard(other, "c");
  await expect(other.locator("#review-card")).toBeHidden();
  await rateVisibleCard(page, "b");
  await expect(page.locator("#review-status")).toContainText("Карточка уже изменилась");
  await expect(page.locator("#review-card")).toBeHidden();
  await expect(page.locator("#review-progress")).toHaveText("Пройдено 1 из 1. Осталось 0.");
  await expect(page.locator("#review-status")).toContainText("Занятие завершено");
  await page.goto("/src/vocabulary.html");
  const cards = await exportedCards(page);
  for (const card of cards) {
    expect(card.schedule.reps).toBe(2);
    expect(card.reviewHistory).toHaveLength(1);
    expect(new Date(card.schedule.due).getTime()).toBeGreaterThan(new Date("2026-10-09T12:01:00Z").getTime());
  }
});

test("оценка после переноса срока в другой вкладке пропускает карточку без второго ответа", async ({ page, context }) => {
  const now = new Date("2026-10-09T12:00:00Z");
  await page.clock.install({ time: now });
  await importConcurrentCards(page);
  await page.goto("/src/review.html");
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page.locator("#review-headword")).toHaveText("b");
  await page.getByRole("button", { name: "Показать ответ" }).click();
  const vocabulary = await context.newPage();
  const cards = concurrentReviewCards();
  // Импорт изменяет due при прежнем reps: одного сравнения версии недостаточно.
  cards.find((card) => card.headword === "b").schedule.due = "2026-10-17T12:00:00.000Z";
  await importConcurrentCards(vocabulary, cards);
  const before = (await exportedCards(vocabulary)).find((card) => card.headword === "b");
  await page.getByRole("button", { name: "Не вспомнил", exact: true }).click();
  await expect(page.locator("#review-headword")).toHaveText("c");
  await expect(page.locator("#review-progress")).toHaveText("Пройдено 0 из 1. Осталось 1.");
  const after = (await exportedCards(vocabulary)).find((card) => card.headword === "b");
  expect(after).toEqual(before);
});
