const { test, expect } = require("@playwright/test");

async function configureApi(page) {
  await page.getByRole("button", { name: "Настройки API" }).click();
  await page.locator("#api-url").fill("http://127.0.0.1:4173/v1");
  await page.locator("#model").fill("controlled-model");
  await page.locator("#api-key").fill("test-secret");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
}

async function selectComicRegion(page) {
  await page.addInitScript(() => {
    const makeEvent = () => {
      const listeners = [];
      return {
        listeners,
        addListener(listener) { listeners.push(listener); },
        emit(...args) { listeners.forEach((listener) => listener(...args)); }
      };
    };
    const runtimeMessages = makeEvent();
    runtimeMessages.addListener = (listener) => {
      runtimeMessages.listeners.push(listener);
      window.__contentMessageListener = listener;
    };
    const changed = makeEvent();
    const sessionValues = {};
    window.__pendingRuntimeMessages = [];
    window.__sessionValues = sessionValues;
    window.chrome = {
      runtime: {
        onInstalled: makeEvent(),
        onMessage: runtimeMessages,
        sendMessage(message) {
          const jobs = runtimeMessages.listeners.map((listener) => new Promise((resolve) => {
            let responded = false;
            const result = listener(message, { tab: { windowId: 4 } }, (value) => {
              responded = true;
              resolve(value);
            });
            if (result !== true && !responded) resolve(undefined);
          }));
          const pending = Promise.all(jobs);
          window.__pendingRuntimeMessages.push(pending);
          return pending;
        }
      },
      storage: {
        local: {
          get: async (key) => ({ [key]: undefined }),
          set: async () => {},
          remove: async () => {}
        },
        session: {
          get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, sessionValues[key]])),
          set: async (next) => {
            Object.assign(sessionValues, next);
            changed.emit(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), "session");
          },
          remove: async (key) => { delete sessionValues[key]; }
        },
        onChanged: changed
      },
      contextMenus: { onInstalled: makeEvent(), onClicked: makeEvent(), removeAll: (callback) => callback(), create: () => {} },
      commands: { onCommand: makeEvent() },
      sidePanel: { open: async () => {} },
      tabs: {
        captureVisibleTab: async () => window.__screenshot,
        sendMessage: async () => ({ text: "" })
      }
    };
  });
  await page.goto("/manifest.json");
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0000ff";
    context.fillRect(100, 100, 80, 70);
    window.__screenshot = canvas.toDataURL("image/png");
  });
  await page.addScriptTag({ path: require("node:path").join(__dirname, "../src/background.js") });
  await page.addScriptTag({ path: require("node:path").join(__dirname, "../src/content.js") });
  await page.evaluate(() => window.__contentMessageListener({ type: "LEXIDECK_START_REGION_SELECTION" }));
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(180, 170);
  await page.mouse.up();
  return page.evaluate(async () => {
    await Promise.all(window.__pendingRuntimeMessages);
    const image = window.__sessionValues.pendingComicImage;
    const bitmap = await createImageBitmap(await (await fetch(image)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixel = [...context.getImageData(40, 35, 1, 1).data].slice(0, 3);
    bitmap.close();
    return { image, width: canvas.width, height: canvas.height, pixel };
  });
}

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("пользователь получает перевод и значения слов по порядку через API", async ({ page, request }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await expect(page.getByText("Настройки сохранены на этом устройстве.")).toBeVisible();
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat and wore her coat.");

  await page.getByRole("button", { name: "Перевести" }).click();

  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
  await expect(page.locator("#word-meanings li > span")).toHaveText([
    "took off — сняла (одежду)",
    "coat — пальто, которое она сняла",
    "coat — пальто, которое она надела"
  ]);
  const call = await (await request.get("/__test/last-request")).json();
  expect(call.headers.authorization).toBe("Bearer test-secret");
  expect(call.body.model).toBe("controlled-model");
  expect(call.body.messages[0].content).toContain('"start":0,"end":4');
  expect(call.body.messages[0].content).toContain("включая повторяющиеся слова");
  expect(call.body.messages[1].content).toBe("She took off her coat and wore her coat.");
});

test("пользователь сохраняет значения слова в одну локальную карточку и открывает её после перезапуска панели", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();

  const coatRows = page.locator("#word-meanings li").filter({ hasText: "coat —" });
  await coatRows.nth(0).getByRole("button", { name: "Сохранить" }).click();
  await coatRows.nth(1).getByRole("button", { name: "Сохранить" }).click();

  await expect(page.locator("#vocabulary-cards article")).toHaveCount(1);
  await expect(page.locator("#vocabulary-cards")).toContainText("coat");
  await expect(page.locator("#vocabulary-cards")).toContainText("пальто, которое она сняла");
  await expect(page.locator("#vocabulary-cards")).toContainText("пальто, которое она надела");

  await page.reload();
  await expect(page.locator("#vocabulary-cards article")).toHaveCount(1);
  await expect(page.locator("#vocabulary-cards")).toContainText("took off");
});

