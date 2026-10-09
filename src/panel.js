import { setupReview } from "./review.js";
import { updateCards } from "./cards.js";

const DEFAULT_SETTINGS = {
  sourceLanguage: "English",
  targetLanguage: "Русский",
  apiUrl: "",
  model: "",
  apiKey: ""
};

const $ = (id) => document.getElementById(id);
const form = {
  sourceLanguage: $("source-language"),
  targetLanguage: $("target-language"),
  apiUrl: $("api-url"),
  model: $("model"),
  apiKey: $("api-key")
};

function showError(message) {
  $("error").textContent = message;
}

async function loadSettings() {
  const saved = await currentSettings();
  Object.entries(form).forEach(([key, input]) => { input.value = saved[key]; });
}

async function saveSettings() {
  const settings = Object.fromEntries(Object.entries(form).map(([key, input]) => [key, input.value.trim()]));
  await chrome.storage.local.set({ settings });
  $("settings-status").textContent = "Настройки сохранены на этом устройстве.";
}

async function apiCompletion(messages, config) {
  if (!config.apiUrl || !config.apiKey || !config.model) throw new Error("Заполните URL API, ключ и модель в настройках.");
  let response;
  try {
    response = await fetch(completionUrl(config.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify({ model: config.model, temperature: 0.2, response_format: { type: "json_object" }, messages })
    });
  } catch (error) {
    throw new Error("Не удалось связаться с API: " + error.message);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error("API вернул ошибку " + response.status + (detail ? ": " + detail : "."));
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Ответ API не содержит текста.");
  return content;
}

async function currentSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

function parseCompletion(content, sourceText) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const result = JSON.parse(cleaned);
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

function completionUrl(baseUrl) {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Укажите корректный URL API, начинающийся с https:// или http://.");
  return url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
}

async function translate(text) {
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
  ], config);
  return parseCompletion(content, text);
}

async function extractComicText(image) {
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
  ], config);
  const cleaned = content.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  const result = JSON.parse(cleaned);
  if (!Array.isArray(result.dialogues) || result.dialogues.some((line) => typeof line !== "string")) {
    throw new Error("Ответ модели не содержит список извлечённых реплик.");
  }
  const dialogues = result.dialogues.map((line) => line.trim()).filter(Boolean);
  if (!dialogues.length) throw new Error("На выбранной области не удалось распознать текст.");
  return dialogues.join("\n");
}

async function handleComicImage(image) {
  $("comic-status").textContent = "Распознаём текст на изображении…";
  showError("");
  try {
    $("source-text").value = await extractComicText(image);
    $("result").hidden = true;
    $("comic-status").textContent = "Проверьте и при необходимости исправьте реплики, затем подтвердите текст кнопкой ниже.";
  } catch (error) {
    $("comic-status").textContent = "";
    showError(error.message || "Не удалось распознать текст на изображении.");
  }
}

