const { test, expect } = require("@playwright/test");

async function configureApi(page) {
  await page.goto("/src/settings.html");
  await page.locator("#api-url").fill(new URL("/v1", page.url()).origin + "/v1");
  await page.locator("#model").fill("controlled-model");
  await page.locator("#api-key").fill("test-secret");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByText("Настройки сохранены на этом устройстве.")).toBeVisible();
  await page.goto("/src/panel.html");
  await page.locator("#source-text").fill("She took off her coat and wore her coat.");
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
        captureVisibleTab: (_windowId, _options, callback) => callback(window.__screenshot),
        sendMessage: (_tabId, message, callback) => {
          if (message.type === "LEXIDECK_PREPARE_CAPTURE") window.__contentMessageListener(message, {}, callback);
        }
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
    const image = window.__sessionValues.pendingComicRequest.image;
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

test("пользователь сохраняет значения слова в одну локальную карточку и открывает её после перезагрузки словаря", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();

  const coatRows = page.locator("#word-meanings li").filter({ hasText: "coat —" });
  await coatRows.nth(0).getByRole("button", { name: "Сохранить" }).click();
  await coatRows.nth(1).getByRole("button", { name: "Сохранить" }).click();
  await expect(coatRows.getByRole("button", { name: "Сохранено", exact: true })).toHaveCount(2);

  await page.goto("/src/vocabulary.html");
  await expect(page.locator("#vocabulary-cards details")).toHaveCount(1);
  await page.locator("#vocabulary-cards summary").click();
  await expect(page.locator("#vocabulary-cards")).toContainText("coat");
  await expect(page.locator("#vocabulary-cards")).toContainText("пальто, которое она сняла");
  await expect(page.locator("#vocabulary-cards")).toContainText("пальто, которое она надела");

  await page.reload();
  await expect(page.locator("#vocabulary-cards details")).toHaveCount(1);
  await page.locator("#vocabulary-cards summary").click();
  await expect(page.locator("#vocabulary-cards")).toContainText("took off");
});

test("пользователь сохраняет словоформу под основной формой, сохраняя исходную форму в контексте", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();
  await expect(page.locator("#word-meanings li")).toHaveCount(3);
  await page.locator("#source-text").fill("Edited after translation");
  const phrasalVerb = page.locator("#word-meanings li").filter({ hasText: "took off —" });
  await phrasalVerb.getByRole("button", { name: "Сохранить" }).click();
  await expect(phrasalVerb.getByRole("button", { name: "Сохранено", exact: true })).toBeVisible();

  await page.goto("/src/vocabulary.html");
  const card = page.locator("#vocabulary-cards details");
  await expect(card.locator("summary strong")).toHaveText("take off");
  await card.locator("summary").click();
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
  await expect(page.getByRole("button", { name: "Выражение сохранено", exact: true })).toBeVisible();

  await page.goto("/src/vocabulary.html");
  const expression = page.locator("#vocabulary-cards details");
  await expect(expression).toHaveCount(1);
  await expression.locator("summary").click();
  await expect(expression).toContainText("let the cat out of the bag");
  await expect(expression).toContainText("раскрыть секрет");
  await expect(expression).toContainText("She finally let the cat out of the bag.");
});