test("пользователь сохраняет словоформу под основной формой, сохраняя исходную форму в контексте", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();
  await page.locator("#source-text").fill("Edited after translation");
  const phrasalVerb = page.locator("#word-meanings li").filter({ hasText: "took off —" });
  await phrasalVerb.getByRole("button", { name: "Сохранить" }).click();

  const card = page.locator("#vocabulary-cards article");
  await expect(card.locator("h3")).toHaveText("take off");
  await expect(card).toContainText("took off: She took off her coat and wore her coat.");
  await expect(card).toContainText("She took off her shoes.");
});

test("пользователь сохраняет выделенное устойчивое выражение отдельной карточкой", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.locator("#source-text").evaluate((textarea) => {
    textarea.value = "She let the cat out of the bag.";
    textarea.setSelectionRange(4, 30);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Сохранить выделенное выражение" }).click();
  await page.locator("#expression-meaning").fill("раскрыть секрет");
  await page.getByRole("button", { name: "Сохранить выражение" }).click();

  const expression = page.locator("#vocabulary-cards article");
  await expect(expression).toHaveCount(1);
  await expect(expression).toContainText("let the cat out of the bag");
  await expect(expression).toContainText("раскрыть секрет");
  await expect(expression).toContainText("She finally let the cat out of the bag.");
});

test("ошибка API показывается, а исходное выделение остаётся в поле", async ({ page, request }) => {
  await request.post("/__test/error");
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();

  await expect(page.getByRole("alert")).toContainText("API вернул ошибку 401");
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat and wore her coat.");
});

test("область комикса распознаётся vision-моделью, текст можно исправить и перевести", async ({ page, request }) => {
  const crop = await selectComicRegion(page);
  expect(crop.width).toBe(80);
  expect(crop.height).toBe(70);
  expect(crop.pixel).toEqual([0, 0, 255]);
  const selectedCrop = crop.image;
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.evaluate((image) => window.chrome.storage.session.set({ pendingComicImage: image }), selectedCrop);

  await expect(page.locator("#source-text")).toHaveValue("She took of her coat and wore her coat.");
  await expect(page.locator("#comic-status")).toContainText("исправьте реплики");
  await page.locator("#source-text").fill("She took off her coat and wore her coat.");
  await page.getByRole("button", { name: "Подтвердить текст и перевести" }).click();

  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
  const calls = await (await request.get("/__test/requests")).json();
  expect(calls).toHaveLength(2);
  expect(calls[0].body.messages[1].content).toEqual([
    { type: "text", text: "Извлеки текст из выбранного фрагмента комикса." },
    { type: "image_url", image_url: { url: selectedCrop } }
  ]);
  expect(calls[1].body.messages[1].content).toBe("She took off her coat and wore her coat.");
  expect(await page.evaluate(() => Object.keys(window.__chromeValues))).not.toContain("pendingComicImage");
});
