import "./theme.js";
import { completionEndpoint, DEFAULT_SETTINGS } from "./settings.js";
import { updateCards } from "./cards.js";

const $ = (id) => document.getElementById(id);
function showError(message) {
  $("error").textContent = message;
}
function showApiError(error) {
  showError(error.message || "Не удалось выполнить запрос.");
  $("error-details").hidden = !error.detail;
  $("error-detail").textContent = error.detail || "";
}

async function apiCompletion(messages, config, { signal } = {}) {
  if (!config.apiUrl || !config.apiKey || !config.model) {
    const error = new Error("Подключение API не настроено. Откройте настройки и заполните URL, ключ и модель.");
    error.kind = "configuration";
    throw error;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
  let response;
  try {
    response = await fetch(completionEndpoint(config.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify({ model: config.model, temperature: 0.2, response_format: { type: "json_object" }, messages }),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    if (signal?.aborted) throw signal.reason || new DOMException("Отменено", "AbortError");
    if (controller.signal.aborted) {
      const timeoutError = new Error("Запрос занял больше 60 секунд. Проверьте доступность API и повторите попытку.");
      timeoutError.kind = "timeout";
      throw timeoutError;
    }
    const networkError = new Error("Не удалось связаться с API. Проверьте интернет-соединение и URL в настройках.");
    networkError.kind = "network";
    networkError.detail = error.message;
    throw networkError;
  }
  if (!response.ok) {
    let responseText = "";
    try { responseText = await response.text(); } catch (error) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (controller.signal.aborted && !signal?.aborted) {
        const timeoutError = new Error("Запрос занял больше 60 секунд. Проверьте доступность API и повторите попытку.");
        timeoutError.kind = "timeout";
        throw timeoutError;
      }
      throw error;
    }
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    let detail = responseText.slice(0, 400).replaceAll(config.apiKey, "[скрыто]");
    const messages = {
      401: "Ключ API отклонён. Проверьте ключ в настройках.",
      403: "Сервис запретил запрос. Проверьте права ключа и доступность модели.",
      429: "Превышен лимит запросов. Подождите и повторите попытку.",
    };
    const error = new Error(messages[response.status] || (response.status >= 500
      ? "Сервис API временно недоступен. Повторите попытку позже."
      : `API вернул ошибку ${response.status}. Проверьте настройки подключения.`));
    error.kind = "http";
    error.detail = `HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
    throw error;
  }
  let payload;
  try { payload = await response.json(); } catch (cause) {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    if (controller.signal.aborted && !signal?.aborted) {
      const timeoutError = new Error("Запрос занял больше 60 секунд. Проверьте доступность API и повторите попытку.");
      timeoutError.kind = "timeout";
      throw timeoutError;
    }
    const error = new Error("API вернул некорректный ответ. Проверьте выбранную модель и повторите попытку.");
    error.kind = "response";
    error.detail = cause.message;
    throw error;
  }
  clearTimeout(timeout);
  signal?.removeEventListener("abort", abort);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    const error = new Error("Ответ API не содержит ожидаемый результат. Проверьте совместимость модели.");
    error.kind = "response";
    error.detail = JSON.stringify(payload).slice(0, 400).replaceAll(config.apiKey, "[скрыто]");
    throw error;
  }
  return content;
}

async function currentSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

function parseCompletion(content, sourceText) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let result;
  try { result = JSON.parse(cleaned); } catch (cause) {
    const error = new Error("Ответ API имеет некорректный формат. Проверьте совместимость выбранной модели.");
    error.kind = "response";
    error.detail = cause.message;
    throw error;
  }
  if (typeof result.sentence_translation !== "string" || !Array.isArray(result.words)) {
    throw new Error("Ответ API не содержит перевод предложения и список слов.");
  }
  const source = Array.from(sourceText, (character) => character.toLowerCase());
  for (const word of result.words) {
    if (typeof word.text !== "string" || typeof word.meaning !== "string") {
      throw new Error("Ответ API содержит слово без текста или значения.");
    }
    if (typeof word.lemma !== "string" || !word.lemma.trim()) {
      throw new Error("Ответ API не содержит основную форму слова.");
    }
    if (!Array.isArray(word.examples) || word.examples.length < 2 || word.examples.length > 3 || word.examples.some((example) => typeof example !== "string" || !example.trim())) {
      throw new Error("Ответ API должен содержать 2–3 примера модели для каждого значения.");
    }
    word.examples = word.examples.map((example) => example.trim());
    if (!Number.isInteger(word.start) || !Number.isInteger(word.end) || word.start < 0 || word.end <= word.start) {
      throw new Error("Ответ API не содержит корректные позиции слов в исходном тексте.");
    }
    if (source.slice(word.start, word.end).join("") !== word.text.toLowerCase()) {
      throw new Error("Позиция слова в ответе API не совпадает с исходным текстом.");
    }
  }
  result.words = result.words
    .sort((left, right) => left.start - right.start);
  return result;
}

async function translate(text, signal) {
  const config = await currentSettings();
  const content = await apiCompletion([
    {
      role: "system",
      content: "Переведи текст с " + config.sourceLanguage + " на " + config.targetLanguage +
        '. Верни только JSON-объект: {"sentence_translation":"перевод всего текста","words":[{"text":"точный фрагмент исходного текста","lemma":"основная форма","meaning":"значение в данном контексте","examples":["пример модели 1","пример модели 2"],"start":0,"end":4}]}. ' +
        "Добавь разбор всех содержательных слов в порядке текста. Для каждого значения дай ровно 2 коротких дополнительных примера модели на " + config.sourceLanguage + ", не используя исходную фразу. lemma должна содержать основную форму слова. start и end — нулевая позиция и исключительная конечная позиция фрагмента в символах Unicode исходного текста; " +
        "указывай точные границы каждого вхождения, включая повторяющиеся слова."
    },
    { role: "user", content: text }
  ], config, { signal });
  return parseCompletion(content, text);
}

async function extractComicText(image, signal) {
  const config = await currentSettings();
  const content = await apiCompletion([
    {
      role: "system",
      content: "Извлеки все реплики и предложения, читаемые на изображении комикса, на языке " +
        config.sourceLanguage +
        ". Сохрани исходное написание, пунктуацию и порядок чтения. Не переводи и не добавляй описаний. " +
        'Верни только JSON-объект вида {"dialogues":["первая реплика","вторая реплика"]}.'
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Извлеки текст из выбранного фрагмента комикса." },
        { type: "image_url", image_url: { url: image } }
      ]
    }
  ], config, { signal });
  const cleaned = content.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  let result;
  try { result = JSON.parse(cleaned); } catch (cause) {
    const error = new Error("Модель вернула некорректные реплики. Проверьте совместимость выбранной модели.");
    error.kind = "response";
    error.detail = cause.message;
    throw error;
  }
  if (!Array.isArray(result.dialogues) || result.dialogues.some((line) => typeof line !== "string")) {
    throw new Error("Ответ модели не содержит список извлечённых реплик.");
  }
  const dialogues = result.dialogues.map((line) => line.trim()).filter(Boolean);
  if (!dialogues.length) throw new Error("На выбранной области не удалось распознать текст.");
  return dialogues.join("\n");
}

let comicRequestId;
let comicRequestToken;
let handledComicRequestId;

async function consumePendingComic(request) {
  if (!request) return;
  if (comicRequestId !== request.id) {
    translationController?.abort();
    activeTranslation = undefined;
    comicRequestId = request.id;
    comicRequestToken = ++translationRequest;
    $("source-text").value = "";
    $("result").hidden = true;
    $("expression-form").hidden = true;
    $("translate").textContent = "Перевести";
    showError("");
  }
  const token = comicRequestToken;
  if (token !== translationRequest) return;
  if (request.state === "capturing") {
    $("comic-status").textContent = "Обрабатываем выбранную область…";
    return;
  }
  if (handledComicRequestId === request.id) return;
  handledComicRequestId = request.id;
  await chrome.storage.session.remove("pendingComicRequest");
  if (token !== translationRequest) return;
  if (request.state === "error") {
    $("comic-status").textContent = "";
    showError(request.error);
    return;
  }
  if (request.state !== "image") return;
  $("comic-status").textContent = "Распознаём текст на изображении…";
  translationController = new AbortController();
  $("cancel-translation").hidden = false;
  try {
    const visionController = translationController;
    const text = await extractComicText(request.image, visionController.signal);
    if (token !== translationRequest) return;
    if (translationController === visionController) translationController = undefined;
    $("cancel-translation").hidden = true;
    $("source-text").value = text;
    $("comic-status").textContent = "";
    await runTranslation(token);
  } catch (error) {
    if (token !== translationRequest) return;
    $("cancel-translation").hidden = true;
    translationController = undefined;
    $("comic-status").textContent = "";
    if (error.name !== "AbortError") showApiError(error);
  }
}

function normalizeTerm(value) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function appendUnique(target, values) {
  const seen = new Set(target.map(normalizeTerm));
  for (const value of values) {
    const clean = value.trim();
    if (clean && !seen.has(normalizeTerm(clean))) {
      target.push(clean);
      seen.add(normalizeTerm(clean));
    }
  }
}

async function saveWord(word) {
  await updateCards((cards) => {
    const headword = word.lemma.trim();
    let card = cards.find((item) => item.kind === "word" && normalizeTerm(item.headword) === normalizeTerm(headword));
    if (!card) {
      card = { id: `${Date.now()}-${Math.random()}`, kind: "word", headword, meanings: [] };
      cards.push(card);
    }
    let meaning = card.meanings.find((item) => normalizeTerm(item.text) === normalizeTerm(word.meaning));
    if (!meaning) {
      meaning = { text: word.meaning.trim(), contexts: [], examples: [] };
      card.meanings.push(meaning);
    }
    const context = {
      form: word.text,
      text: translatedSourceText,
      start: word.start,
      end: word.end
    };
    if (!meaning.contexts.some((item) => item.form === context.form && item.text === context.text && item.start === context.start && item.end === context.end)) {
      meaning.contexts.push(context);
    }
    appendUnique(meaning.examples, word.examples);
  });
}

let selectedExpression;
let translatedSourceText = "";

function updateSelectedExpression() {
  const source = $("source-text");
  const start = source.selectionStart;
  const end = source.selectionEnd;
  selectedExpression = end > start ? { text: source.value.slice(start, end).trim(), start, end } : undefined;
  $("save-expression").disabled = !selectedExpression?.text;
}

async function requestExpressionExamples(expression, meaning, context, signal) {
  const config = await currentSettings();
  const content = await apiCompletion([
    { role: "system", content: `Сгенерируй два дополнительных примера на ${config.sourceLanguage} для устойчивого выражения «${expression}» со значением «${meaning}». Не копируй исходный контекст. Верни только JSON: {"examples":["пример 1","пример 2"]}.` },
    { role: "user", content: context }
  ], config, { signal });
  const examples = JSON.parse(content).examples;
  if (!Array.isArray(examples) || examples.length < 2 || examples.length > 3 || examples.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Модель должна вернуть 2–3 примера.");
  }
  return examples.map((item) => item.trim());
}

let expressionSaveRequest = 0;
let expressionSaveController;

async function persistExpression(expression, meaningText, sourceContext, examples = []) {
  await updateCards((cards) => {
    let card = cards.find((item) => item.kind === "expression" && normalizeTerm(item.headword) === normalizeTerm(expression.text));
    if (!card) {
      card = { id: `${Date.now()}-${Math.random()}`, kind: "expression", headword: expression.text, meanings: [] };
      cards.push(card);
    }
    let meaning = card.meanings.find((item) => normalizeTerm(item.text) === normalizeTerm(meaningText));
    if (!meaning) {
      meaning = { text: meaningText, contexts: [], examples: [] };
      card.meanings.push(meaning);
    }
    if (!meaning.contexts.some((item) => item.text === sourceContext && item.start === expression.start && item.end === expression.end)) {
      meaning.contexts.push({ form: expression.text, text: sourceContext, start: expression.start, end: expression.end });
    }
    appendUnique(meaning.examples, examples);
  });
}

function expressionFormData() {
  const meaningText = $("expression-meaning").value.trim();
  if (!meaningText) {
    $("expression-meaning").focus();
    return;
  }
  return { expression: selectedExpression, meaningText, sourceContext: $("source-text").value.trim() };
}

async function saveExpression(event) {
  event.preventDefault();
  const data = expressionFormData();
  if (!data?.expression?.text) return;
  const request = ++expressionSaveRequest;
  const controller = new AbortController();
  expressionSaveController = controller;
  const submit = $("expression-form").querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Получаем примеры…";
  $("cancel-expression-save").hidden = false;
  showError("");
  try {
    const examples = await requestExpressionExamples(data.expression.text, data.meaningText, data.sourceContext, controller.signal);
    if (request !== expressionSaveRequest || controller.signal.aborted) return;
    submit.textContent = "Сохраняем…";
    $("cancel-expression-save").hidden = true;
    await persistExpression(data.expression, data.meaningText, data.sourceContext, examples);
    if (request !== expressionSaveRequest) return;
    $("expression-form").hidden = true;
    $("expression-meaning").value = "";
    $("save-expression").textContent = "Выражение сохранено";
  } catch (error) {
    if (request === expressionSaveRequest && error.name !== "AbortError") {
      showApiError(error);
      showError(`Не удалось получить примеры. Можно сохранить без них и дополнить позже. ${error.message}`);
    }
  } finally {
    if (request === expressionSaveRequest) {
      submit.disabled = false;
      submit.textContent = "Сохранить выражение";
      $("cancel-expression-save").hidden = true;
    }
  }
}

async function saveExpressionOffline() {
  const data = expressionFormData();
  if (!data?.expression?.text) return;
  ++expressionSaveRequest;
  expressionSaveController?.abort();
  await persistExpression(data.expression, data.meaningText, data.sourceContext);
  $("expression-form").hidden = true;
  $("expression-meaning").value = "";
  $("save-expression").textContent = "Выражение сохранено";
}

function cancelExpression() {
  ++expressionSaveRequest;
  expressionSaveController?.abort();
  expressionSaveController = undefined;
  $("expression-form").hidden = true;
  $("save-expression").focus();
}

function renderResult(result, sourceText) {
  translatedSourceText = sourceText;
  $("sentence-translation").textContent = result.sentence_translation;
  const list = $("word-meanings");
  list.replaceChildren(...result.words.map((word) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${word.text} — ${word.meaning}`;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Сохранить";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await saveWord(word);
        save.textContent = "Сохранено";
      } catch (error) {
        showError(`Не удалось сохранить карточку: ${error.message}`);
        save.disabled = false;
      }
    });
    item.append(label, save);
    return item;
  }));
  $("result").hidden = false;
}

