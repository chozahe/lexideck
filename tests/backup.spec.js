const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

const savedCard = {
  id: "saved-card-1",
  kind: "word",
  headword: "take off",
  meanings: [{
    text: "снять одежду",
    contexts: [{ form: "took off", text: "She took off her coat.", start: 4, end: 12 }],
    examples: ["She took off her shoes.", "Take off your jacket."]
  }],
  schedule: {
    due: "2026-10-08T12:00:00.000Z", stability: 2.5, difficulty: 4.2,
    elapsed_days: 1, scheduled_days: 2, reps: 3, lapses: 1, state: 2,
    last_review: "2026-10-07T12:00:00.000Z"
  },
  firstReviewedAt: "2026-10-01T12:00:00.000Z",
  nextMeaning: 0,
  reviewHistory: [{ rating: 3, meaningIndex: 0 }]
};

test("резервная копия переносит карточку и расписание в другой профиль без ключа API", async ({ page, browser }) => {
  const cardToBackup = structuredClone(savedCard);
  cardToBackup.schedule.due = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  cardToBackup.schedule.last_review = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await page.goto("/src/panel.html");
  await page.evaluate((card) => chrome.storage.local.set({ cards: [card], settings: { apiKey: "must-not-export" } }), cardToBackup);
  await page.reload();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать резервную копию" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  const backupText = await fs.readFile(backupPath, "utf8");
  const parsed = JSON.parse(backupText);
  expect(backupText).not.toContain("must-not-export");
  expect(parsed.cards).toEqual([cardToBackup]);

  const otherProfile = await browser.newContext();
  const otherPage = await otherProfile.newPage();
  await otherPage.goto("/src/panel.html");
  await otherPage.locator("#import-backup").setInputFiles(backupPath);
  await expect(otherPage.locator("#backup-status")).toHaveText("Восстановлено карточек: 1.");
  await expect(otherPage.locator("#vocabulary-cards")).toContainText("Следующее повторение");
  expect(await otherPage.evaluate(() => chrome.storage.local.get("cards"))).toEqual({ cards: [cardToBackup] });
  await otherPage.goto("/src/review.html");
  await otherPage.getByRole("button", { name: "Начать занятие" }).click();
  await expect(otherPage.locator("#review-card").getByRole("heading", { name: "take off", exact: true })).toBeVisible();
  await otherPage.getByRole("button", { name: "Показать ответ" }).click();
  await expect(otherPage.locator("#review-meaning")).toHaveText("снять одежду");
  await otherPage.getByRole("button", { name: "Хорошо", exact: true }).click();
  await expect.poll(() => otherPage.evaluate(async () => (await chrome.storage.local.get("cards")).cards[0].schedule.reps)).toBe(4);
  await otherProfile.close();
});

test("повреждённая копия отклоняется, а отмена замены сохраняет текущий словарь", async ({ page }) => {
  await page.goto("/src/panel.html");
  await page.evaluate(() => chrome.storage.local.set({ cards: [{ id: "existing", kind: "word", headword: "stay", meanings: [{ text: "остаться", contexts: [], examples: [] }] }] }));
  await page.reload();

  await page.locator("#import-backup").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"format":"lexideck-backup","version":1,"exportedAt":"2026-10-09T00:00:00.000Z","cards":[{}]}') });
  await expect(page.locator("#backup-status")).toContainText("некорректная запись карточки");
  expect(await page.evaluate(() => chrome.storage.local.get("cards"))).toEqual({ cards: [{ id: "existing", kind: "word", headword: "stay", meanings: [{ text: "остаться", contexts: [], examples: [] }] }] });

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#import-backup").setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "lexideck-backup", version: 1, exportedAt: "2026-10-09T00:00:00.000Z", cards: [savedCard] })) });
  await expect(page.locator("#backup-status")).toContainText("Импорт отменён");
  expect(await page.evaluate(() => chrome.storage.local.get("cards"))).toEqual({ cards: [{ id: "existing", kind: "word", headword: "stay", meanings: [{ text: "остаться", contexts: [], examples: [] }] }] });
});