test("выражение сохраняется без API, а примеры добавляются позднее в ту же запись", async ({ page, request }) => {
  await page.goto("/src/panel.html");
  await page.locator("#source-text").fill("She let the cat out of the bag.");
  await page.locator("#source-text").evaluate((textarea) => {
    textarea.setSelectionRange(4, 30);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Сохранить выделенное выражение" }).click();
  await page.locator("#expression-meaning").fill("раскрыть секрет");
  await page.getByRole("button", { name: "Сохранить без примеров" }).click();
  await expect(page.getByRole("button", { name: "Выражение сохранено", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("lexideck-test-storage")).cards);
  expect(saved).toHaveLength(1);
  expect(saved[0].meanings[0].examples).toEqual([]);

  await page.goto("/src/vocabulary.html");
  await page.evaluate(async () => {
    const { cards } = await chrome.storage.local.get("cards");
    cards[0].schedule = { due: "2026-10-20T00:00:00.000Z", stability: 4, difficulty: 3, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 1 };
    cards[0].history = [{ rating: 3, reviewedAt: "2026-10-01T00:00:00.000Z" }];
    await chrome.storage.local.set({ cards });
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Скачать резервную копию" }).click()
  ]);
  const backup = JSON.parse(require("node:fs").readFileSync(await download.path(), "utf8"));
  expect(backup.cards[0].meanings[0].examples).toEqual([]);
  const card = page.locator("#vocabulary-cards details");
  await card.locator("summary").click();
  await expect(card.getByRole("button", { name: "Добавить примеры модели" })).toBeVisible();
  await configureApi(page);
  await page.goto("/src/vocabulary.html");
  await request.post("/__test/reset");
  const callsBefore = (await (await request.get("/__test/requests")).json()).length;
  await page.locator("#vocabulary-cards summary").click();
  await page.locator("#vocabulary-cards").getByRole("button", { name: "Добавить примеры модели" }).click();
  await expect(page.locator("#vocabulary-cards")).toContainText("She finally let the cat out of the bag.");
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("lexideck-test-storage")).cards);
  expect(after).toHaveLength(1);
  expect(after[0].meanings[0].examples).toHaveLength(2);
  expect(after[0].schedule).toEqual({ due: "2026-10-20T00:00:00.000Z", stability: 4, difficulty: 3, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 1 });
  expect(after[0].history).toEqual([{ rating: 3, reviewedAt: "2026-10-01T00:00:00.000Z" }]);
  expect((await (await request.get("/__test/requests")).json()).length).toBe(callsBefore + 1);
});

test("отмена запроса примеров закрывает форму и блокирует позднее сохранение выражения", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.locator("#source-text").evaluate((textarea) => {
    textarea.value = "She let the cat out of the bag.";
    textarea.setSelectionRange(4, 30);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Сохранить выделенное выражение" }).click();
  await page.locator("#expression-meaning").fill("раскрыть секрет");
  let release;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  await page.route("**/v1/chat/completions", async (route) => {
    started();
    await new Promise((resolve) => { release = resolve; });
    try {
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ examples: ["Example one.", "Example two."] }) } }] } });
    } catch {}
  });
  await page.getByRole("button", { name: "Сохранить выражение" }).click();
  await requestStarted;
  await page.getByRole("button", { name: "Отменить запрос примеров" }).click();
  await expect(page.locator("#expression-form")).toBeHidden();
  await expect(page.locator("#save-expression")).toBeFocused();
  release();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lexideck-test-storage")).cards || [])).toEqual([]);
});

test("ошибка API показывается, а исходное выделение остаётся в поле", async ({ page, request }) => {
  await request.post("/__test/error");
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();

  await expect(page.getByRole("alert")).toContainText("Ключ API отклонён");
  await expect(page.getByText("Технические подробности")).toBeVisible();
  await page.locator("#error-details summary").click();
  await expect(page.locator("#error-detail")).not.toContainText("test-secret");
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat and wore her coat.");
});

test("повторные нажатия и Ctrl+Enter во время запроса используют один API-вызов", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  let calls = 0;
  let release;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  await page.route("**/v1/chat/completions", async (route) => {
    calls += 1;
    started();
    await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: "Уникальный перевод", words: [] }) } }] } });
  });
  await page.getByRole("button", { name: "Перевести", exact: true }).click();
  await requestStarted;
  await page.getByRole("button", { name: "Переводим…" }).click();
  await page.locator("#source-text").press("Control+Enter");
  expect(calls).toBe(1);
  release();
  await expect(page.locator("#sentence-translation")).toHaveText("Уникальный перевод");
});