let translationRequest = 0;
let translationController;
let activeTranslation;

async function runTranslation(existingRequest) {
  const text = $("source-text").value.trim();
  if (!text) return showError("Введите текст или выберите его на странице.");
  const config = await currentSettings();
  const key = JSON.stringify([text, config.apiUrl, config.apiKey, config.model, config.sourceLanguage, config.targetLanguage]);
  if (existingRequest === undefined && activeTranslation?.key === key) return activeTranslation.promise;
  const request = existingRequest ?? ++translationRequest;
  if (request !== translationRequest) return;
  if (activeTranslation?.key === key) return activeTranslation.promise;
  translationController?.abort();
  const controller = new AbortController();
  translationController = controller;
  $("comic-status").textContent = "";
  showError("");
  $("error-details").hidden = true;
  $("result").hidden = true;
  $("expression-form").hidden = true;
  $("translate").textContent = "Переводим…";
  $("cancel-translation").hidden = false;
  const promise = translate(text, controller.signal);
  activeTranslation = { key, promise };
  try {
    const result = await promise;
    if (request !== translationRequest || controller.signal.aborted) return;
    renderResult(result, text);
  } catch (error) {
    if (request === translationRequest && error.name !== "AbortError") showApiError(error);
  } finally {
    if (request === translationRequest) {
      $("translate").textContent = "Перевести";
      $("cancel-translation").hidden = true;
    }
    if (translationController === controller) translationController = undefined;
    if (activeTranslation?.promise === promise) activeTranslation = undefined;
  }
}