async function consumePendingComic({ pendingComicImage, pendingComicError }) {
  if (pendingComicImage) {
    await chrome.storage.session.remove("pendingComicImage");
    await handleComicImage(pendingComicImage);
  }
  if (pendingComicError) {
    showError(pendingComicError);
    await chrome.storage.session.remove("pendingComicError");
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
  await renderCards();
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

async function requestExpressionExamples(expression, meaning, context) {
  const config = await currentSettings();
  const content = await apiCompletion([
    { role: "system", content: `Сгенерируй два дополнительных примера на ${config.sourceLanguage} для устойчивого выражения «${expression}» со значением «${meaning}». Не копируй исходный контекст. Верни только JSON: {"examples":["пример 1","пример 2"]}.` },
    { role: "user", content: context }
  ], config);
  const examples = JSON.parse(content).examples;
  if (!Array.isArray(examples) || examples.length < 2 || examples.length > 3 || examples.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Модель должна вернуть 2–3 примера.");
  }
  return examples.map((item) => item.trim());
}

async function saveExpression(event) {
  event.preventDefault();
  if (!selectedExpression?.text) return;
  const expression = selectedExpression;
  const meaningText = $("expression-meaning").value.trim();
  if (!meaningText) return $("expression-meaning").focus();
  const sourceContext = $("source-text").value.trim();
  const submit = $("expression-form").querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Получаем примеры…";
  showError("");
  try {
    const examples = await requestExpressionExamples(expression.text, meaningText, sourceContext);
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
    await renderCards();
    $("expression-form").hidden = true;
    $("expression-meaning").value = "";
    $("save-expression").textContent = "Выражение сохранено";
  } catch (error) {
    showError(`Не удалось сохранить выражение: ${error.message}`);
  } finally {
    submit.disabled = false;
    submit.textContent = "Сохранить выражение";
  }
}

async function renderCards() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  $("vocabulary-cards").replaceChildren(...cards.map((card) => {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = card.headword;
    article.append(heading);
    const schedule = document.createElement("p");
    if (card.schedule) {
      const due = document.createElement("time");
      due.dateTime = card.schedule.due;
      due.textContent = new Date(card.schedule.due).toLocaleString("ru-RU");
      schedule.append("Следующее повторение: ", due);
    } else {
      schedule.textContent = "Новая карточка";
    }
    article.append(schedule);
    for (const meaning of card.meanings) {
      const meaningHeading = document.createElement("p");
      meaningHeading.textContent = meaning.text;
      article.append(meaningHeading);
      const contexts = document.createElement("ul");
      for (const context of meaning.contexts) {
        const item = document.createElement("li");
        item.className = "card-context";
        item.textContent = `${context.form}: ${context.text}`;
        contexts.append(item);
      }
      article.append(contexts);
      if (meaning.examples.length) {
        const examplesHeading = document.createElement("p");
        examplesHeading.textContent = "Примеры модели";
        article.append(examplesHeading);
        const examples = document.createElement("ul");
        for (const example of meaning.examples) {
          const item = document.createElement("li");
          item.textContent = example;
          examples.append(item);
        }
        article.append(examples);
      }
    }
    return article;
  }));
  $("vocabulary-empty").hidden = cards.length > 0;
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

async function runTranslation() {
  const text = $("source-text").value.trim();
  if (!text) return showError("Введите текст или выберите его на странице.");
  showError("");
  $("translate").disabled = true;
  $("translate").textContent = "Переводим…";
  try {
    renderResult(await translate(text), text);
  } catch (error) {
    showError(error.message || "Не удалось выполнить перевод.");
  } finally {
    $("translate").disabled = false;
    $("translate").textContent = "Подтвердить текст и перевести";
  }
}

$("settings-toggle").addEventListener("click", () => {
  const settings = $("settings");
  settings.hidden = !settings.hidden;
  $("settings-toggle").setAttribute("aria-expanded", String(!settings.hidden));
});
  $("save-settings").addEventListener("click", async () => {
    $("settings-status").textContent = "";
    $("settings-status").style.color = "";
  try {
    await saveSettings();
  } catch (error) {
    $("settings-status").textContent = `Не удалось сохранить настройки: ${error.message}`;
    $("settings-status").style.color = "#c33";
  }
});
$("translate").addEventListener("click", () => void runTranslation());
$("source-text").addEventListener("select", updateSelectedExpression);
$("source-text").addEventListener("keyup", updateSelectedExpression);
$("source-text").addEventListener("mouseup", updateSelectedExpression);
$("source-text").addEventListener("input", updateSelectedExpression);
$("save-expression").addEventListener("click", () => {
  if (!selectedExpression) return;
  $("expression-text").textContent = selectedExpression.text;
  $("expression-form").hidden = false;
  $("expression-meaning").focus();
});
$("cancel-expression").addEventListener("click", () => { $("expression-form").hidden = true; });
$("expression-form").addEventListener("submit", (event) => void saveExpression(event));
$("source-text").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void runTranslation();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.pendingSelection?.newValue) {
    $("source-text").value = changes.pendingSelection.newValue;
    void chrome.storage.local.remove("pendingSelection");
  }
  if (areaName === "session") {
    void consumePendingComic({
      pendingComicImage: changes.pendingComicImage?.newValue,
      pendingComicError: changes.pendingComicError?.newValue
    });
  }
});

setupReview(renderCards);

void loadSettings().then(async () => {
  await renderCards();
  const { pendingSelection } = await chrome.storage.local.get("pendingSelection");
  if (pendingSelection) {
    $("source-text").value = pendingSelection;
    await chrome.storage.local.remove("pendingSelection");
  }
  const comicState = await chrome.storage.session.get(["pendingComicImage", "pendingComicError"]);
  await consumePendingComic(comicState);
}).catch((error) => showError(`Не удалось загрузить настройки: ${error.message}`));