test("ожидающий запрос можно отменить до получения ответа", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  let release;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  await page.route("**/v1/chat/completions", async (route) => {
    started();
    await new Promise((resolve) => { release = resolve; });
    try {
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: "Запоздалый ответ", words: [] }) } }] } });
    } catch {}
  });
  await page.getByRole("button", { name: "Перевести", exact: true }).click();
  await requestStarted;
  await page.getByRole("button", { name: "Отменить перевод" }).click();
  await expect(page.locator("#comic-status")).toHaveText("Запрос отменён.");
  release();
  await expect(page.locator("#result")).toBeHidden();
});

test("перевод завершается понятной ошибкой по таймауту 60 секунд", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.clock.install();
  let release;
  await page.route("**/v1/chat/completions", async (route) => {
    await new Promise((resolve) => { release = resolve; });
    try { await route.fulfill({ json: { choices: [{ message: { content: "{}" } }] } }); } catch {}
  });
  await page.getByRole("button", { name: "Перевести", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.clock.fastForward(60_001);
  await expect(page.getByRole("alert")).toContainText("больше 60 секунд");
  release();
});

test("реплики комикса можно проверить и исправить до перевода", async ({ page, request }) => {
  const crop = await selectComicRegion(page);
  expect(crop.width).toBe(80);
  expect(crop.height).toBe(70);
  expect(crop.pixel).toEqual([0, 0, 255]);
  const selectedCrop = crop.image;
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.evaluate((image) => window.chrome.storage.session.set({ pendingComicRequest: { id: "comic-1", state: "image", image } }), selectedCrop);

  await expect(page.locator("#source-text")).toHaveValue("She took off her coat and wore her coat.");
  await expect(page.locator("#confirm-comic")).toBeVisible();
  await expect(page.locator("#comic-status")).toContainText("Проверьте распознанные реплики");
  expect((await (await request.get("/__test/requests")).json())).toHaveLength(1);
  await page.locator("#source-text").fill("She took off her coat and wore her coat!");
  await page.getByRole("button", { name: "Подтвердить текст и перевести" }).click();

  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
  const calls = await (await request.get("/__test/requests")).json();
  expect(calls).toHaveLength(2);
  expect(calls[0].body.messages[1].content).toEqual([
    { type: "text", text: "Извлеки текст из выбранного фрагмента комикса." },
    { type: "image_url", image_url: { url: selectedCrop } }
  ]);
  expect(calls[1].body.messages[1].content).toBe("She took off her coat and wore her coat!");
  expect(await page.evaluate(() => Object.keys(window.__chromeValues))).not.toContain("pendingComicRequest");
});

async function prepareAutomaticTranslation(page) {
  await page.addInitScript(() => {
    localStorage.setItem("lexideck-test-storage", JSON.stringify({
      settings: { apiUrl: `${location.origin}/v1`, model: "controlled-model", apiKey: "test-secret" },
      pendingSelection: "She took off her coat and wore her coat."
    }));
  });
}

test("выделенный текст переводится автоматически; исправление заменяет результат и показывает ошибку", async ({ page, request }) => {
  await prepareAutomaticTranslation(page);
  await page.goto("/src/panel.html");
  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat and wore her coat.");
  await request.post("/__test/error");
  await page.locator("#source-text").fill("Corrected text");
  await page.getByRole("button", { name: "Перевести", exact: true }).click();
  await expect(page.locator("#result")).toBeHidden();
  await expect(page.locator("#error")).toContainText("Ключ API отклонён");
});

test("новое выделение заменяет запрос; запоздалый ответ не подменяет актуальный перевод", async ({ page }) => {
  await prepareAutomaticTranslation(page);
  let finishFirst;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  await page.route("**/v1/chat/completions", async (route) => {
    const text = route.request().postDataJSON().messages[1].content;
    if (text.startsWith("She")) {
      firstStarted();
      await new Promise((resolve) => { finishFirst = resolve; });
    }
    try {
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: text.startsWith("She") ? "Старый результат" : "Актуальный результат", words: [] }) } }] } });
    } catch {}
  });
  await page.goto("/src/panel.html");
  await started;
  await expect(page.getByRole("button", { name: "Переводим…" })).toBeVisible();
  const oldRequestFailed = page.waitForEvent("requestfailed", (request) => request.url().includes("/v1/chat/completions") && request.postData()?.includes("She took off"));
  await page.evaluate(() => chrome.storage.local.set({ pendingSelection: "New text" }));
  await oldRequestFailed;
  await expect(page.locator("#sentence-translation")).toHaveText("Актуальный результат");
  finishFirst();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#source-text")).toHaveValue("New text");
  await expect(page.locator("#sentence-translation")).toHaveText("Актуальный результат");
});