$("translate").addEventListener("click", () => void runTranslation());
$("cancel-translation").addEventListener("click", () => {
  ++translationRequest;
  translationController?.abort();
  activeTranslation = undefined;
  $("translate").textContent = "Перевести";
  $("cancel-translation").hidden = true;
  $("comic-status").textContent = "Запрос отменён.";
});
$("source-text").addEventListener("select", updateSelectedExpression);
$("source-text").addEventListener("keyup", updateSelectedExpression);
$("source-text").addEventListener("mouseup", updateSelectedExpression);
$("source-text").addEventListener("input", updateSelectedExpression);
$("source-text").addEventListener("input", () => {
  if (!translationController) return;
  if (activeTranslation && $("source-text").value.trim() === JSON.parse(activeTranslation.key)[0]) return;
  ++translationRequest;
  translationController?.abort();
  activeTranslation = undefined;
  $("translate").textContent = "Перевести";
  $("cancel-translation").hidden = true;
});
$("save-expression").addEventListener("click", () => {
  if (!selectedExpression) return;
  $("expression-text").textContent = selectedExpression.text;
  $("expression-form").hidden = false;
  $("expression-meaning").focus();
});
$("cancel-expression").addEventListener("click", cancelExpression);
$("cancel-expression-save").addEventListener("click", cancelExpression);
$("save-expression-offline").addEventListener("click", () => void saveExpressionOffline().catch((error) => showError(`Не удалось сохранить выражение: ${error.message}`)));
$("expression-form").addEventListener("submit", (event) => void saveExpression(event));
$("source-text").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void runTranslation();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.pendingSelection?.newValue) {
    translationController?.abort();
    activeTranslation = undefined;
    $("source-text").value = changes.pendingSelection.newValue;
    void chrome.storage.local.remove("pendingSelection");
    void runTranslation();
  }
  if (areaName === "session" && changes.pendingComicRequest?.newValue) {
    void consumePendingComic(changes.pendingComicRequest.newValue);
  }
});

void (async () => {
  const { pendingSelection } = await chrome.storage.local.get("pendingSelection");
  if (pendingSelection) {
    $("source-text").value = pendingSelection;
    await chrome.storage.local.remove("pendingSelection");
    void runTranslation();
  }
  const { pendingComicRequest } = await chrome.storage.session.get("pendingComicRequest");
  await consumePendingComic(pendingComicRequest);
})().catch((error) => showError(`Не удалось загрузить панель: ${error.message}`));
