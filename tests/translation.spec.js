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

test("пустое или неполное подключение API подсказывает настройку и локальный режим", async ({ page }) => {
  await page.goto("/src/panel.html");
  await expect(page.locator("#api-next-step")).toBeVisible();
  await expect(page.locator("#api-next-step")).toContainText("укажите URL API, модель и ключ");
  await expect(page.locator("#api-next-step a")).toHaveAttribute("href", "settings.html");
  await expect(page.locator("#api-next-step")).toContainText("повторение и дневной лимит работают локально");

  await page.evaluate(() => chrome.storage.local.set({ settings: { apiUrl: "https://api.example.com/v1", model: "", apiKey: "stored-locally" } }));
  await expect(page.locator("#api-next-step")).toBeVisible();
  await page.evaluate(() => chrome.storage.local.set({ settings: { apiUrl: "https://api.example.com/v1", model: "model", apiKey: "stored-locally" } }));
  await expect(page.locator("#api-next-step")).toBeHidden();
});

test("подсказка API учитывает порядок чтения и валидность URL", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lexideck-test-storage", JSON.stringify({ settings: {} })));
  await page.route("**/__test/chrome-mock.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const control = `
      const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
      window.__settingsGetQueue = [];
      chrome.storage.local.get = async (key) => {
        if (key !== "settings") return originalGet(key);
        const snapshot = await originalGet(key);
        return new Promise((resolve) => window.__settingsGetQueue.push(() => resolve(snapshot)));
      };
    `;
    await route.fulfill({ response, body: `${source}\n${control}` });
  });
  await page.goto("/src/panel.html");
  await expect.poll(() => page.evaluate(() => window.__settingsGetQueue.length)).toBe(1);
  await page.evaluate(() => chrome.storage.local.set({ settings: { apiUrl: "https://api.example.com/v1", model: "model", apiKey: "local-key" } }));
  await expect.poll(() => page.evaluate(() => window.__settingsGetQueue.length)).toBe(2);
  await page.evaluate(() => window.__settingsGetQueue[1]());
  await expect(page.locator("#api-next-step")).toBeHidden();
  await page.evaluate(() => window.__settingsGetQueue[0]());
  await expect(page.locator("#api-next-step")).toBeHidden();

  await page.evaluate(() => chrome.storage.local.set({ settings: { apiUrl: "api.example.com/v1", model: "model", apiKey: "local-key" } }));
  await expect.poll(() => page.evaluate(() => window.__settingsGetQueue.length)).toBe(3);
  await page.evaluate(() => window.__settingsGetQueue[2]());
  await expect(page.locator("#api-next-step")).toBeVisible();

  await page.evaluate(() => chrome.storage.local.set({ settings: { apiUrl: "http://bad host/v1", model: "model", apiKey: "local-key" } }));
  await expect.poll(() => page.evaluate(() => window.__settingsGetQueue.length)).toBe(4);
  await page.evaluate(() => window.__settingsGetQueue[3]());
  await expect(page.locator("#api-next-step")).toBeVisible();

  await page.evaluate(() => chrome.storage.local.set({ settings: { apiUrl: "http://[bad]/v1", model: "model", apiKey: "local-key" } }));
  await expect.poll(() => page.evaluate(() => window.__settingsGetQueue.length)).toBe(5);
  await page.evaluate(() => window.__settingsGetQueue[4]());
  await expect(page.locator("#api-next-step")).toBeVisible();
});

test("пользователь получает перевод и значения слов по порядку через API", async ({ page, request }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await expect(page.locator("#source-text")).toHaveValue("She took off her coat and wore her coat.");

  await page.getByRole("button", { name: "Перевести" }).click();

  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
  await expect(page.locator("#word-meanings li > span:not(.visually-hidden)")).toHaveText([
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

test("устаревший перевод хранит свой исходный контекст и обновляется по исправленному тексту", async ({ page }) => {
  await prepareAutomaticTranslation(page);
  await page.goto("/src/panel.html");
  await expect(page.locator("#sentence-translation")).toHaveText("Она сняла пальто и надела пальто.");
  const oldText = "She took off her coat and wore her coat.";
  await page.locator("#source-text").fill("Corrected source text");
  await expect(page.locator("#translation-status")).toContainText(`предыдущей версии текста: ${oldText}`);
  await expect(page.locator("#result-source")).toHaveText(`Исходный текст этого перевода: ${oldText}`);
  await expect(page.getByRole("button", { name: "Обновить перевод" })).toBeVisible();

  const oldResult = page.locator("#word-meanings li").filter({ hasText: "took off —" });
  await oldResult.getByRole("button", { name: "Сохранить: take off" }).click();
  await expect(oldResult.getByRole("status")).toHaveText("Сохранено в словарь: take off.");
  const savedCards = await page.evaluate(() => chrome.storage.local.get("cards"));
  expect(savedCards.cards[0].meanings[0].contexts[0].text).toBe(oldText);

  let refreshedText;
  await page.route("**/v1/chat/completions", async (route) => {
    refreshedText = route.request().postDataJSON().messages[1].content;
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: "Обновлённый перевод", words: [] }) } }] } });
  });
  await page.getByRole("button", { name: "Обновить перевод" }).click();
  await expect(page.locator("#sentence-translation")).toHaveText("Обновлённый перевод");
  expect(refreshedText).toBe("Corrected source text");
  await expect(page.locator("#translation-status")).toBeEmpty();
  await expect(page.locator("#result-source")).toHaveText("Исходный текст этого перевода: Corrected source text");
});

test("состояние сохранения различает карточку, значение и контекст и обновляется из другой вкладки", async ({ page, context }) => {
  const oldText = "She took off her coat and wore her coat.";
  await page.addInitScript((sourceText) => {
    localStorage.setItem("lexideck-test-storage", JSON.stringify({
      settings: { apiUrl: `${location.origin}/v1`, model: "controlled-model", apiKey: "test-secret" },
      pendingSelection: sourceText,
      cards: [
        { id: "expression-coat", kind: "expression", headword: "coat", meanings: [] },
        { id: "coat", kind: "word", headword: "COAT", meanings: [{ text: "пальто, которое она сняла", contexts: [{ form: "COAT", text: sourceText.toLowerCase().replaceAll(" ", "  "), start: 17, end: 21 }], examples: [] }] },
        { id: "take-off", kind: "word", headword: "take off", meanings: [{ text: "сняла (одежду)", contexts: [{ form: "TOOK OFF", text: "Earlier context", start: 0, end: 8 }], examples: [] }] }
      ]
    }));
  }, oldText);
  await page.goto("/src/panel.html");
  await expect(page.locator("#sentence-translation")).toBeVisible();
  const rows = page.locator("#word-meanings li");
  await expect(rows.filter({ hasText: "took off —" }).getByRole("button")).toHaveAccessibleName("Добавить контекст: take off");
  await expect(rows.filter({ hasText: "coat — пальто, которое она сняла" }).getByRole("button")).toHaveAccessibleName("Уже в словаре: coat");
  const addMeaning = rows.filter({ hasText: "coat — пальто, которое она надела" }).getByRole("button");
  await expect(addMeaning).toHaveAccessibleName("Добавить значение: coat");
  await addMeaning.click();
  await expect(addMeaning).toHaveAccessibleName("Уже в словаре: coat");
  await expect(rows.filter({ hasText: "coat — пальто, которое она надела" }).getByRole("status")).toHaveText("Сохранено в словарь: coat.");

  const secondTab = await context.newPage();
  await secondTab.goto("/src/panel.html");
  await secondTab.evaluate(({ sourceText }) => chrome.storage.local.set({ cards: [
    { id: "coat", kind: "word", headword: "coat", meanings: [{ text: "пальто, которое она сняла", contexts: [{ form: "coat", text: sourceText.toUpperCase(), start: 0, end: 4 }], examples: [] }, { text: "пальто, которое она надела", contexts: [{ form: "coat", text: sourceText, start: 0, end: 4 }], examples: [] }] },
    { id: "take-off", kind: "word", headword: "take off", meanings: [{ text: "сняла (одежду)", contexts: [{ form: "took off", text: sourceText, start: 0, end: 8 }], examples: [] }] }
  ] }), { sourceText: oldText });
  await expect(rows.filter({ hasText: "coat — пальто, которое она сняла" }).getByRole("button")).toHaveAccessibleName("Уже в словаре: coat");
  await expect(rows.filter({ hasText: "took off —" }).getByRole("button")).toHaveAccessibleName("Уже в словаре: take off");
  await secondTab.close();
});

test("пользователь сохраняет значения слова в одну локальную карточку и открывает её после перезагрузки словаря", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.getByRole("button", { name: "Перевести" }).click();

  const coatRows = page.locator("#word-meanings li").filter({ hasText: "coat —" });
  await coatRows.nth(0).getByRole("button", { name: "Сохранить: coat" }).click();
  await coatRows.nth(1).getByRole("button", { name: "Добавить значение: coat" }).click();
  await expect(coatRows.getByRole("status")).toHaveCount(2);
  await expect(coatRows.getByRole("status").nth(0)).toHaveText("Сохранено в словарь: coat.");

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
  await phrasalVerb.getByRole("button", { name: "Сохранить: take off" }).click();
  await expect(phrasalVerb.getByRole("status")).toHaveText("Сохранено в словарь: take off.");

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

test("генерация примеров удаляет повторы из одного ответа модели", async ({ page }) => {
  await page.goto("/src/vocabulary.html");
  await configureApi(page);
  await page.evaluate(async () => chrome.storage.local.set({ cards: [{
    id: "dedupe-examples", kind: "expression", headword: "take off",
    meanings: [{ text: "снять", contexts: [{ form: "took off", text: "She took off her coat." }], examples: [] }]
  }] }));
  await page.goto("/src/vocabulary.html");
  await page.route("**/v1/chat/completions", (route) => route.fulfill({ json: { choices: [{ message: {
    content: JSON.stringify({ examples: ["Same example.", "Same example.", "Second example."] })
  } }] } }));
  await page.locator("#vocabulary-cards summary").click();
  await page.getByRole("button", { name: "Добавить примеры модели" }).click();
  await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get("cards")).cards[0].meanings[0].examples)).toEqual(["Same example.", "Second example."]);
});

test("генерация отклоняет примеры, дублирующиеся без учёта регистра", async ({ page }) => {
  await configureApi(page);
  await page.evaluate(async () => chrome.storage.local.set({ cards: [{
    id: "case-duplicate-examples", kind: "expression", headword: "take off",
    meanings: [{ text: "снять", contexts: [{ form: "took off", text: "She took off her coat." }], examples: [] }]
  }] }));
  await page.goto("/src/vocabulary.html");
  await page.route("**/v1/chat/completions", (route) => route.fulfill({ json: { choices: [{ message: {
    content: JSON.stringify({ examples: ["Same example.", "same example."] })
  } }] } }));
  const card = page.locator('[data-card-id="case-duplicate-examples"]');
  await card.locator("summary").click();
  await card.getByRole("button", { name: "Добавить примеры модели" }).click();
  await expect(page.locator("#vocabulary-status")).toContainText("меньше двух уникальных примеров");
  const saved = await page.evaluate(async () => (await chrome.storage.local.get("cards")).cards[0].meanings[0].examples);
  expect(saved).toEqual([]);
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
  await page.unroute("**/v1/chat/completions");
  await page.getByRole("button", { name: "Сохранить выделенное выражение" }).click();
  await expect(page.getByRole("button", { name: "Сохранить выражение" })).toBeEnabled();
  await page.getByRole("button", { name: "Сохранить выражение" }).click();
  await expect(page.getByRole("button", { name: "Выражение сохранено", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lexideck-test-storage")).cards || [])).toHaveLength(1);
});

test("отмена при ожидании блокировки не записывает выражение и повторный запуск работает", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.locator("#source-text").evaluate((textarea) => {
    textarea.value = "She let the cat out of the bag.";
    textarea.setSelectionRange(4, 30);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Сохранить выделенное выражение" }).click();
  await page.locator("#expression-meaning").fill("раскрыть секрет");
  await page.evaluate(() => {
    window.__heldCardLock = new Promise((resolve) => { window.__releaseCardLock = resolve; });
    window.__cardLockAcquired = false;
    window.__cardLockPromise = navigator.locks.request("lexideck-cards", async () => {
      window.__cardLockAcquired = true;
      await window.__heldCardLock;
    });
  });
  await expect.poll(() => page.evaluate(() => window.__cardLockAcquired)).toBe(true);
  const responseStarted = page.waitForRequest((request) => request.url().includes("/v1/chat/completions"));
  await page.getByRole("button", { name: "Сохранить выражение" }).click();
  await responseStarted;
  await expect(page.locator("#expression-form button[type=submit]")).toHaveText("Сохраняем…");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.locator("#expression-form")).toBeHidden();
  await page.evaluate(() => window.__releaseCardLock());
  await page.evaluate(() => window.__cardLockPromise);
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

test("новый текст не проигрывает старому при обратном порядке чтения настроек", async ({ page }) => {
  await page.goto("/src/panel.html");
  await configureApi(page);
  await page.evaluate(() => chrome.storage.local.remove("pendingSelection"));
  await page.reload();
  await page.locator("#source-text").fill("Старый текст");
  await page.evaluate(() => {
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    window.__settingsReads = [];
    window.__originalStorageGet = get;
    chrome.storage.local.get = (key) => key === "settings" && window.__settingsReads.length < 2
      ? new Promise((resolve) => window.__settingsReads.push(resolve))
      : get(key);
  });
  await page.route("**/v1/chat/completions", async (route) => {
    const text = route.request().postDataJSON().messages[1].content;
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: `Перевод: ${text}`, words: [] }) } }] } });
  });

  await page.getByRole("button", { name: "Перевести", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__settingsReads.length)).toBe(1);
  await page.evaluate(() => chrome.storage.local.set({ pendingSelection: "Актуальный текст" }));
  await expect.poll(() => page.evaluate(() => window.__settingsReads.length)).toBe(2);

  await page.evaluate(async () => window.__settingsReads[1](await window.__originalStorageGet("settings")));
  await page.evaluate(async () => window.__settingsReads[0](await window.__originalStorageGet("settings")));

  await expect(page.locator("#sentence-translation")).toHaveText("Перевод: Актуальный текст");
  expect(await page.locator("#result-source").textContent()).toBe("Исходный текст этого перевода: Актуальный текст");
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
  await page.getByRole("button", { name: "Обновить перевод", exact: true }).click();
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
  await expect(page.locator("#retry-comic")).toBeVisible();
  await expect(page.locator("#retry-comic")).toBeFocused();
});

test("после отмены распознавания можно повторно выбрать область из панели", async ({ page }) => {
  await prepareComicPanel(page);
  let finishVision;
  let visionStarted;
  const started = new Promise((resolve) => { visionStarted = resolve; });
  await page.route("**/v1/chat/completions", async (route) => {
    visionStarted();
    await new Promise((resolve) => { finishVision = resolve; });
    try { await route.fulfill({ status: 503, json: { error: "Не удалось распознать реплику" } }); } catch {}
  });
  await page.evaluate((request) => chrome.storage.session.set({ pendingComicRequest: request }), comicRequest("cancelled-image"));
  await started;
  await page.getByRole("button", { name: "Отменить перевод" }).click();
  await expect(page.locator("#retry-comic")).toBeVisible();
  await expect(page.locator("#retry-comic")).toBeFocused();

  await page.evaluate(() => {
    window.__reselectMessages = [];
    chrome.runtime = { sendMessage: async (message) => { window.__reselectMessages.push(message); } };
  });
  await page.getByRole("button", { name: "Выбрать область заново" }).click();
  await expect(page.locator("#retry-comic")).toBeFocused();
  expect(await page.evaluate(() => window.__reselectMessages)).toEqual([{ type: "LEXIDECK_RESELECT_COMIC" }]);
  finishVision();
});

test("после OCR ошибки отмена обычного перевода не возвращает повторный выбор области", async ({ page }) => {
  await prepareComicPanel(page);
  let releaseTranslation;
  let translationStarted;
  const started = new Promise((resolve) => { translationStarted = resolve; });
  await page.route("**/v1/chat/completions", async (route) => {
    const content = route.request().postDataJSON().messages[1].content;
    if (Array.isArray(content)) {
      await route.fulfill({ status: 503, json: { error: "Не удалось распознать реплику" } });
      return;
    }
    translationStarted();
    await new Promise((resolve) => { releaseTranslation = resolve; });
    try { await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ sentence_translation: "Перевод", words: [] }) } }] } }); } catch {}
  });
  await page.evaluate((request) => chrome.storage.session.set({ pendingComicRequest: request }), comicRequest("failed-ocr"));
  await expect(page.locator("#error")).toContainText("Сервис API временно недоступен");
  await expect(page.locator("#retry-comic")).toBeVisible();

  await page.locator("#source-text").fill("Ordinary text after OCR");
  await page.getByRole("button", { name: "Перевести", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "Отменить перевод" }).click();
  await expect(page.locator("#retry-comic")).toBeHidden();
  await expect(page.locator("#translate")).toBeFocused();
  releaseTranslation();
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
