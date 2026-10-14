import "./theme.js";
import { createBackup, parseBackup, restoreBackup } from "./backup.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { updateCards } from "./cards.js";

const $ = (id) => document.getElementById(id);
const normalize = (value) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

function cardMatches(card, query) {
  const text = [card.headword, ...card.meanings.map((meaning) => meaning.text)];
  return text.some((value) => normalize(value).includes(query));
}

function appendList(parent, title, values, format = (value) => value) {
  if (!values.length) return;
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = format(value);
    list.append(item);
  }
  parent.append(heading, list);
}

function renderCard(card, expanded) {
  const details = document.createElement("details");
  details.className = "vocabulary-card";
  details.dataset.cardId = card.id;
  details.open = expanded;

  const summary = document.createElement("summary");
  const headword = document.createElement("strong");
  headword.textContent = card.headword;
  const status = document.createElement("span");
  if (card.schedule?.due) {
    const due = document.createElement("time");
    due.dateTime = card.schedule.due;
    due.textContent = new Date(card.schedule.due).toLocaleString("ru-RU");
    status.append("Следующее повторение: ", due);
  } else {
    status.textContent = "Новая карточка";
  }
  summary.append(headword, document.createTextNode(" — "), status);
  details.append(summary);

  for (const meaning of card.meanings) {
    const section = document.createElement("section");
    section.className = "vocabulary-meaning";
    const heading = document.createElement("h3");
    heading.textContent = meaning.text;
    section.append(heading);
    appendList(section, "Контексты употребления", meaning.contexts, (context) => `${context.form}: ${context.text}`);
    appendList(section, "Примеры модели", meaning.examples);
    if (!meaning.examples?.length) {
      const addExamples = document.createElement("button");
      addExamples.type = "button";
      addExamples.textContent = "Добавить примеры модели";
      addExamples.addEventListener("click", () => void generateExamples(card, meaning, addExamples));
      section.append(addExamples);
    }
    details.append(section);
  }
  return details;
}

async function generateExamples(card, meaning, button) {
  button.disabled = true;
  button.textContent = "Получаем примеры…";
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const config = { ...DEFAULT_SETTINGS, ...settings };
    if (!config.apiUrl || !config.apiKey || !config.model) throw new Error("Настройте URL API, ключ и модель в разделе «Настройки».");
    const base = config.apiUrl.trim().replace(/\/+$/, "");
    const url = /^https?:\/\//i.test(base) ? (base.endsWith("/chat/completions") ? base : base + "/chat/completions") : "";
    if (!url) throw new Error("Укажите корректный URL API в настройках.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
        body: JSON.stringify({ model: config.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [
          { role: "system", content: "Сгенерируй два дополнительных примера на " + config.sourceLanguage + " для выражения «" + card.headword + "» со значением «" + meaning.text + "». Не копируй исходный контекст. Верни только JSON: {\"examples\":[\"пример 1\",\"пример 2\"]}." },
          { role: "user", content: meaning.contexts?.[0]?.text || card.headword }
        ] }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Запрос занял больше 60 секунд. Повторите попытку.");
      throw new Error("Не удалось связаться с API. Проверьте соединение и настройки.");
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      const hints = { 401: "Проверьте ключ API.", 429: "Подождите и повторите запрос." };
      throw new Error(hints[response.status] || "API вернул ошибку " + response.status + ".");
    }
    const payload = await response.json();
    const examples = JSON.parse(payload.choices?.[0]?.message?.content || "{}").examples;
    if (!Array.isArray(examples) || examples.length < 2 || examples.length > 3 || examples.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error("Модель вернула некорректный список примеров.");
    }
    await updateCards((cards) => {
      const currentCard = cards.find((item) => item.id === card.id);
      const currentMeaning = currentCard?.meanings.find((item) => item.text === meaning.text);
      if (!currentMeaning) return;
      const existing = new Set((currentMeaning.examples || []).map((item) => item.trim().toLocaleLowerCase()));
      currentMeaning.examples ||= [];
      for (const example of examples) {
        const clean = example.trim();
        if (!existing.has(clean.toLocaleLowerCase())) currentMeaning.examples.push(clean);
      }
    });
  } catch (error) {
    $("vocabulary-status").textContent = "Не удалось добавить примеры: " + error.message;
    button.disabled = false;
    button.textContent = "Повторить добавление примеров";
  }
}

async function renderVocabulary() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  const query = normalize($("vocabulary-search").value);
  const expanded = new Set([...$("vocabulary-cards").querySelectorAll("details[open]")].map((item) => item.dataset.cardId));
  const matches = cards.filter((card) => cardMatches(card, query));
  $("vocabulary-cards").replaceChildren(...matches.map((card) => renderCard(card, expanded.has(card.id))));
  $("vocabulary-empty").hidden = cards.length > 0;
  $("vocabulary-no-results").hidden = cards.length === 0 || matches.length > 0;
  $("vocabulary-status").textContent = "";
}

async function exportBackup() {
  const { cards = [] } = await chrome.storage.local.get("cards");
  const file = new Blob([JSON.stringify(createBackup(cards), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lexideck-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  $("backup-status").textContent = `Экспортировано карточек: ${cards.length}. Ключ API не включён.`;
}

async function importBackup(file) {
  const cards = parseBackup(await file.text());
  await restoreBackup(cards, () => window.confirm(`В резервной копии ${cards.length} карточек. Заменить текущий словарь?`));
  await renderVocabulary();
  $("backup-status").textContent = `Восстановлено карточек: ${cards.length}.`;
}

$("vocabulary-search").addEventListener("input", () => {
  void renderVocabulary().catch((error) => { $("vocabulary-status").textContent = `Не удалось показать словарь: ${error.message}`; });
});
$("export-backup").addEventListener("click", () => {
  void exportBackup().catch((error) => { $("backup-status").textContent = `Не удалось экспортировать словарь: ${error.message}`; });
});
$("import-backup").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const [file] = input.files;
  if (!file) return;
  $("backup-status").textContent = "Проверяем резервную копию…";
  try {
    await importBackup(file);
  } catch (error) {
    $("backup-status").textContent = error.message.startsWith("Импорт отменён")
      ? error.message
      : `Не удалось импортировать словарь: ${error.message}`;
  } finally {
    input.value = "";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.cards) {
    void renderVocabulary().catch((error) => { $("vocabulary-status").textContent = `Не удалось обновить словарь: ${error.message}`; });
  }
});

void renderVocabulary().catch((error) => { $("vocabulary-status").textContent = `Не удалось загрузить словарь: ${error.message}`; });