function comicRequest(id) {
  return { id, state: "image", image: "data:image/png;base64,iVBORw0KGgo=" };
}

async function prepareComicPanel(page) {
  await prepareAutomaticTranslation(page);
  await page.goto("/src/panel.html");
  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
}

test("распознавание показывает ожидание и ошибку, не сохраняя изображение в постоянном хранилище", async ({ page }) => {
  await prepareComicPanel(page);
  let finishVision;
  await page.route("**/v1/chat/completions", async (route) => {
    await new Promise((resolve) => { finishVision = resolve; });
    await route.fulfill({ status: 503, json: { error: "Не удалось распознать реплику" } });
  });
  await page.evaluate((request) => chrome.storage.session.set({ pendingComicRequest: request }), comicRequest("broken-image"));
  await expect(page.locator("#comic-status")).toHaveText("Распознаём текст на изображении…");
  await expect(page.locator("#result")).toBeHidden();
  finishVision();
  await expect(page.locator("#error")).toContainText("Сервис API временно недоступен");
  expect(await page.evaluate(() => Object.keys(window.__chromeValues))).not.toContain("pendingComicRequest");
  expect(await page.evaluate(() => JSON.stringify(window.__chromeValues))).not.toContain("data:image");
});

test("новый текст и новая область заменяют запоздалое распознавание", async ({ page }) => {
  await prepareComicPanel(page);
  let finishOldVision;
  let visionStarted;
  const started = new Promise((resolve) => { visionStarted = resolve; });
  let images = 0;
  await page.route("**/v1/chat/completions", async (route) => {
    const text = route.request().postDataJSON().messages[1].content;
    if (Array.isArray(text)) {
      const imageNumber = ++images;
      if (imageNumber === 1) {
        visionStarted();
        await new Promise((resolve) => { finishOldVision = resolve; });
      }
      try {
        await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ dialogues: [imageNumber === 1 ? "Old dialogue" : "New dialogue"] }) } }] } });
      } catch {}
    } else {
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: `Перевод: ${text}`, words: [] }) } }] } });
    }
  });
  await page.evaluate((request) => chrome.storage.session.set({ pendingComicRequest: request }), comicRequest("old-image"));
  await started;
  const oldVisionFailed = page.waitForEvent("requestfailed", (request) => request.url().includes("/v1/chat/completions") && request.postData()?.includes("iVBORw0KGgo"));
  await page.evaluate(() => chrome.storage.local.set({ pendingSelection: "New text" }));
  await oldVisionFailed;
  await expect(page.locator("#sentence-translation")).toHaveText("Перевод: New text");
  await page.evaluate((request) => chrome.storage.session.set({ pendingComicRequest: request }), comicRequest("new-image"));
  await expect(page.locator("#source-text")).toHaveValue("New dialogue");
  await expect(page.locator("#confirm-comic")).toBeVisible();
  finishOldVision();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#source-text")).toHaveValue("New dialogue");
  await expect(page.locator("#confirm-comic")).toBeVisible();
});
