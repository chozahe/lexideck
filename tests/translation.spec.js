const { test, expect } = require("@playwright/test");

async function configureApi(page) {
  await page.getByRole("button", { name: "Настройки API" }).click();
  await page.locator("#api-url").fill("http://127.0.0.1:4173/v1");
  await page.locator("#model").fill("controlled-model");
  await page.locator("#api-key").fill("test-secret");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("пользователь получает перевод и значения слов по порядку через API", async ({ page, request }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await expect(page.getByText("Настройки сохранены на этом устройстве.")).toBeVisible();
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat.");

  await page.getByRole("button", { name: "Перевести" }).click();

  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто.");
  await expect(page.locator("#word-meanings li")).toHaveText([
    "took off — сняла (одежду)",
    "coat — пальто"
  ]);
  const call = await (await request.get("/__test/last-request")).json();
  expect(call.headers.authorization).toBe("Bearer test-secret");
  expect(call.body.model).toBe("controlled-model");
  expect(call.body.messages[1].content).toBe("She took off her coat.");
});

test("ошибка API показывается, а исходное выделение остаётся в поле", async ({ page, request }) => {
  await request.post("/__test/error");
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();

  await expect(page.getByRole("alert")).toContainText("API вернул ошибку 401");
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat.");
});
